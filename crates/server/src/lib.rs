// Headless HTTP adapter over `git-core`, mirroring the Tauri commands in
// `src-tauri/src/git.rs` 1:1 so `HttpGitSource` (frontend) and
// `TauriGitSource` stay behaviorally identical against the same repo logic.
//
// The repo path is fixed at startup (`main.rs` parses `--repo`) and never
// accepted from a client request — this is a network-facing service, so a
// client-supplied filesystem path would be a path-traversal/arbitrary-read
// hole. Mutating endpoints serialize through `AppState::write_lock` so two
// clients editing the same repo concurrently can't race the index; reads
// run unlocked. Every handler runs the (blocking, disk-bound) git-core call
// via `spawn_blocking` so it never stalls the async runtime.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use git_core::{HunkPatch, Revision};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::CorsLayer;

pub struct AppState {
    /// Canonicalized path to the one repo this server instance serves.
    pub repo_path: String,
    /// Held for the duration of any mutating operation.
    pub write_lock: tokio::sync::Mutex<()>,
}

/// Route registration lives behind this single seam so a token-auth
/// `tower::Layer` can be inserted later without touching any handler.
pub fn router(state: AppState) -> Router {
    let state = Arc::new(state);
    Router::new()
        .route("/api/repo", get(get_repo))
        .route("/api/commits", get(get_commits))
        .route("/api/branches", get(get_branches))
        .route("/api/tags", get(get_tags))
        .route("/api/worktrees", get(get_worktrees))
        .route("/api/changes", post(post_changes))
        .route("/api/file", post(post_file))
        .route("/api/all-files", post(post_all_files))
        .route("/api/hunk", post(post_hunk))
        .route("/api/stage", post(post_stage))
        .route("/api/unstage", post(post_unstage))
        .route("/api/discard", post(post_discard))
        .route("/api/commit", post(post_commit))
        .route("/api/push", post(post_push))
        .route("/api/pull", post(post_pull))
        .route("/api/revert", post(post_revert))
        .with_state(state)
        // Permissive: matches the v1 "trusted network, no auth" decision —
        // the frontend is commonly served from a different origin/port than
        // this API (e.g. a Vite dev server). Tighten alongside adding auth.
        .layer(CorsLayer::permissive())
}

/// Run a blocking git-core call off the async runtime's worker threads.
/// `spawn_blocking` panics are surfaced as a plain error string rather than
/// propagated, matching git-core's own no-panic contract for user input.
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| Err(format!("internal error: {e}")))
}

fn ok_response<T: serde::Serialize>(result: Result<T, String>) -> Response {
    match result {
        Ok(value) => (StatusCode::OK, Json(value)).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}

#[derive(Deserialize)]
struct CommitsQuery {
    limit: usize,
}

#[derive(Deserialize)]
struct ChangesRequest {
    base: Revision,
    head: Revision,
}

#[derive(Deserialize)]
struct FileRequest {
    rev: Revision,
    path: String,
}

#[derive(Deserialize)]
struct AllFilesRequest {
    rev: Revision,
}

#[derive(Deserialize)]
struct HunkRequest {
    path: String,
    hunk: HunkPatch,
    mode: String,
}

#[derive(Deserialize)]
struct PathsRequest {
    paths: Vec<String>,
}

#[derive(Deserialize)]
struct CommitRequest {
    message: String,
}

#[derive(Deserialize)]
struct RevertRequest {
    sha: String,
}

async fn get_repo(State(state): State<Arc<AppState>>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::open_repo(repo_path)).await)
}

async fn get_commits(State(state): State<Arc<AppState>>, Query(q): Query<CommitsQuery>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::list_commits(repo_path, q.limit)).await)
}

async fn get_branches(State(state): State<Arc<AppState>>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::list_branches(repo_path)).await)
}

async fn get_tags(State(state): State<Arc<AppState>>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::list_tags(repo_path)).await)
}

async fn get_worktrees(State(state): State<Arc<AppState>>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::list_worktrees(repo_path)).await)
}

async fn post_changes(State(state): State<Arc<AppState>>, Json(body): Json<ChangesRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::list_changes(repo_path, body.base, body.head)).await)
}

async fn post_file(State(state): State<Arc<AppState>>, Json(body): Json<FileRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::read_file(repo_path, body.rev, body.path)).await)
}

