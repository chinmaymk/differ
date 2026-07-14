/**
 * Tidy re-export of the diff-source contract types, so consumers can import
 * from `sources/source` without reaching into the engine model.
 */
export type {
  ChangedFile,
  DiffEntry,
  DiffSource,
  Revision,
} from '../engine/model';
