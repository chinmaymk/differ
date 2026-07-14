// Local-git data source (libgit2 via the `git2` crate).
//
// Exposes three Tauri commands, metadata-first with lazy content:
//   * `open_repo`    — validate/label a repository
//   * `list_changes` — changed-file metadata between two revisions
//   * `read_file`    — one file's bytes at one revision (base64)
//
// All fallible paths return `Err(String)` (stringified git2 errors); no
// unwrap/panic on user-triggered input.

use std::path::Path;

use base64::prelude::{Engine as _, BASE64_STANDARD};
use git2::{Delta, DiffFindOptions, DiffOptions, Repository, StatusOptions, Tree};
use serde::{Deserialize, Serialize};

/// Summary of a repository, used to confirm/label an opened repo.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Short name of the current branch (or "HEAD" when detached/unborn).
    head_ref: String,
    /// True when the working tree has staged or unstaged changes.
    is_dirty: bool,
}

/// A commit in the repository's history (mirrors the TS `CommitInfo`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    sha: String,
    short_sha: String,
    summary: String,
    author: String,
    /// Author time, Unix seconds.
    timestamp: i64,
    /// First-parent sha, or null for a root commit.
    parent: Option<String>,
}

/// Changed-file metadata (mirrors the TS `ChangedFile`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    path: String,
    /// Old-side path, present only for renames.
    #[serde(skip_serializing_if = "Option::is_none")]
    old_path: Option<String>,
    status: String,
}

/// One file's content at one revision (mirrors the TS `FileContent`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// Base64-encoded bytes, or null when the file is absent or binary.
    bytes: Option<String>,
    /// True when the content was detected as binary (bytes suppressed).
    binary: bool,
}

/// A revision to compare (mirrors the TS `Revision`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    /// One of "ref" | "worktree" | "index".
    kind: String,
    /// For kind "ref": a commit-ish (sha, branch, tag, "HEAD").
    #[serde(rename = "ref")]
    r#ref: Option<String>,
}

/// Map a git2 delta status to the TS `FileStatus`. `None` = ignore this delta.
fn map_status(status: Delta) -> Option<&'static str> {
    match status {
        Delta::Added | Delta::Copied | Delta::Untracked => Some("added"),
        Delta::Deleted => Some("removed"),
        Delta::Modified | Delta::Typechange => Some("modified"),
        Delta::Renamed => Some("renamed"),
        // Unmodified / Ignored / Unreadable / Conflicted: not a viewable change.
        _ => None,
    }
}

/// The canonical empty tree — used as the baseline when HEAD is unborn (a repo
/// with no commits yet), so every working-tree file shows up as "added".
fn empty_tree(repo: &Repository) -> Result<Tree<'_>, String> {
    let oid = repo
        .treebuilder(None)
        .and_then(|b| b.write())
        .map_err(|e| e.to_string())?;
    repo.find_tree(oid).map_err(|e| e.to_string())
}

/// Resolve a `kind: "ref"` revision to its tree. When the ref can't be resolved
/// only because HEAD is unborn (no commits), fall back to the empty tree.
fn rev_to_tree<'repo>(repo: &'repo Repository, rev: &Revision) -> Result<Tree<'repo>, String> {
    // An explicit empty baseline (e.g. a root commit's "parent").
    if rev.kind == "empty" {
        return empty_tree(repo);
    }
    let refstr = rev
        .r#ref
        .as_deref()
        .ok_or("ref revision is missing its 'ref' field")?;
    match repo
        .revparse_single(refstr)
        .and_then(|obj| obj.peel_to_tree())
    {
        Ok(tree) => Ok(tree),
        // head() erroring means the branch is unborn — treat as empty baseline.
        Err(e) => {
            if repo.head().is_err() {
                empty_tree(repo)
            } else {
                Err(e.to_string())
            }
        }
    }
}

/// Discover the git repository containing `start` and return its working-dir
/// path. Lets the desktop app auto-open the repo it was launched from.
#[tauri::command]
pub fn repo_root(start: Option<String>) -> Result<String, String> {
    let from = start.unwrap_or_else(|| ".".to_string());
    let repo = Repository::discover(&from).map_err(|e| e.to_string())?;
    let dir = repo
        .workdir()
        .ok_or("bare repository has no working directory")?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Heuristic binary detection: a NUL byte within the first 8KB.
fn is_binary(bytes: &[u8]) -> bool {
    let n = bytes.len().min(8192);
    bytes[..n].contains(&0)
}

/// Max bytes we'll ship for a binary image (keeps IPC payloads sane).
const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

/// Whether a path looks like an image we can render in the viewer.
fn is_image(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

#[tauri::command]
pub fn open_repo(path: String) -> Result<RepoInfo, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;

    // Detached HEAD or an unborn branch both fall back to the literal "HEAD".
    let head_ref = repo
        .head()
        .ok()
        .and_then(|r| r.shorthand().map(str::to_owned))
        .unwrap_or_else(|| "HEAD".to_string());

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).include_ignored(false);
    let is_dirty = !repo
        .statuses(Some(&mut opts))
        .map_err(|e| e.to_string())?
        .is_empty();

    Ok(RepoInfo { head_ref, is_dirty })
}

