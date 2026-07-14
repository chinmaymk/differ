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
import { useBrowserEngine } from '../engine/wasm-browser';
import type { WorkerRequest, WorkerResponse } from './protocol';

useBrowserEngine();

const ctx = self as unknown as DedicatedWorkerGlobalScope;

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
  }
};
