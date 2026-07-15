// Local-git data source (libgit2 via the `git2` crate, plus a few
// shell-outs to the system `git` binary — see `run_git`).
//
// IPC/transport-agnostic: every public function here takes plain
// args/paths and returns `Result<T, String>`, so it can be wrapped as
// Tauri commands (desktop, see `src-tauri/src/git.rs`) or HTTP handlers
// (headless server, see `crates/server`) without duplicating logic.
//
// All fallible paths return `Err(String)` (stringified git2 errors); no
// unwrap/panic on user-triggered input.

use std::path::Path;
use std::process::Command;

use base64::prelude::{Engine as _, BASE64_STANDARD};
use git2::build::CheckoutBuilder;
use git2::{Delta, DiffFindOptions, DiffOptions, ObjectType, Oid, Repository, StatusOptions, Tree};
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

/// A branch, local or remote (mirrors the TS `BranchInfo`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    name: String,
    is_head: bool,
    is_remote: bool,
    upstream: Option<String>,
    sha: String,
    short_sha: String,
}

/// A tag, lightweight or annotated (mirrors the TS `TagInfo`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    name: String,
    /// The commit the tag points at (peeled through an annotated tag object).
    sha: String,
    short_sha: String,
    /// The annotated tag's own message; `None` for a lightweight tag.
    message: Option<String>,
}

/// One entry from `git worktree list` (mirrors the TS `WorktreeInfo`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    path: String,
    branch: Option<String>,
    sha: Option<String>,
    short_sha: Option<String>,
    is_main: bool,
    is_locked: bool,
    is_prunable: bool,
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
    pub kind: String,
    /// For kind "ref": a commit-ish (sha, branch, tag, "HEAD").
    #[serde(rename = "ref")]
    pub r#ref: Option<String>,
}

/// One line within a hunk, as rendered by the frontend engine (mirrors the TS
/// `HunkPatch['lines'][number]`). `op` is "context" | "add" | "del".
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PatchLine {
    pub op: String,
    pub text: String,
}

/// A single hunk's exact content, sent verbatim from the frontend so Rust
/// never recomputes its own (possibly differently-bounded) diff — see
/// `splice_hunk`. Mirrors the TS `HunkPatch`.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HunkPatch {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<PatchLine>,
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

/// Build a `CommitInfo` for one commit oid. Shared by `list_commits` (reading
/// existing history) and `commit` (reporting the commit it just created).
fn commit_info(repo: &Repository, oid: Oid) -> Result<CommitInfo, String> {
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let sha = oid.to_string();
    let summary = commit.summary().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();
    let parent = commit.parent_id(0).ok().map(|p| p.to_string());
    Ok(CommitInfo {
        short_sha: sha.chars().take(7).collect(),
        sha,
        summary,
        author,
        timestamp,
        parent,
    })
}

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
        out.push(commit_info(&repo, oid.map_err(|e| e.to_string())?)?);
    }
    Ok(out)
}

pub fn list_changes(
    repo_path: String,
    base: Revision,
    head: Revision,
) -> Result<Vec<ChangedFile>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    let mut opts = DiffOptions::new();
    // Untracked files matter: a coding agent's brand-new files live here.
    opts.include_untracked(true).recurse_untracked_dirs(true);

    let mut diff = if base.kind == "index" && head.kind == "worktree" {
        // Unstaged-only changes: index vs working directory (`git diff`).
        repo.diff_index_to_workdir(None, Some(&mut opts))
            .map_err(|e| e.to_string())?
    } else {
        // The remaining combinations all have a ref/commit tree as `base`.
        let base_tree = rev_to_tree(&repo, &base)?;
        match head.kind.as_str() {
            // Combined uncommitted changes (staged and unstaged together).
            "worktree" => repo
                .diff_tree_to_workdir_with_index(Some(&base_tree), Some(&mut opts))
                .map_err(|e| e.to_string())?,
            // Commit/branch comparison: tree vs tree.
            "ref" => {
                let head_tree = rev_to_tree(&repo, &head)?;
                repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), Some(&mut opts))
                    .map_err(|e| e.to_string())?
            }
            // Staged-only changes: tree vs index (`git diff --cached`).
            "index" => repo
                .diff_tree_to_index(Some(&base_tree), None, Some(&mut opts))
                .map_err(|e| e.to_string())?,
            other => return Err(format!("unsupported head revision kind: {other}")),
        }
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

