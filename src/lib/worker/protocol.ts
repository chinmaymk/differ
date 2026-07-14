/** Message protocol between the main thread and the engine worker. */
import type { DiffEntry, FileDiff } from '../engine/model';

export interface BuildRequest {
  type: 'build';
  id: number;
  entry: DiffEntry;
}

export type WorkerRequest = BuildRequest;

export interface BuildResponse {
  type: 'build';
  id: number;
  result?: FileDiff;
  error?: string;
}

export type WorkerResponse = BuildResponse;
