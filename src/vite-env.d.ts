/// <reference types="svelte" />
/// <reference types="vite/client" />

// The tree-sitter runtime ships as a plain JS file without types beyond the
// bundled .d.ts; declare the raw wasm imports we resolve at runtime instead.
declare module '*.wasm?url' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  /** Base URL of the headless server (`crates/server`), e.g.
   * "http://localhost:4420". When set, the app connects to it via
   * `HttpGitSource` instead of the Tauri desktop shell. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
