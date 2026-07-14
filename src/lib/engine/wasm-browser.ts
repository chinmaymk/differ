/**
 * Browser/worker grammar source: fetches wasm from the served /wasm/ path
 * (Vite `public/wasm`, copied from @vscode/tree-sitter-wasm at build time).
 */
import { configureEngine } from './parser';

/** Configure the engine to fetch wasm from `base` (default "/wasm/"). */
export function useBrowserEngine(base = '/wasm/'): void {
  configureEngine({
    coreLocateFile: (file) => `${base}${file}`,
    loadGrammar: async (file) => {
      const res = await fetch(`${base}${file}`);
      if (!res.ok) {
        throw new Error(`Failed to load grammar ${file}: ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  });
}
