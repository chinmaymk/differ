/**
 * Engine worker: owns tree-sitter and runs the whole diff pipeline off the
 * main thread so the UI stays responsive. Only plain serializable `FileDiff`
 * objects cross back — never tree-sitter handles.
 */
/// <reference lib="webworker" />
// Must be first: neutralizes tree-sitter's eager script-URL detection in a
// module worker before the library is imported (transitively via build).
import './ts-env-shim';
import { buildFileDiff } from '../engine/build';
import { extractSymbols } from '../engine/extract';
import { useBrowserEngine } from '../engine/wasm-browser';
import type {
  WorkerRequest,
  WorkerResponse,
  IndexedFile,
  IndexBatchFile,
} from './protocol';

useBrowserEngine();

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Extract a flat, repo-index-only symbol list for each file, one at a
 * time — `extractSymbols` deletes its own parse `Tree` before returning, so
 * peak tree-sitter memory here is one file's tree at a time, not a batch. */
async function indexBatch(files: IndexBatchFile[]): Promise<IndexedFile[]> {
  const out: IndexedFile[] = [];
  for (const file of files) {
    const symbols = await extractSymbols(file.lang, file.source);
    out.push({
      path: file.path,
      symbols: flattenSymbols(symbols),
    });
  }
  return out;
}

function flattenSymbols(
  nodes: Awaited<ReturnType<typeof extractSymbols>>,
): IndexedFile['symbols'] {
  const out: IndexedFile['symbols'] = [];
  for (const n of nodes) {
    out.push({ name: n.name, kind: n.kind, fingerprint: n.fingerprint });
    out.push(...flattenSymbols(n.children));
  }
  return out;
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'build') {
    try {
      const result = await buildFileDiff(msg.entry);
      const res: WorkerResponse = { type: 'build', id: msg.id, result };
      ctx.postMessage(res);
    } catch (err) {
      const res: WorkerResponse = {
        type: 'build',
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(res);
    }
  } else if (msg.type === 'index-batch') {
    try {
      const result = await indexBatch(msg.files);
      const res: WorkerResponse = { type: 'index-batch', id: msg.id, result };
      ctx.postMessage(res);
    } catch (err) {
      const res: WorkerResponse = {
        type: 'index-batch',
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(res);
    }
  }
};