/// Split raw bytes into lines the same way the frontend engine's
/// `splitLines` does: split on `\n`, and a trailing newline does not produce
/// a spurious empty final "line". Returns the lines plus whether the input
/// ended with a newline — `splitLines` throws that fact away (identical
/// output for "a\nb\n" and "a\nb"), so `splice_hunk` has to recover it from
/// elsewhere (see its `eof_trailing_newline` argument) rather than assume it.
fn split_lines(bytes: &[u8]) -> (Vec<&[u8]>, bool) {
    if bytes.is_empty() {
        return (Vec::new(), false);
    }
    let mut lines: Vec<&[u8]> = bytes.split(|&b| b == b'\n').collect();
    let had_trailing = lines.last() == Some(&&b""[..]);
    if had_trailing {
        lines.pop();
    }
    (lines, had_trailing)
}

fn join_lines(lines: &[Vec<u8>], trailing_newline: bool) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        out.extend_from_slice(l);
        if i + 1 < lines.len() || trailing_newline {
            out.push(b'\n');
        }
    }
    out
}

/// Read a path's current content at the given repo-relative location. `None`
/// means the path doesn't exist there (untracked, unborn HEAD, deleted, …).
fn read_index_bytes(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let index = repo.index().map_err(|e| e.to_string())?;
    match index.get_path(Path::new(path), 0) {
        Some(entry) => Ok(Some(
            repo.find_blob(entry.id).map_err(|e| e.to_string())?.content().to_vec(),
        )),
        None => Ok(None),
    }
}