#[tauri::command]
pub fn list_commits(repo_path: String, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    let mut walk = repo.revwalk().map_err(|e| e.to_string())?;
    // Unborn HEAD (no commits) → empty history, not an error.
    if walk.push_head().is_err() {
        return Ok(Vec::new());
    }
    walk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for oid in walk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let sha = oid.to_string();
        out.push(CommitInfo {
            short_sha: sha.chars().take(7).collect(),
            sha,
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parent: commit.parent_id(0).ok().map(|p| p.to_string()),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn list_changes(
    repo_path: String,
    base: Revision,
    head: Revision,
) -> Result<Vec<ChangedFile>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    let mut opts = DiffOptions::new();
    // Untracked files matter: a coding agent's brand-new files live here.
    opts.include_untracked(true).recurse_untracked_dirs(true);

    // `base` is always a ref/commit tree in the v1 combinations.
    let base_tree = rev_to_tree(&repo, &base)?;

    let mut diff = match head.kind.as_str() {
        // Primary case: tree vs working directory (all uncommitted changes,
        // staged and unstaged).
        "worktree" => repo
            .diff_tree_to_workdir_with_index(Some(&base_tree), Some(&mut opts))
            .map_err(|e| e.to_string())?,
        // Commit/branch comparison: tree vs tree.
        "ref" => {
            let head_tree = rev_to_tree(&repo, &head)?;
            repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), Some(&mut opts))
                .map_err(|e| e.to_string())?
        }
        // Staged changes: tree vs index.
        "index" => repo
            .diff_tree_to_index(Some(&base_tree), None, Some(&mut opts))
            .map_err(|e| e.to_string())?,
        other => return Err(format!("unsupported head revision kind: {other}")),
    };

    // Rename/copy detection over the assembled deltas.
    let mut find = DiffFindOptions::new();
    find.renames(true).copies(true);
    diff.find_similar(Some(&mut find)).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for delta in diff.deltas() {
        let Some(status) = map_status(delta.status()) else {
            continue;
        };
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());

        // Deletions carry the path on the old side; everything else on the new.
        let path = new_path
            .clone()
            .or_else(|| old_path.clone())
            .unwrap_or_default();
        // Only surface `oldPath` when it genuinely differs (renames).
        let old_path = if status == "renamed" { old_path } else { None };

        out.push(ChangedFile {
            path,
            old_path,
            status: status.to_string(),
        });
    }

    Ok(out)
}

