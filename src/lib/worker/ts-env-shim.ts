/**
 * MUST be imported before @vscode/tree-sitter-wasm.
 *
 * In a module Web Worker there is no `document`, and the library eagerly calls
 * an internal helper (`getCurrentScriptUrl`) at *import* time that throws
 * "Unable to determine script URL" when neither `document` nor Node's
 * `__filename` exist. We pass an explicit `locateFile` to `Parser.init`, so the
 * auto-detected script URL is never actually used — this shim just lets the
 * helper return `undefined` instead of throwing.
 *
 * Setting `document` (with a null `currentScript`) does not affect emscripten's
 * environment detection, which keys "web" off `typeof window` (still absent).
 */
const g = globalThis as unknown as { document?: unknown };
if (typeof g.document === 'undefined') {
  g.document = { currentScript: null };
}

export {};