fn read_workdir_bytes(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let workdir = repo.workdir().ok_or("repository has no working directory")?;
    match std::fs::read(workdir.join(path)) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn read_head_bytes(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(None), // unborn HEAD: nothing committed yet
    };
    let tree = head.peel_to_tree().map_err(|e| e.to_string())?;
    match tree.get_path(Path::new(path)) {
        Ok(entry) => {
            let obj = entry.to_object(repo).map_err(|e| e.to_string())?;
            let blob = obj.as_blob().ok_or("path does not point to a blob")?;
            Ok(Some(blob.content().to_vec()))
        }
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Splice one hunk's exact content (verbatim from the frontend — see
/// `HunkPatch`) into `current`, by *position* (line count) rather than by
/// fuzzy content-matching. This is deliberately simpler than constructing a
/// textual patch and asking libgit2 to locate/apply it: it sidesteps a real
/// class of bugs there (unified-diff hunk-count parsing, `/dev/null`
/// new/deleted-file headers, and critically — `splitLines` can't tell "file
/// ends with a newline" from "it doesn't", so a synthesized patch could
/// silently add/drop a trailing newline the real file never had).
///
/// Before splicing, the targeted region of `current` is checked against what
/// the hunk expects to find there; a mismatch means the file changed since
/// this hunk was computed (e.g. an external edit raced the click) and is
/// reported as an error rather than silently applied wrong.
///
/// `reverse` undoes the hunk (unstage, discard) instead of applying it
/// forward (stage) — see `apply_hunk`. `eof_trailing_newline` is the
/// trailing-newline state of the *other* side (see `apply_hunk`), used only
/// when this hunk's replacement reaches the end of `current` — otherwise the
/// untouched tail of `current` already carries its own trailing-newline
/// state forward.
fn splice_hunk(
    current: &[u8],
    hunk: &HunkPatch,
    reverse: bool,
    eof_trailing_newline: bool,
) -> Result<Vec<u8>, String> {
    let (raw_lines, had_trailing) = split_lines(current);
    let mut lines: Vec<Vec<u8>> = raw_lines.iter().map(|l| l.to_vec()).collect();

    // context+del = the hunk's old-side content; context+add = new-side.
    let old_side: Vec<&[u8]> = hunk
        .lines
        .iter()
        .filter(|l| l.op != "add")
        .map(|l| l.text.as_bytes())
        .collect();
    let new_side: Vec<&[u8]> = hunk
        .lines
        .iter()
        .filter(|l| l.op != "del")
        .map(|l| l.text.as_bytes())
        .collect();

    // Forward (stage): `current` is the old side, replaced by the new side.
    // Reverse (unstage/discard): `current` is the new side, replaced by the
    // old side — undoing the hunk.
    let (start, count, expected, replacement) = if reverse {
        (hunk.new_start, hunk.new_lines, &new_side, &old_side)
    } else {
        (hunk.old_start, hunk.old_lines, &old_side, &new_side)
    };

    let idx = start.saturating_sub(1).min(lines.len());
    let end = (idx + count).min(lines.len());
    let touches_eof = end >= lines.len();

    let matches = end - idx == expected.len()
        && lines[idx..end].iter().map(Vec::as_slice).eq(expected.iter().copied());
    if !matches {
        return Err(
            "this hunk no longer matches the file — it changed since this diff was loaded; refresh and try again"
                .to_string(),
        );
    }

    let replacement_owned: Vec<Vec<u8>> = replacement.iter().map(|l| l.to_vec()).collect();
    lines.splice(idx..end, replacement_owned);

    let trailing_newline = if touches_eof { eof_trailing_newline } else { had_trailing };
    Ok(join_lines(&lines, trailing_newline))
}

fn ends_with_newline(bytes: &[u8]) -> bool {
    bytes.last() == Some(&b'\n')
}

/// Write `content` as a path's new index entry, creating the entry if the
/// path wasn't staged before (preserving its file mode if it already was).
fn write_index_blob(repo: &Repository, path: &str, content: &[u8]) -> Result<(), String> {
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let oid = repo.blob(content).map_err(|e| e.to_string())?;
    let mode = index
        .get_path(Path::new(path), 0)
        .map(|e| e.mode)
        .unwrap_or(0o100644);
    let entry = git2::IndexEntry {
        ctime: git2::IndexTime::new(0, 0),
        mtime: git2::IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: content.len() as u32,
        id: oid,
        flags: 0,
        flags_extended: 0,
        path: path.as_bytes().to_vec(),
    };
    index.add(&entry).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())
}

fn write_workdir_file(repo: &Repository, path: &str, content: &[u8]) -> Result<(), String> {
    let workdir = repo.workdir().ok_or("repository has no working directory")?;
    let full = workdir.join(path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, content).map_err(|e| e.to_string())
}

/// Stage, unstage, or discard a single hunk exactly as rendered by the
/// frontend (see `splice_hunk`). `mode` is "stage" | "unstage" | "discard".
pub fn apply_hunk(repo_path: String, path: String, hunk: HunkPatch, mode: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    match mode.as_str() {
        "stage" => {
            let current = read_index_bytes(&repo, &path)?.unwrap_or_default();
            let other_trailing = read_workdir_bytes(&repo, &path)?
                .map(|b| ends_with_newline(&b))
                .unwrap_or(true);
            let spliced = splice_hunk(&current, &hunk, false, other_trailing)?;
            write_index_blob(&repo, &path, &spliced)
        }
        "unstage" => {
            let current = read_index_bytes(&repo, &path)?.unwrap_or_default();
            let other_trailing = read_head_bytes(&repo, &path)?
                .map(|b| ends_with_newline(&b))
                .unwrap_or(true);
            let spliced = splice_hunk(&current, &hunk, true, other_trailing)?;
            write_index_blob(&repo, &path, &spliced)
        }
        "discard" => {
            let current = read_workdir_bytes(&repo, &path)?.unwrap_or_default();
            let index_bytes = read_index_bytes(&repo, &path)?;
            let other_trailing = index_bytes.as_ref().map(|b| ends_with_newline(b)).unwrap_or(true);
            let spliced = splice_hunk(&current, &hunk, true, other_trailing)?;
            if spliced.is_empty() && index_bytes.is_none() {
                // The hunk being discarded was this untracked file's entire
                // content — remove it rather than leave a 0-byte ghost.
                let workdir = repo.workdir().ok_or("repository has no working directory")?;
                let full = workdir.join(&path);
                if full.exists() {
                    std::fs::remove_file(&full).map_err(|e| e.to_string())?;
                }
                Ok(())
            } else {
                write_workdir_file(&repo, &path, &spliced)
            }
        }
        other => Err(format!("unsupported hunk mode: {other}")),
    }
}

/// Stage a batch of paths (`git add <paths>`). A path missing from the
/// working directory is treated as a deletion to stage.
pub fn stage_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("repository has no working directory")?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for path in &paths {
        if workdir.join(path).exists() {
            index.add_path(Path::new(path)).map_err(|e| e.to_string())?;
        } else {
            index.remove_path(Path::new(path)).map_err(|e| e.to_string())?;
        }
    }
    index.write().map_err(|e| e.to_string())
}

/// Unstage a batch of paths (`git reset -- <paths>`): resets their index
/// entries back to HEAD's version, or removes them from the index entirely
/// when HEAD is unborn or the path is new.
pub fn unstage_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let head_commit = match repo.head() {
        Ok(head) => Some(
            head.peel(ObjectType::Commit)
                .map_err(|e| e.to_string())?,
        ),
        Err(_) => None,
    };
    repo.reset_default(head_commit.as_ref(), paths.iter().map(String::as_str))
        .map_err(|e| e.to_string())
}

