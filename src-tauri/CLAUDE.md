# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: this file covers the Tauri desktop shell only. For the frontend/engine and the
overall architecture (including the headless server shell), see the root `CLAUDE.md`. For
the actual git logic and its tests, see `crates/git-core` — this crate has neither.

## Commands

```bash
cargo test -p git-core   # run from repo root — the git logic + its tests live there, not here
cargo build              # this crate itself has nothing to unit test (see Architecture)
cargo clippy
```

`npm run tauri dev` / `npm run tauri build` (from repo root) drive the full desktop build; they
require the Rust toolchain and invoke `npm run dev`/`npm run build` as pre-steps per
`tauri.conf.json`.

## Architecture

This crate is a thin Tauri IPC shell — it has no diff/parsing/git logic and no tests of its
own. Every function in `git.rs` is a one-line `#[tauri::command]` wrapper delegating straight
into `crates/git-core`, e.g.:

```rust
#[tauri::command]
pub fn list_changes(repo_path: String, base: Revision, head: Revision) -> Result<Vec<ChangedFile>, String> {
    git_core::list_changes(repo_path, base, head)
}
```

This exists so the exact same git behavior is reachable from both this desktop shell (Tauri
IPC) and `crates/server` (headless HTTP) — see the root `CLAUDE.md`'s Architecture section for
the full picture. If you're changing what a command *does*, change it in `crates/git-core` and
add a test there; only touch `git.rs` for the command's IPC signature (adding/renaming a
parameter, registering a new command in `lib.rs`'s `invoke_handler!`).

A `Revision` is one of three `kind`s: `"ref"` (a commit-ish), `"worktree"` (working directory),
or `"index"` (staged changes only) — see `crates/git-core`'s module doc for the diff-selection
logic and the unstaged fast-path.

Rust struct fields are `snake_case` with `#[serde(rename_all = "camelCase")]`; they must stay in
sync with their TS counterparts by hand (`ChangedFile`, `Revision`, `FileContent`, `CommitInfo`,
`BranchInfo`, `TagInfo`, `WorktreeInfo` — "mirrors the TS X" comments in `crates/git-core/src/lib.rs`
point at the pairing). There's no shared schema, so a field renamed on one side silently breaks
IPC (and the HTTP API) on the other.

`lib.rs` is the Tauri entry point (`invoke_handler` registers every command in `git.rs`);
`main.rs` just calls into it — required so mobile targets can reuse the same lib crate.

## Notes

- `[profile.release]` lives in the **root** `Cargo.toml` (not this crate's), deliberately
  size-optimized (`opt-level = "z"`, LTO, `panic = "abort"`, stripped symbols) — a stated
  project requirement, not an oversight; don't "fix" it toward compile speed or unwinding
  support without checking with the user first. Cargo only honors `[profile.*]` at the
  workspace root, so it applies to `crates/server`'s release build too — see that root
  file's comment for the `panic = "abort"` implication there.
- All fallible paths return `Result<_, String>` (stringified git2/`git` errors) rather than
  panicking — user-triggered input (bad paths, missing revisions) must never unwrap/panic.
  This contract lives in `crates/git-core`; this crate just passes it through.