async fn post_all_files(State(state): State<Arc<AppState>>, Json(body): Json<AllFilesRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    ok_response(run_blocking(move || git_core::list_all_files(repo_path, body.rev)).await)
}

// -- Mutating endpoints: each holds `write_lock` for its full duration. --

async fn post_hunk(State(state): State<Arc<AppState>>, Json(body): Json<HunkRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::apply_hunk(repo_path, body.path, body.hunk, body.mode)).await)
}

async fn post_stage(State(state): State<Arc<AppState>>, Json(body): Json<PathsRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::stage_paths(repo_path, body.paths)).await)
}

async fn post_unstage(State(state): State<Arc<AppState>>, Json(body): Json<PathsRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::unstage_paths(repo_path, body.paths)).await)
}

async fn post_discard(State(state): State<Arc<AppState>>, Json(body): Json<PathsRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::discard_paths(repo_path, body.paths)).await)
}

async fn post_commit(State(state): State<Arc<AppState>>, Json(body): Json<CommitRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::commit(repo_path, body.message)).await)
}

async fn post_push(State(state): State<Arc<AppState>>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::push(repo_path)).await)
}

async fn post_pull(State(state): State<Arc<AppState>>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::pull(repo_path)).await)
}

async fn post_revert(State(state): State<Arc<AppState>>, Json(body): Json<RevertRequest>) -> Response {
    let repo_path = state.repo_path.clone();
    let _guard = state.write_lock.lock().await;
    ok_response(run_blocking(move || git_core::revert_commit(repo_path, body.sha)).await)
}

/// Handler-level (HTTP + JSON wiring) tests. Not re-testing git-core's own
/// logic — that's covered by `crates/git-core`'s tests — just that each
/// route maps to the right function, request bodies decode, and errors come
/// back as `{"error": "..."}` with 400.
#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::*;

    fn init_repo_with_commit(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dv-server-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = git2::Repository::init(&dir).unwrap();
        std::fs::write(dir.join("committed.txt"), b"one\ntwo\nthree\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("committed.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("t", "t@t").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        dir
    }

    fn test_app(repo_path: &Path) -> Router {
        router(AppState {
            repo_path: repo_path.to_str().unwrap().to_string(),
            write_lock: tokio::sync::Mutex::new(()),
        })
    }

    async fn body_json(res: Response) -> Value {
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    fn post(uri: &str, body: Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn get_repo_returns_repo_info() {
        let dir = init_repo_with_commit("repo");
        let res = test_app(&dir).oneshot(get("/api/repo")).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = body_json(res).await;
        assert!(body["headRef"].is_string());
        assert_eq!(body["isDirty"], false);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn commits_and_changes_roundtrip() {
        let dir = init_repo_with_commit("changes");
        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree\n").unwrap();
        let app = test_app(&dir);

        let res = app.clone().oneshot(get("/api/commits?limit=10")).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await.as_array().unwrap().len(), 1);

        let res = app
            .clone()
            .oneshot(post(
                "/api/changes",
                json!({ "base": { "kind": "ref", "ref": "HEAD" }, "head": { "kind": "worktree" } }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let changes = body_json(res).await;
        assert_eq!(changes[0]["path"], "committed.txt");
        assert_eq!(changes[0]["status"], "modified");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Exercises the write-locked path: stage then commit, both serialized
    /// through `AppState::write_lock`.
    #[tokio::test]
    async fn stage_and_commit_through_api() {
        let dir = init_repo_with_commit("stage-commit");
        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree\n").unwrap();
        let app = test_app(&dir);

        let res = app
            .clone()
            .oneshot(post("/api/stage", json!({ "paths": ["committed.txt"] })))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let res = app
            .clone()
            .oneshot(post("/api/commit", json!({ "message": "via api" })))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let commit = body_json(res).await;
        assert_eq!(commit["summary"], "via api");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn errors_come_back_as_400_with_error_body() {
        let dir = init_repo_with_commit("bad-rev");
        let res = test_app(&dir)
            .oneshot(post(
                "/api/file",
                json!({ "rev": { "kind": "bogus" }, "path": "committed.txt" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let body = body_json(res).await;
        assert!(body["error"].as_str().unwrap().contains("unsupported revision kind"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