/// Discard uncommitted working-tree changes for a batch of paths (`git
/// checkout -- <paths>` / `git restore <paths>`). A path with no index entry
/// (untracked, never staged) is deleted outright rather than left in place —
/// matching how most git UIs treat "discard" on a brand-new file.
pub fn discard_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("repository has no working directory")?;
    let index = repo.index().map_err(|e| e.to_string())?;
    for path in &paths {
        if index.get_path(Path::new(path), 0).is_some() {
            let mut checkout = CheckoutBuilder::new();
            checkout.path(path.as_str()).force();
            repo.checkout_index(None, Some(&mut checkout))
                .map_err(|e| e.to_string())?;
        } else {
            let full = workdir.join(path);
            if full.exists() {
                std::fs::remove_file(&full).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Commit the current index as a new commit on HEAD, using the repo's
/// configured `user.name`/`user.email`.
pub fn commit(repo_path: String, message: String) -> Result<CommitInfo, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let sig = repo.signature().map_err(|e| e.to_string())?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    // Unborn HEAD (no commits yet) → this becomes a root commit.
    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;
    commit_info(&repo, oid)
}

/// Run a system `git` subcommand in `repo_path`, combining stdout+stderr and
/// trimming the result. Shells out to the system `git` binary rather than
/// libgit2 so operations like `push`/`pull`/`revert` reuse the user's own SSH
/// keys, credential helpers, merge/rebase config, and any interactive auth
/// exactly as their terminal git would — libgit2's own story for these is
/// notoriously fragile by comparison.
fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .trim()
    .to_string();
    if output.status.success() {
        Ok(combined)
    } else {
        Err(combined)
    }
}

/// Push the current branch (`git push`). See `run_git` for why this shells
/// out rather than using libgit2.
pub fn push(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["push"])
}

/// Pull the current branch (`git pull`), using whatever merge/rebase
/// strategy the repo/user already has configured rather than forcing one.
pub fn pull(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["pull"])
}

/// Revert one commit (`git revert --no-edit <sha>`), creating a new commit
/// that undoes it. Returns the newly created commit.
pub fn revert_commit(repo_path: String, sha: String) -> Result<CommitInfo, String> {
    run_git(&repo_path, &["revert", "--no-edit", &sha])?;
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let oid = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| e.to_string())?
        .id();
    commit_info(&repo, oid)
}

/// List local and remote branches. Symbolic-only refs with no direct target
/// (e.g. `origin/HEAD` pointing at `origin/main`) are skipped. Sorted with
/// the checked-out branch first, then local branches, then remotes,
/// alphabetically within each group.
pub fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, kind) = item.map_err(|e| e.to_string())?;
        let Some(target) = branch.get().target() else {
            continue;
        };
        let name = match branch.name() {
            Ok(Some(n)) => n.to_string(),
            _ => continue,
        };
        let is_head = branch.is_head();
        let is_remote = kind == git2::BranchType::Remote;
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(str::to_string));
        let sha = target.to_string();
        out.push(BranchInfo {
            name,
            is_head,
            is_remote,
            upstream,
            short_sha: sha.chars().take(7).collect(),
            sha,
        });
    }
    out.sort_by(|a, b| {
        (!a.is_head, a.is_remote, a.name.as_str()).cmp(&(!b.is_head, b.is_remote, b.name.as_str()))
    });
    Ok(out)
}

/// List tags, both lightweight and annotated. `git2::Repository::tag_names`
/// returns names in alphabetical order, which we keep as-is (same policy as
/// `list_branches`: no attempt at semver-aware ordering).
pub fn list_tags(repo_path: String) -> Result<Vec<TagInfo>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let names = repo.tag_names(None).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for name in names.iter().flatten() {
        let Ok(obj) = repo.revparse_single(name) else {
            continue;
        };
        // Annotated tags peel to the commit they point at; lightweight tags
        // already point directly at it. Tags on non-commit objects (rare —
        // a tagged blob/tree) are skipped since there's nothing to diff.
        let Ok(commit) = obj.peel_to_commit() else {
            continue;
        };
        let sha = commit.id().to_string();
        let message = obj.as_tag().and_then(|t| t.message()).map(str::to_string);
        out.push(TagInfo {
            name: name.to_string(),
            short_sha: sha.chars().take(7).collect(),
            sha,
            message,
        });
    }
    Ok(out)
}