#[tauri::command]
pub fn read_file(repo_path: String, rev: Revision, path: String) -> Result<FileContent, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // `None` = the path does not exist on this side (added/removed).
    let data: Option<Vec<u8>> = match rev.kind.as_str() {
        // Empty baseline: nothing exists on this side.
        "empty" => None,
        "worktree" => {
            let workdir = repo.workdir().ok_or("repository has no working directory")?;
            match std::fs::read(workdir.join(&path)) {
                Ok(bytes) => Some(bytes),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => return Err(e.to_string()),
            }
        }
        "ref" => {
            let tree = rev_to_tree(&repo, &rev)?;
            match tree.get_path(Path::new(&path)) {
                Ok(entry) => {
                    let obj = entry.to_object(&repo).map_err(|e| e.to_string())?;
                    let blob = obj.as_blob().ok_or("path does not point to a blob")?;
                    Some(blob.content().to_vec())
                }
                Err(e) if e.code() == git2::ErrorCode::NotFound => None,
                Err(e) => return Err(e.to_string()),
            }
        }
        "index" => {
            let index = repo.index().map_err(|e| e.to_string())?;
            match index.get_path(Path::new(&path), 0) {
                Some(entry) => {
                    let blob = repo.find_blob(entry.id).map_err(|e| e.to_string())?;
                    Some(blob.content().to_vec())
                }
                None => None,
            }
        }
        other => return Err(format!("unsupported revision kind: {other}")),
    };

    Ok(match data {
        None => FileContent {
            bytes: None,
            binary: false,
        },
        Some(bytes) => {
            let binary = is_binary(&bytes);
            // Suppress bytes for binaries EXCEPT images under the size cap, so
            // the viewer can render an image diff.
            if binary && !(is_image(&path) && bytes.len() <= MAX_IMAGE_BYTES) {
                FileContent {
                    bytes: None,
                    binary: true,
                }
            } else {
                FileContent {
                    bytes: Some(BASE64_STANDARD.encode(&bytes)),
                    binary,
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // The parent directory (../ from src-tauri) is itself a git repo.
    const SELF_REPO: &str = "..";

    #[test]
    fn opens_self_repo() {
        let info = open_repo(SELF_REPO.to_string()).expect("should open parent repo");
        assert!(!info.head_ref.is_empty());
    }

    #[test]
    fn lists_uncommitted_changes() {
        // Skip when HEAD is unborn (a repo with no commits can't be diffed).
        let repo = Repository::open(SELF_REPO).expect("open self repo");
        if repo.head().is_err() {
            return;
        }
        let base = Revision {
            kind: "ref".into(),
            r#ref: Some("HEAD".into()),
        };
        let head = Revision {
            kind: "worktree".into(),
            r#ref: None,
        };
        // Should not error even when the tree is clean (empty vec is fine).
        list_changes(SELF_REPO.to_string(), base, head).expect("list_changes should succeed");
    }

    #[test]
    fn is_binary_detects_nul() {
        assert!(is_binary(b"abc\0def"));
        assert!(!is_binary(b"plain text"));
    }

    /// Two commits: verify history order/parent linkage and that a root commit
    /// diffs against the empty tree (all files added).
    #[test]
    fn history_and_root_commit_diff() {
        let dir = std::env::temp_dir().join(format!("diffview-hist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_str().unwrap().to_string();
        let repo = Repository::init(&dir).unwrap();
        let sig = git2::Signature::now("t", "t@t").unwrap();

        let commit_file = |name: &str, body: &[u8], msg: &str, parents: &[git2::Oid]| {
            std::fs::write(dir.join(name), body).unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(Path::new(name)).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let parent_commits: Vec<_> =
                parents.iter().map(|p| repo.find_commit(*p).unwrap()).collect();
            let refs: Vec<&git2::Commit> = parent_commits.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap()
        };

        let c1 = commit_file("a.txt", b"one\n", "first", &[]);
        commit_file("b.txt", b"two\n", "second", &[c1]);

        let commits = list_commits(path.clone(), 10).unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].summary, "second");
        assert_eq!(commits[1].summary, "first");
        assert_eq!(commits[0].parent.as_deref(), Some(commits[1].sha.as_str()));
        assert!(commits[1].parent.is_none()); // root commit

        // Root commit vs its (empty) baseline → a.txt is added.
        let root = &commits[1];
        let changes = list_changes(
            path.clone(),
            Revision { kind: "empty".into(), r#ref: None },
            Revision { kind: "ref".into(), r#ref: Some(root.sha.clone()) },
        )
        .unwrap();
        assert!(changes.iter().any(|c| c.path == "a.txt" && c.status == "added"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// End-to-end smoke test of the primary path: build a throwaway repo with
    /// one commit, then modify/add/delete files in the worktree and confirm
    /// `list_changes` + `read_file` report them correctly.
    #[test]
    fn tree_to_worktree_roundtrip() {
        let dir = std::env::temp_dir().join(format!("diffview-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_str().unwrap().to_string();

        let repo = Repository::init(&dir).unwrap();
        std::fs::write(dir.join("keep.txt"), b"original\n").unwrap();
        std::fs::write(dir.join("gone.txt"), b"delete me\n").unwrap();

        // Commit the two files.
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("keep.txt")).unwrap();
        index.add_path(Path::new("gone.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("t", "t@t").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        // Worktree edits: modify keep, delete gone, add fresh (untracked).
        std::fs::write(dir.join("keep.txt"), b"changed\n").unwrap();
        std::fs::remove_file(dir.join("gone.txt")).unwrap();
        std::fs::write(dir.join("fresh.txt"), b"brand new\n").unwrap();

        let base = Revision {
            kind: "ref".into(),
            r#ref: Some("HEAD".into()),
        };
        let head = Revision {
            kind: "worktree".into(),
            r#ref: None,
        };
        let changes = list_changes(path.clone(), base, head).unwrap();

        let by_path = |p: &str| changes.iter().find(|c| c.path == p);
        assert_eq!(by_path("keep.txt").unwrap().status, "modified");
        assert_eq!(by_path("gone.txt").unwrap().status, "removed");
        assert_eq!(by_path("fresh.txt").unwrap().status, "added");

        // Content lazily read from each side.
        let head_rev = Revision {
            kind: "worktree".into(),
            r#ref: None,
        };
        let base_rev = Revision {
            kind: "ref".into(),
            r#ref: Some("HEAD".into()),
        };
        let new = read_file(path.clone(), head_rev, "keep.txt".into()).unwrap();
        let old = read_file(path.clone(), base_rev, "keep.txt".into()).unwrap();
        assert_eq!(
            BASE64_STANDARD.decode(new.bytes.unwrap()).unwrap(),
            b"changed\n"
        );
        assert_eq!(
            BASE64_STANDARD.decode(old.bytes.unwrap()).unwrap(),
            b"original\n"
        );

        // Added file has no old side.
        let missing = read_file(
            path.clone(),
            Revision {
                kind: "ref".into(),
                r#ref: Some("HEAD".into()),
            },
            "fresh.txt".into(),
        )
        .unwrap();
        assert!(missing.bytes.is_none() && !missing.binary);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
