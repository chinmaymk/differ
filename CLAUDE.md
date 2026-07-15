# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev      # Vite dev server at http://localhost:1420 (browser demo mode)
npm test         # Vitest — engine unit + real-grammar integration tests (single run)
npm run test:watch
npm run check    # svelte-check type-check
npm run build    # type-check + production build to dist/
```

Run a single test file: `npx vitest run src/lib/engine/semantic-diff.test.ts`
Run tests matching a name: `npx vitest run -t "rename"`

`npm run dev` and `npm run build` both run `copy-wasm` first (via `predev`/`prebuild`),
which copies `@vscode/tree-sitter-wasm` grammars into `public/wasm/` — required for the
parser to work, do not skip it if wasm assets seem missing.

Desktop shell (requires Rust toolchain, not needed for engine/UI work):
```bash
npm run tauri dev
npm run tauri build
```

Headless server mode (requires Rust toolchain; lets multiple clients hit a shared repo
over HTTP instead of the desktop shell — see Architecture below):
```bash
cargo run -p server -- --repo <path-to-a-git-repo> [--port 4420]
VITE_API_BASE=http://localhost:4420 npm run dev   # point the frontend at it
```

Rust tests:
```bash
cargo test --workspace   # everything: git-core + server
cargo test -p git-core   # git behavior only (fast, no server/browser)
cargo test -p server     # HTTP wiring only (fast, no real port)
```

E2E (Playwright, against a real headless server + fixture repo — see Testing below):
```bash
npx playwright install chromium   # first-time browser install
npm run test:e2e
```

## Architecture

**Wasm-first.** The entire diff + parsing engine is TypeScript and runs in the frontend
(inside a Web Worker), so the same bundle works in a plain browser, inside the Tauri
desktop shell, and against the headless server below.

**Two deployment shells, one git implementation.** `crates/git-core` is the only place
that talks to git (`git2`/libgit2, plus a few `git` CLI shell-outs — see its module doc
for why). `src-tauri` (Tauri v2 desktop) and `crates/server` (headless axum HTTP server)
are both thin adapters over it — same functions, same behavior, different transport. A
git-behavior fix in `git-core` fixes both shells at once; neither shell has diffing logic
of its own.

```
Svelte + TS frontend (the whole product; runs in a browser too)
├─ UI: FileList, SemanticTree, RawDiff, FileDiffView   (progressive disclosure)
├─ Engine Web Worker  ── keeps the UI responsive
│   ├─ text-diff   Myers line diff (fast-myers-diff) + lazy word/char refinement
│   ├─ parser      tree-sitter init + lazy per-language grammar (LRU cache)
│   ├─ extract     symbol query → light SymbolNode tree (CST discarded)
│   ├─ semantic    scoped hierarchical matching → add/mod/rename/move/remove
│   └─ correlate   ties changed lines to their enclosing symbol
└─ DiffSource (pluggable): TauriGitSource (desktop), HttpGitSource (headless),
   MemorySource (demo/paste)
        │ Tauri IPC (desktop only)      │ HTTP (headless only)
   src-tauri/ (Tauri v2 shell)     crates/server/ (axum binary)
        └───────────────┬───────────────┘
                 crates/git-core/
     git2/libgit2 + `git` shell-outs: list_changes, read_file, apply_hunk,
     stage/unstage/discard, commit, push, pull, revert, branches/tags/worktrees
```

The headless server's repo path is fixed at startup (`--repo`) and never client-supplied
(avoids a path-traversal hole on a network-facing service); mutating endpoints serialize
through a write-lock so concurrent clients editing the same repo can't race the index.

The engine is **source-agnostic**: it consumes `(path, oldBytes, newBytes)` triples
(`DiffEntry`) and produces a `FileDiff`. `src/lib/engine/model.ts` is the full data model
and the contract every module builds against — read it first when touching the engine.
Coordinate conventions defined there: line numbers are 1-based inclusive; byte offsets
are 0-based half-open `[start, end)`; a symbol/hunk on only one side has `null` for the
other side.

### Semantic diff

Full tree-edit-distance is too slow/memory-heavy, so instead each side is parsed and a
per-language tree-sitter query extracts a light symbol tree. Matching is scoped and
second-chance:

1. Exact `(kind, name)` pairing within the same parent → unchanged / modified.
2. Rename: residual same-kind symbols with high body (Dice) similarity.
3. Move: a global pass over still-unmatched symbols across parents.

Per-language behavior is fully declarative in `src/lib/engine/languages.ts` (a
tree-sitter query + `@def.<kind>` capture convention). Languages with a symbol query get
semantic diff; the rest fall back to text-only. Adding semantic support for a new
language means adding a query there — no engine changes needed. Grammars come from
`@vscode/tree-sitter-wasm` (16 languages) and load lazily per file.

Semantic support today: TypeScript, TSX, JavaScript, Python, Go, Rust, Java, Ruby.
Others (C++, C#, PHP, CSS, Bash, PowerShell, INI) render as text diffs.

## Layout

```
src/lib/engine/    pure TS engine (no DOM): model, text-diff, parser, extract,
                   languages, semantic-diff, correlate, build
