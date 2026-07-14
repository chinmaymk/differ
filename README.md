# Diff Viewer

A fast diff viewer that shows both a **raw text diff** (line / word / char) and a
**semantic diff** (which functions, classes, methods, etc. were added, removed,
modified, moved, or renamed), with **progressive disclosure** — drill from a
file down to a symbol down to the exact changed lines.

Built for two uses that share one engine:
1. Reviewing changes made by independent coding agents (local git working tree).
2. Viewing PR / commit diffs in a browser.

## Architecture

**Wasm-first.** The entire diff + parsing engine is TypeScript and runs in the
frontend (in a Web Worker), so the same bundle works in a plain browser and
inside the Tauri desktop shell. Tauri is a thin Rust shell that only provides
local git access.

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

The engine is **source-agnostic**: it consumes `(path, oldBytes, newBytes)`
triples (`DiffEntry`) and produces a `FileDiff`. See `src/lib/engine/model.ts`
for the full data model — it is the contract every module builds against.

### Semantic diff

Rather than full tree-edit-distance (too slow/memory-heavy), each side is parsed
and a per-language tree-sitter query extracts a light symbol tree. Matching is
scoped and second-chance:

1. Exact `(kind, name)` pairing within the same parent → unchanged / modified.
2. Rename: residual same-kind symbols with high body (Dice) similarity.
3. Move: a global pass over still-unmatched symbols across parents.

Per-language behavior is fully declarative in `src/lib/engine/languages.ts`
(a tree-sitter query + `@def.<kind>` capture convention). Languages with a
symbol query get semantic diff; the rest fall back to text-only. Grammars come
from `@vscode/tree-sitter-wasm` (16 languages) and are loaded lazily per file.

Semantic support today: TypeScript, TSX, JavaScript, Python, Go, Rust, Java,
Ruby. Others (C++, C#, PHP, CSS, Bash, PowerShell, INI) render as text diffs and
can gain semantics by adding a query — no engine changes needed.

## Develop

```bash
npm install
npm run dev      # Vite dev server at http://localhost:1420 (browser demo mode)
npm test         # Vitest — engine unit + real-grammar integration tests
npm run check    # svelte-check type-check
npm run build    # type-check + production build to dist/
```

Open the **Demo** to see the text + semantic diff without a backend.

### Desktop (Tauri)

```bash
npm run tauri dev     # requires the Rust toolchain
npm run tauri build   # size-optimized release build
```

In desktop mode, enter a repository path to view its uncommitted (working-tree)
changes against `HEAD`.

## Layout

```
src/lib/engine/    pure TS engine (no DOM): model, text-diff, parser, extract,
                   languages, semantic-diff, correlate, build
src/lib/worker/    engine Web Worker + main-thread client
src/lib/sources/   DiffSource providers (tauri-git, memory, samples)
src/lib/components/ Svelte UI
src-tauri/         Rust shell (git2 commands)
public/wasm/       tree-sitter core + grammars (copied from node_modules)
```

## Notes

- `@vscode/tree-sitter-wasm` eagerly detects its own script URL at import time,
  which throws in a module Web Worker. `src/lib/worker/ts-env-shim.ts` is
  imported first to neutralize this; we pass an explicit `locateFile` anyway.
- Large files (> ~2 MB or > 50k lines) fall back to a coarse/text-only diff to
  keep the worker responsive; word/char refinement is computed per rendered
  hunk, not eagerly.
- tree-sitter `Tree` handles are wasm-heap objects (not GC'd); extraction always
  `.delete()`s them, and the grammar cache is LRU-capped.
