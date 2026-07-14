/**
 * Main-thread client for the engine worker: a promise-based request/response
 * wrapper with a small concurrency limit so a large changeset doesn't flood
 * the worker. One worker instance is shared app-wide.
 */
import type { DiffEntry, FileDiff } from '../engine/model';
import type { WorkerResponse } from './protocol';

export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: FileDiff) => void; reject: (e: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(
      new URL('./engine.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result!);
    };
  }

  /** Build the full diff model for one file. */
  build(entry: DiffEntry): Promise<FileDiff> {
    const id = this.nextId++;
    return new Promise<FileDiff>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Transfer the byte buffers to avoid a copy.
      const transfer: Transferable[] = [];
      if (entry.oldBytes) transfer.push(entry.oldBytes.buffer);
      if (entry.newBytes) transfer.push(entry.newBytes.buffer);
      this.worker.postMessage({ type: 'build', id, entry }, transfer);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
