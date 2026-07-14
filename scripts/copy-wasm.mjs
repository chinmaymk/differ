// Copies the tree-sitter runtime + grammar wasm from the installed
// @vscode/tree-sitter-wasm package into public/wasm/ so Vite serves them at
// runtime. Grammars are fetched lazily per-language by the engine, but they
// must all be available as static assets. Runs on predev/prebuild.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm');
const dest = join(root, 'public', 'wasm');

if (!existsSync(src)) {
  console.error(
    `[copy-wasm] Source not found: ${src}\n` +
      `Run "npm install" first (installs @vscode/tree-sitter-wasm).`,
  );
  process.exit(1);
}

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

const files = (await readdir(dest)).filter((f) => f.endsWith('.wasm'));
console.log(`[copy-wasm] Copied ${files.length} wasm files to public/wasm/`);