/// List worktrees (`git worktree list --porcelain`). The main worktree is
/// always the first entry in porcelain output. Shells out (see `run_git`)
/// rather than using git2's worktree API, which doesn't expose lock/prune
/// state as directly.
pub fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    let raw = run_git(&repo_path, &["worktree", "list", "--porcelain"])?;
    let mut out = Vec::new();
    let mut cur: Option<WorktreeInfo> = None;
    for line in raw.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(w) = cur.take() {
                out.push(w);
            }
            cur = Some(WorktreeInfo {
                path: path.to_string(),
                branch: None,
                sha: None,
                short_sha: None,
                is_main: out.is_empty(),
                is_locked: false,
                is_prunable: false,
            });
        } else if let Some(sha) = line.strip_prefix("HEAD ") {
            if let Some(w) = cur.as_mut() {
                w.short_sha = Some(sha.chars().take(7).collect());
                w.sha = Some(sha.to_string());
            }
        } else if let Some(branch_ref) = line.strip_prefix("branch ") {
            if let Some(w) = cur.as_mut() {
                w.branch = Some(branch_ref.trim_start_matches("refs/heads/").to_string());
            }
        } else if line.starts_with("locked") {
            if let Some(w) = cur.as_mut() {
                w.is_locked = true;
            }
        } else if line.starts_with("prunable") {
            if let Some(w) = cur.as_mut() {
                w.is_prunable = true;
            }
        }
    }
    if let Some(w) = cur.take() {
        out.push(w);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two levels up from `crates/git-core` is the repo root, itself a git repo.
    const SELF_REPO: &str = "../..";

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

    /// Shared setup for the write-command tests: a throwaway repo with
    /// `committed.txt` = "one\ntwo\nthree\n" already committed.
    fn init_repo_with_commit(tag: &str) -> (std::path::PathBuf, Repository) {
        let dir = std::env::temp_dir().join(format!("diffview-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();
        std::fs::write(dir.join("committed.txt"), b"one\ntwo\nthree\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("committed.txt")).unwrap();
        index.write().unwrap();
        {
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let sig = git2::Signature::now("t", "t@t").unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        (dir, repo)
    }

    #[test]
    fn unstaged_only_excludes_staged_changes() {
        let (dir, repo) = init_repo_with_commit("unstaged-only");
        let path = dir.to_str().unwrap().to_string();

        // Stage one edit, then pile an unstaged edit on top, plus a fresh
        // untracked file.
        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("committed.txt")).unwrap();
        index.write().unwrap();
        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nTHREE\n").unwrap();
        std::fs::write(dir.join("untracked.txt"), b"new\n").unwrap();

        let unstaged = list_changes(
            path.clone(),
            Revision { kind: "index".into(), r#ref: None },
            Revision { kind: "worktree".into(), r#ref: None },
        )
        .unwrap();
        let unstaged_paths: Vec<_> = unstaged.iter().map(|c| c.path.as_str()).collect();
        assert!(unstaged_paths.contains(&"committed.txt"));
        assert!(unstaged_paths.contains(&"untracked.txt"));

        let staged = list_changes(
            path,
            Revision { kind: "ref".into(), r#ref: Some("HEAD".into()) },
            Revision { kind: "index".into(), r#ref: None },
        )
        .unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].path, "committed.txt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stage_unstage_discard_paths_roundtrip() {
        let (dir, _repo) = init_repo_with_commit("paths");
        let path = dir.to_str().unwrap().to_string();

        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree\n").unwrap();
        std::fs::write(dir.join("new.txt"), b"brand new\n").unwrap();

        stage_paths(path.clone(), vec!["committed.txt".into(), "new.txt".into()]).unwrap();
        let staged = list_changes(
            path.clone(),
            Revision { kind: "ref".into(), r#ref: Some("HEAD".into()) },
            Revision { kind: "index".into(), r#ref: None },
        )
        .unwrap();
        assert_eq!(staged.len(), 2);

        unstage_paths(path.clone(), vec!["committed.txt".into(), "new.txt".into()]).unwrap();
        let staged_after = list_changes(
            path.clone(),
            Revision { kind: "ref".into(), r#ref: Some("HEAD".into()) },
            Revision { kind: "index".into(), r#ref: None },
        )
        .unwrap();
        assert!(staged_after.is_empty());
        // Unstaging a never-committed file drops it from the index but
        // leaves it on disk, untracked.
        assert!(dir.join("new.txt").exists());

        discard_paths(path.clone(), vec!["committed.txt".into()]).unwrap();
        assert_eq!(std::fs::read(dir.join("committed.txt")).unwrap(), b"one\ntwo\nthree\n");

        discard_paths(path.clone(), vec!["new.txt".into()]).unwrap();
        assert!(!dir.join("new.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_hunk_stage_then_unstage_then_discard() {
        let (dir, _repo) = init_repo_with_commit("hunk");
        let path = dir.to_str().unwrap().to_string();
        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree\n").unwrap();

        let hunk = HunkPatch {
            old_start: 1,
            old_lines: 3,
            new_start: 1,
            new_lines: 3,
            lines: vec![
                PatchLine { op: "context".into(), text: "one".into() },
                PatchLine { op: "del".into(), text: "two".into() },
                PatchLine { op: "add".into(), text: "TWO".into() },
                PatchLine { op: "context".into(), text: "three".into() },
            ],
        };

        // Stage: the index picks up the workdir's "TWO".
        apply_hunk(path.clone(), "committed.txt".into(), hunk.clone(), "stage".into()).unwrap();
        let staged = read_file(
            path.clone(),
            Revision { kind: "index".into(), r#ref: None },
            "committed.txt".into(),
        )
        .unwrap();
        assert_eq!(
            BASE64_STANDARD.decode(staged.bytes.unwrap()).unwrap(),
            b"one\nTWO\nthree\n"
        );
        let unstaged = list_changes(
            path.clone(),
            Revision { kind: "index".into(), r#ref: None },
            Revision { kind: "worktree".into(), r#ref: None },
        )
        .unwrap();
        assert!(unstaged.iter().all(|c| c.path != "committed.txt"));

        // Unstage: the index reverts to HEAD's "two"; the workdir is untouched.
        apply_hunk(path.clone(), "committed.txt".into(), hunk.clone(), "unstage".into()).unwrap();
        let index_after_unstage = read_file(
            path.clone(),
            Revision { kind: "index".into(), r#ref: None },
            "committed.txt".into(),
        )
        .unwrap();
        assert_eq!(
            BASE64_STANDARD.decode(index_after_unstage.bytes.unwrap()).unwrap(),
            b"one\ntwo\nthree\n"
        );
        assert_eq!(std::fs::read(dir.join("committed.txt")).unwrap(), b"one\nTWO\nthree\n");

        // Discard: the workdir reverts to the index's "two".
        apply_hunk(path.clone(), "committed.txt".into(), hunk, "discard".into()).unwrap();
        assert_eq!(std::fs::read(dir.join("committed.txt")).unwrap(), b"one\ntwo\nthree\n");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A hunk that IS an entire brand-new (untracked) file — the "old side
    /// doesn't exist" case, inferred from an empty current-content read
    /// rather than a client-supplied flag. Stage and discard are exercised
    /// in separate repos: once a whole-new-file hunk is staged, it's no
    /// longer part of the *unstaged* diff, so the real UI would never offer
    /// that same hunk for discarding — a fresh untracked file is the
    /// realistic discard scenario.
    #[test]
    fn apply_hunk_whole_new_file_stage() {
        let (dir, _repo) = init_repo_with_commit("hunk-new-stage");
        let path = dir.to_str().unwrap().to_string();
        std::fs::write(dir.join("new.txt"), b"alpha\nbeta\n").unwrap();

        let hunk = HunkPatch {
            old_start: 1,
            old_lines: 0,
            new_start: 1,
            new_lines: 2,
            lines: vec![
                PatchLine { op: "add".into(), text: "alpha".into() },
                PatchLine { op: "add".into(), text: "beta".into() },
            ],
        };

        apply_hunk(path.clone(), "new.txt".into(), hunk, "stage".into()).unwrap();
        let staged = read_file(
            path,
            Revision { kind: "index".into(), r#ref: None },
            "new.txt".into(),
        )
        .unwrap();
        assert_eq!(
            BASE64_STANDARD.decode(staged.bytes.unwrap()).unwrap(),
            b"alpha\nbeta\n"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_hunk_whole_new_file_discard_deletes_it() {
        let (dir, _repo) = init_repo_with_commit("hunk-new-discard");
        let path = dir.to_str().unwrap().to_string();
        std::fs::write(dir.join("new.txt"), b"alpha\nbeta\n").unwrap();

        let hunk = HunkPatch {
            old_start: 1,
            old_lines: 0,
            new_start: 1,
            new_lines: 2,
            lines: vec![
                PatchLine { op: "add".into(), text: "alpha".into() },
                PatchLine { op: "add".into(), text: "beta".into() },
            ],
        };

        // Discarding an untracked file's whole-file hunk removes it from the
        // workdir entirely, rather than leaving a 0-byte ghost.
        apply_hunk(path, "new.txt".into(), hunk, "discard".into()).unwrap();
        assert!(!dir.join("new.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression test: a hunk that reaches the last line of a file which
    /// has NO trailing newline must not gain one when staged. `splitLines`
    /// (mirrored here) can't tell "ends with \n" from "doesn't" just from
    /// the line array, which is exactly the bug this guards against.
    #[test]
    fn apply_hunk_preserves_missing_trailing_newline() {
        let (dir, repo) = init_repo_with_commit("hunk-no-eof-nl");
        let path = dir.to_str().unwrap().to_string();

        // committed.txt has no trailing newline in the workdir edit, and the
        // hunk's last line ("three") is genuinely the file's last line.
        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree").unwrap();

        let hunk = HunkPatch {
            old_start: 1,
            old_lines: 3,
            new_start: 1,
            new_lines: 3,
            lines: vec![
                PatchLine { op: "context".into(), text: "one".into() },
                PatchLine { op: "del".into(), text: "two".into() },
                PatchLine { op: "add".into(), text: "TWO".into() },
                PatchLine { op: "context".into(), text: "three".into() },
            ],
        };
        apply_hunk(path.clone(), "committed.txt".into(), hunk, "stage".into()).unwrap();

        let staged = read_file(
            path,
            Revision { kind: "index".into(), r#ref: None },
            "committed.txt".into(),
        )
        .unwrap();
        assert_eq!(
            BASE64_STANDARD.decode(staged.bytes.unwrap()).unwrap(),
            b"one\nTWO\nthree",
        );

        let _ = std::fs::remove_dir_all(&dir);
        let _ = repo; // keep the commit alive for the duration of the test
    }

    /// A hunk whose expected content no longer matches the file (e.g. it was
    /// externally edited after the diff was computed) must fail loudly
    /// rather than silently splice in the wrong place.
    #[test]
    fn apply_hunk_rejects_stale_content() {
        let (dir, _repo) = init_repo_with_commit("hunk-stale");
        let path = dir.to_str().unwrap().to_string();
        // "stage" mode's target is the INDEX, so make the index (not just the
        // workdir) diverge from what the hunk (built against "two") expects —
        // as if someone else already staged a different edit to this file.
        std::fs::write(dir.join("committed.txt"), b"one\nDIFFERENT\nthree\n").unwrap();
        stage_paths(path.clone(), vec!["committed.txt".into()]).unwrap();

        let hunk = HunkPatch {
            old_start: 1,
            old_lines: 3,
            new_start: 1,
            new_lines: 3,
            lines: vec![
                PatchLine { op: "context".into(), text: "one".into() },
                PatchLine { op: "del".into(), text: "two".into() },
                PatchLine { op: "add".into(), text: "TWO".into() },
                PatchLine { op: "context".into(), text: "three".into() },
            ],
        };
        let err = apply_hunk(path, "committed.txt".into(), hunk, "stage".into()).unwrap_err();
        assert!(err.contains("no longer matches"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A hunk deep inside a large, multi-hunk file — regression coverage for
    /// an earlier bug where a synthesized unified-diff patch and libgit2's
    /// own apply disagreed on non-trivial files.
    #[test]
    fn apply_hunk_deep_in_large_multi_hunk_file() {
        let dir = std::env::temp_dir().join(format!("diffview-hunk-deep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();

        let mut orig = String::new();
        for i in 1..=250 {
            orig.push_str(&format!("line {i}\n"));
        }
        std::fs::write(dir.join("big.txt"), &orig).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("big.txt")).unwrap();
        index.write().unwrap();
        {
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let sig = git2::Signature::now("t", "t@t").unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }

        // Two independent unstaged edits: one near line 50, one near line 200.
        let mut lines: Vec<String> = orig.lines().map(|s| s.to_string()).collect();
        lines[49] = "line 50 CHANGED".to_string();
        lines[199] = "line 200 CHANGED".to_string();
        std::fs::write(dir.join("big.txt"), lines.join("\n") + "\n").unwrap();

        let path = dir.to_str().unwrap().to_string();

        // The second hunk only (context=3 around line 200).
        let hunk = HunkPatch {
            old_start: 197,
            old_lines: 6,
            new_start: 197,
            new_lines: 6,
            lines: vec![
                PatchLine { op: "context".into(), text: "line 197".into() },
                PatchLine { op: "context".into(), text: "line 198".into() },
                PatchLine { op: "context".into(), text: "line 199".into() },
                PatchLine { op: "del".into(), text: "line 200".into() },
                PatchLine { op: "add".into(), text: "line 200 CHANGED".into() },
                PatchLine { op: "context".into(), text: "line 201".into() },
                PatchLine { op: "context".into(), text: "line 202".into() },
            ],
        };
        apply_hunk(path.clone(), "big.txt".into(), hunk, "stage".into()).unwrap();

        let staged = read_file(
            path,
            Revision { kind: "index".into(), r#ref: None },
            "big.txt".into(),
        )
        .unwrap();
        let content = BASE64_STANDARD.decode(staged.bytes.unwrap()).unwrap();
        let staged_lines: Vec<&str> = std::str::from_utf8(&content).unwrap().lines().collect();
        // Only line 200 (the staged hunk) changed; line 50 is still unstaged.
        assert_eq!(staged_lines[199], "line 200 CHANGED");
        assert_eq!(staged_lines[49], "line 50");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn commit_creates_commit_from_index() {
        let (dir, repo) = init_repo_with_commit("commit");
        let path = dir.to_str().unwrap().to_string();

        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("committed.txt")).unwrap();
        index.write().unwrap();

        // Deterministic signature regardless of the host's git config.
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Test User").unwrap();
            config.set_str("user.email", "test@example.com").unwrap();
        }

        let info = commit(path.clone(), "second commit".to_string()).unwrap();
        assert_eq!(info.summary, "second commit");
        assert!(info.parent.is_some());

        let staged = list_changes(
            path,
            Revision { kind: "ref".into(), r#ref: Some("HEAD".into()) },
            Revision { kind: "index".into(), r#ref: None },
        )
        .unwrap();
        assert!(staged.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_branches_marks_current_branch_as_head() {
        let (dir, repo) = init_repo_with_commit("branches");
        let path = dir.to_str().unwrap().to_string();
        let head_name = repo.head().unwrap().shorthand().unwrap().to_string();

        let branches = list_branches(path).unwrap();
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, head_name);
        assert!(branches[0].is_head);
        assert!(!branches[0].is_remote);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_tags_lists_lightweight_and_annotated() {
        let (dir, repo) = init_repo_with_commit("tags");
        let path = dir.to_str().unwrap().to_string();
        let head_oid = repo.head().unwrap().target().unwrap();
        let head_obj = repo.find_object(head_oid, None).unwrap();

        repo.tag_lightweight("v1", &head_obj, false).unwrap();
        let sig = git2::Signature::now("t", "t@t").unwrap();
        repo.tag("v2-annotated", &head_obj, &sig, "release notes", false)
            .unwrap();

        let tags = list_tags(path).unwrap();
        assert_eq!(tags.len(), 2);

        let v1 = tags.iter().find(|t| t.name == "v1").unwrap();
        assert_eq!(v1.sha, head_oid.to_string());
        assert!(v1.message.is_none());

        let v2 = tags.iter().find(|t| t.name == "v2-annotated").unwrap();
        assert_eq!(v2.sha, head_oid.to_string());
        assert_eq!(v2.message.as_deref(), Some("release notes"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_worktrees_includes_main_worktree() {
        let (dir, _repo) = init_repo_with_commit("worktrees");
        let path = dir.to_str().unwrap().to_string();

        let worktrees = list_worktrees(path).unwrap();
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_main);
        assert_eq!(
            std::fs::canonicalize(&worktrees[0].path).unwrap(),
            std::fs::canonicalize(&dir).unwrap()
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn revert_commit_restores_previous_content() {
        let (dir, repo) = init_repo_with_commit("revert");
        let path = dir.to_str().unwrap().to_string();
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Test User").unwrap();
            config.set_str("user.email", "test@example.com").unwrap();
        }

        std::fs::write(dir.join("committed.txt"), b"one\nTWO\nthree\n").unwrap();
        stage_paths(path.clone(), vec!["committed.txt".into()]).unwrap();
        let second = commit(path.clone(), "change two".to_string()).unwrap();

        let reverted = revert_commit(path.clone(), second.sha.clone()).unwrap();
        assert!(reverted.summary.starts_with("Revert"));
        assert_eq!(reverted.parent.as_deref(), Some(second.sha.as_str()));
        assert_eq!(
            std::fs::read(dir.join("committed.txt")).unwrap(),
            b"one\ntwo\nthree\n"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pull_without_remote_returns_error() {
        let (dir, _repo) = init_repo_with_commit("pull-no-remote");
        let path = dir.to_str().unwrap().to_string();
        let err = pull(path).unwrap_err();
        assert!(!err.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
