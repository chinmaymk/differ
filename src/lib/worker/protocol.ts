/** Message protocol between the main thread and the engine worker. */
import type { DiffEntry, FileDiff, SymbolKind } from '../engine/model';

/** A flattened, repo-index-only projection of a symbol — no line numbers,
 * hashes, or children, since nothing renders from this (dup-index.ts). */
export interface IndexedSymbol {
  name: string;
  kind: SymbolKind;
  fingerprint: number[];
}

export interface BuildRequest {
  type: 'build';
  id: number;
  entry: DiffEntry;
}

/** One file to extract symbols from for the repo-wide index (dup-index.ts). */
export interface IndexBatchFile {
  path: string;
  lang: string;
  source: string;
}

export interface IndexBatchRequest {
  type: 'index-batch';
  id: number;
  files: IndexBatchFile[];
}

export type WorkerRequest = BuildRequest | IndexBatchRequest;

export interface BuildResponse {
  type: 'build';
  id: number;
  result?: FileDiff;
  error?: string;
}

export interface IndexedFile {
  path: string;
  symbols: IndexedSymbol[];
}

export interface IndexBatchResponse {
  type: 'index-batch';
  id: number;
  result?: IndexedFile[];
  error?: string;
}

export type WorkerResponse = BuildResponse | IndexBatchResponse;
