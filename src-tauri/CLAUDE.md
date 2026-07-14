# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: this file covers the Rust shell only. For the frontend/engine, see the root `CLAUDE.md`.

## Commands

```bash
cargo test              # run from src-tauri/ — unit + integration tests in git.rs
cargo test <name>       # run a single test, e.g. cargo test tree_to_worktree_roundtrip
cargo clippy
cargo build
```

Tests in `git.rs` build throwaway repos under the OS temp dir with `git2`/`Repository::init`
(no fixture files needed), and one test opens `..` (this repo itself) as a sanity check — run
`cargo test` from inside a git checkout, not an extracted tarball.

`npm run tauri dev` / `npm run tauri build` (from repo root) drive the full desktop build; they
require the Rust toolchain and invoke `npm run dev`/`npm run build` as pre-steps per
`tauri.conf.json`.

## Architecture

This crate is a thin IPC shell, not where diffing happens — it has no diff/parsing logic.
`git.rs` exposes three Tauri commands, **metadata-first with lazy content**, so the frontend
can render a file list before fetching any file bodies:

- `list_changes(repo_path, base, head)` — changed-file metadata (path, status, rename source)
  between two `Revision`s, via `git2` tree/workdir/index diffs.
- `read_file(repo_path, rev, path)` — one file's bytes at one revision, base64-encoded for the
  IPC boundary (see `FileContent`).
- `open_repo` / `repo_root` / `list_commits` — repo validation, discovery from a start path, and
  commit history.

A `Revision` is one of three `kind`s: `"ref"` (a commit-ish), `"worktree"` (working directory,
diffed via `diff_tree_to_workdir_with_index` so untracked files are included), or `"index"`
(staged changes only). An unborn HEAD (no commits yet) is treated as an empty tree rather than
an error, so a brand-new repo's working-tree files show up as "added" — see `empty_tree` /
`rev_to_tree`.

Rust struct fields are `snake_case` with `#[serde(rename_all = "camelCase")]`; they must stay in
sync with their TS counterparts by hand (`ChangedFile`, `Revision`, `FileContent`, `CommitInfo` —
"mirrors the TS X" comments in `git.rs` point at the pairing). There's no shared schema, so a
field renamed on one side silently breaks IPC on the other.

Binary/image handling: `read_file` suppresses bytes for detected-binary files (NUL byte in the
first 8KB) *except* images under `MAX_IMAGE_BYTES` (12 MB), which are still shipped so the
frontend's image-diff view can render them.

`lib.rs` is the Tauri entry point (`invoke_handler` registers the commands above);
`main.rs` just calls into it — required so mobile targets can reuse the same lib crate.

## Notes

- `[profile.release]` in `Cargo.toml` is deliberately size-optimized (`opt-level = "z"`, LTO,
  `panic = "abort"`, stripped symbols) — a stated project requirement, not an oversight; don't
  "fix" it toward compile speed or unwinding support without checking with the user first.
- All fallible paths return `Result<_, String>` (stringified git2 errors) rather than
  panicking — user-triggered input (bad paths, missing revisions) must never unwrap/panic.