src/lib/worker/    engine Web Worker + main-thread client
src/lib/sources/   DiffSource providers (tauri-git, http-git, memory, samples)
src/lib/components/ Svelte UI
src-tauri/         Tauri v2 desktop shell (thin — delegates to crates/git-core)
crates/git-core/   shared git logic (git2 + `git` shell-outs) — the only crate with
                   tests for git behavior itself; both shells below depend on it
crates/server/     headless axum HTTP server (thin — delegates to crates/git-core)
e2e/               Playwright E2E suite — drives a real browser against crates/server
public/wasm/       tree-sitter core + grammars (copied from node_modules, gitignored)
```

## Testing

Four layers. Pick the outermost one that can actually catch the bug — don't duplicate
coverage a cheaper/faster layer already gives you:

1. **`npm test` (Vitest) — engine/UI logic in isolation.** Diff algorithms (text-diff,
   semantic-diff, extract, correlate, build), pure TS logic in `src/lib/components/*.ts`
   (fuzzy search, comparison revision math, file-tree grouping). No git repo, no browser.
   Fastest (~1s) — the default choice for new engine code.

2. **`cargo test -p git-core` — git behavior itself.** Anything touching real git
   semantics: diff correctness across revision kinds, hunk stage/unstage/discard
   splicing, rename/copy detection, commit/revert/branch/tag/worktree listing. Tests
   build throwaway repos under the OS temp dir with `git2::Repository::init` (see
   `init_repo_with_commit` for the shared-fixture pattern) — no server or browser needed.
   **A new or changed `list_changes`/`read_file`/`apply_hunk`/etc. behavior belongs here
   first** — it's fast, precise, and the fix covers both shells at once since they share
   this crate.

3. **`cargo test -p server` — HTTP wiring only, not git behavior.** A route maps to the
   right git-core function, request bodies decode, errors come back as
   `{"error": "..."}` with the right status, mutating endpoints serialize through the
   write-lock. Uses `tower::ServiceExt::oneshot` against an in-process router — no real
   port bound. Don't re-test git semantics here; that's git-core's job.

4. **`npm run test:e2e` (Playwright, `e2e/`) — real user flows through a real browser.**
   The file list renders the right status glyphs, clicking "Stage hunk" actually stages,
   the comparison picker actually switches what's shown, settings persist, push/pull
   round-trip against a real remote. This is the only layer that catches UI-wiring bugs
   (wrong selector, wrong event handler, a button disabled when it shouldn't be) — it's
   also the slowest (~15-20s for the full suite) and priciest to debug, so reach for it to
   prove the UI-action → server-call → UI-update loop works, not to re-verify git edge
   cases git-core already covers.

**Rule of thumb:** a new git operation needs a git-core test, not primarily an E2E one —
E2E just needs one or two happy-path assertions proving the UI wires it up, since
exhaustive edge-case coverage belongs in git-core. A UI-only feature (settings toggle,
keyboard shortcut, layout change) needs an E2E test, not a git-core one — there's no git
behavior to verify. Engine/algorithm changes belong in Vitest.

`e2e/` runs single-worker, sequentially, against ONE fixture repo shared across all spec
files (numbered `01-`…`08-` to fix execution order — Playwright sorts test files
alphabetically) — later files build on earlier ones' mutations (pull, then stage/commit,
then push). Don't add a spec file that assumes a different starting repo state without
checking what ran before it; extend `e2e/fixtures/build-fixture.mjs`'s shared fixture
instead of spinning up a second one, unless the scenario genuinely can't coexist (e.g. a
fully empty repo).

## Gotchas

- `@vscode/tree-sitter-wasm` eagerly detects its own script URL at import time, which
  throws in a module Web Worker. `src/lib/worker/ts-env-shim.ts` must be imported first
  to neutralize this; an explicit `locateFile` is passed anyway.
- Large files (> ~2 MB or > 50k lines) fall back to a coarse/text-only diff to keep the
  worker responsive; word/char refinement is computed per rendered hunk, not eagerly.
- tree-sitter `Tree` handles are wasm-heap objects, not GC'd — extraction code must
  always `.delete()` them. The grammar cache is LRU-capped.
- Playwright accessible-name pitfalls (bit both of these during E2E work): a `title`
  attribute is only used as the accessible name when the element has NO visible text/icon
  content — an icon-only button with `title="More actions"` needs `getByTitle(...)`, not
  `getByRole('button', {name: 'More actions'})`, which will just time out. Conversely
  `aria-label` always wins over visible content. Also: Svelte's per-component CSS
  scope-id class (`s-xxxxxxxx`) can coincidentally contain substrings like "on" — use a
  word-boundary regex (`/(^|\s)on(\s|$)/`) for `toHaveClass` checks, not a bare `/on/`.
