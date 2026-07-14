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

## Architecture

**Wasm-first.** The entire diff + parsing engine is TypeScript and runs in the frontend
(inside a Web Worker), so the same bundle works in a plain browser and inside the Tauri
desktop shell. Tauri is only a thin Rust shell providing local git access
(`list_changes`, `read_file` in `src-tauri/src/git.rs`) — it has no diffing logic itself.

```
Svelte + TS frontend (the whole product; runs in a browser too)
├─ UI: FileList, SemanticTree, RawDiff, FileDiffView   (progressive disclosure)
├─ Engine Web Worker  ── keeps the UI responsive
│   ├─ text-diff   Myers line diff (fast-myers-diff) + lazy word/char refinement
│   ├─ parser      tree-sitter init + lazy per-language grammar (LRU cache)
│   ├─ extract     symbol query → light SymbolNode tree (CST discarded)
│   ├─ semantic    scoped hierarchical matching → add/mod/rename/move/remove
│   └─ correlate   ties changed lines to their enclosing symbol
└─ DiffSource (pluggable): TauriGitSource (local git), MemorySource (demo/paste)
        │ Tauri IPC (desktop only)
Tauri v2 Rust shell — git2/libgit2: list_changes, read_file
```

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
src/lib/sources/   DiffSource providers (tauri-git, memory, samples)
src/lib/components/ Svelte UI
src-tauri/         Rust shell (git2 commands)
public/wasm/       tree-sitter core + grammars (copied from node_modules, gitignored)
```

## Gotchas

- `@vscode/tree-sitter-wasm` eagerly detects its own script URL at import time, which
  throws in a module Web Worker. `src/lib/worker/ts-env-shim.ts` must be imported first
  to neutralize this; an explicit `locateFile` is passed anyway.
- Large files (> ~2 MB or > 50k lines) fall back to a coarse/text-only diff to keep the
  worker responsive; word/char refinement is computed per rendered hunk, not eagerly.
- tree-sitter `Tree` handles are wasm-heap objects, not GC'd — extraction code must
  always `.delete()` them. The grammar cache is LRU-capped.
