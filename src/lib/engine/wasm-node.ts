/**
 * Node/Vitest grammar source: reads wasm from the installed package on disk.
 * Used only by tests — the browser/worker uses a fetch-based source instead.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { configureEngine, type GrammarSource } from './parser';

const require = createRequire(import.meta.url);

/** Absolute path to @vscode/tree-sitter-wasm's wasm/ directory. */
export function wasmDir(): string {
  const pkg = require.resolve('@vscode/tree-sitter-wasm/package.json');
  return join(dirname(pkg), 'wasm');
}

export function nodeGrammarSource(): GrammarSource {
  const dir = wasmDir();
  return {
    coreLocateFile: (file) => join(dir, file),
    loadGrammar: async (file) => new Uint8Array(await readFile(join(dir, file))),
  };
}

/** Configure the engine for Node-based tests. Idempotent. */
export function useNodeEngine(): void {
  configureEngine(nodeGrammarSource());
}
