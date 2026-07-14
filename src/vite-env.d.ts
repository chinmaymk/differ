/// <reference types="svelte" />
/// <reference types="vite/client" />

// The tree-sitter runtime ships as a plain JS file without types beyond the
// bundled .d.ts; declare the raw wasm imports we resolve at runtime instead.
declare module '*.wasm?url' {
  const src: string;
  export default src;
}
