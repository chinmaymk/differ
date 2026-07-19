/**
 * A short-lived pool of dedicated engine workers used only for Story Mode's
 * repo-wide indexing pass. Separate from `EngineClient`'s single shared
 * worker (used for the normal one-file-at-a-time build flow) because
 * repo-wide indexing is a different workload: a bounded, one-shot,
 * CPU-bound batch job that benefits from real parallelism. Every pool
 * worker runs the exact same `engine.worker.ts` module and the same
 * `extractSymbols()` the per-file diff path already uses — parity with the
 * normal build path is true by construction, not by reimplementation.
 */
import type { IndexBatchFile, IndexedFile, WorkerRequest, WorkerResponse } from './protocol';

const MAX_POOL_SIZE = 8;

export class IndexWorkerPool {
  private workers: Worker[];
  private next = 0;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: IndexedFile[]) => void; reject: (e: Error) => void }
  >();

  constructor(
    size = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, MAX_POOL_SIZE)),
  ) {
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(new URL('./engine.worker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e);
      return w;
    });
  }

  private handleMessage(e: MessageEvent<WorkerResponse>): void {
    const { id, type } = e.data;
    if (type !== 'index-batch') return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result!);
  }

  /** Round-robins batches across the pool so all cores stay busy. */
  indexBatch(files: IndexBatchFile[]): Promise<IndexedFile[]> {
    const id = this.nextId++;
    const worker = this.workers[this.next++ % this.workers.length];
    return new Promise<IndexedFile[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req: WorkerRequest = { type: 'index-batch', id, files };
      worker.postMessage(req);
    });
  }

  dispose(): void {
    this.workers.forEach((w) => w.terminate());
    this.pending.clear();
  }
}
