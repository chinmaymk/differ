// Tauri command wrappers around `git-core`. All actual git logic (libgit2
// access plus the `run_git` shell-outs for push/pull/revert/worktrees) lives
// in the shared `git-core` crate so the headless server (`crates/server`)
// can reuse it without duplicating anything here. See `git-core`'s own tests
// for coverage of the underlying behavior — this module is intentionally
// untested, it has no logic of its own beyond delegation.

use git_core::{BranchInfo, ChangedFile, CommitInfo, FileContent, HunkPatch, RepoInfo, Revision, TagInfo, WorktreeInfo};

/// Discover the git repository containing `start` and return its working-dir
/// path. Lets the desktop app auto-open the repo it was launched from.
#[tauri::command]
pub fn repo_root(start: Option<String>) -> Result<String, String> {
    git_core::repo_root(start)
}

#[tauri::command]
pub fn open_repo(path: String) -> Result<RepoInfo, String> {
    git_core::open_repo(path)
}

#[tauri::command]
pub fn list_commits(repo_path: String, limit: usize) -> Result<Vec<CommitInfo>, String> {
    git_core::list_commits(repo_path, limit)
}

#[tauri::command]
pub fn list_changes(
    repo_path: String,
    base: Revision,
    head: Revision,
) -> Result<Vec<ChangedFile>, String> {
    git_core::list_changes(repo_path, base, head)
}

#[tauri::command]
pub fn read_file(repo_path: String, rev: Revision, path: String) -> Result<FileContent, String> {
    git_core::read_file(repo_path, rev, path)
}

#[tauri::command]
pub fn list_all_files(repo_path: String, rev: Revision) -> Result<Vec<String>, String> {
    git_core::list_all_files(repo_path, rev)
}

/// Stage, unstage, or discard a single hunk exactly as rendered by the
/// frontend. `mode` is "stage" | "unstage" | "discard".
#[tauri::command]
pub fn apply_hunk(repo_path: String, path: String, hunk: HunkPatch, mode: String) -> Result<(), String> {
    git_core::apply_hunk(repo_path, path, hunk, mode)
}

#[tauri::command]
pub fn stage_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_core::stage_paths(repo_path, paths)
}

#[tauri::command]
pub fn unstage_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_core::unstage_paths(repo_path, paths)
}

#[tauri::command]
pub fn discard_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_core::discard_paths(repo_path, paths)
}

#[tauri::command]
pub fn commit(repo_path: String, message: String) -> Result<CommitInfo, String> {
    git_core::commit(repo_path, message)
}

#[tauri::command]
pub fn push(repo_path: String) -> Result<String, String> {
    git_core::push(repo_path)
}

#[tauri::command]
pub fn pull(repo_path: String) -> Result<String, String> {
    git_core::pull(repo_path)
}

#[tauri::command]
pub fn revert_commit(repo_path: String, sha: String) -> Result<CommitInfo, String> {
    git_core::revert_commit(repo_path, sha)
}

#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    git_core::list_branches(repo_path)
}

#[tauri::command]
pub fn list_tags(repo_path: String) -> Result<Vec<TagInfo>, String> {
    git_core::list_tags(repo_path)
}

#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    git_core::list_worktrees(repo_path)
}
