/**
 * Repo-wide index for Story Mode's duplicate-code and blast-radius signals.
 * Built once per Story Mode session via a short-lived worker pool
 * (`IndexWorkerPool`) so tree-sitter extraction runs in parallel across
 * cores; see the plan doc for the full design rationale.
 *
 * Streaming discipline: source text is decoded per batch, tokenized and
 * handed to the worker pool, then dropped — nothing here retains full file
 * contents. Only two compact structures survive: `entries` (one small
 * fingerprint per indexed symbol) and `identifierIndex` (word -> fileset).
 */
import type { DiffSource, Revision } from './model';
import { detectLang, hasSemantics } from './languages';
import { IndexWorkerPool } from '../worker/index-pool';
import type { IndexedSymbol } from '../worker/protocol';

export type { IndexedSymbol };

export const MAX_INDEX_FILES = 4000;
export const MAX_INDEX_BYTES = 60 * 1024 * 1024; // running total of bytes *read*, not retained
export const BATCH_SIZE = 40; // per dispatch to one pool worker
export const MIN_FINGERPRINT_LINES = 4;
export const MIN_IDENTIFIER_LEN = 3; // blast-radius tokenizer guard, see blast-radius.ts

export interface RepoIndex {
  entries: { path: string; sym: IndexedSymbol }[]; // for duplicate matching, duplicates.ts
  identifierIndex: Map<string, Set<string>>; // word -> file paths, for blast radius, blast-radius.ts
  totalFiles: number;
  /** True when the file list exceeded MAX_INDEX_FILES/MAX_INDEX_BYTES and was capped. */
  capped: boolean;
}

/** Split a list into fixed-size groups, preserving order. Pure, testable. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Dedup identifiers within one file before merging into the global index. */
function tokenize(source: string): Set<string> {
  const set = new Set<string>();
  for (const m of source.matchAll(IDENT_RE)) {
    if (m[0].length >= MIN_IDENTIFIER_LEN) set.add(m[0]);
  }
  return set;
}

/** Heuristic binary check: a NUL byte in the first 8KB (mirrors build.ts). */
function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Build (or return null if unsupported/empty) a repo-wide symbol +
 * identifier index for the given source/revision. Streams file reads in
 * batches, dispatching tree-sitter extraction to a short-lived
 * `IndexWorkerPool` that's disposed once indexing completes.
 */
export async function buildRepoIndex(
  source: DiffSource,
  rev: Revision,
  onProgress?: (done: number, total: number) => void,
): Promise<RepoIndex | null> {
  if (!source.listAllFiles || !source.readFileAt) return null;

  const allPaths = await source.listAllFiles(rev);
  const semanticPaths = allPaths.filter((p) => hasSemantics(detectLang(p)));
  const capped = semanticPaths.length > MAX_INDEX_FILES;
  const paths = capped ? semanticPaths.slice(0, MAX_INDEX_FILES) : semanticPaths;
  if (paths.length === 0) {
    return { entries: [], identifierIndex: new Map(), totalFiles: 0, capped };
  }

  const entries: RepoIndex['entries'] = [];
  const identifierIndex = new Map<string, Set<string>>();
  let bytesRead = 0;
  let done = 0;
  let byteCapped = capped;

  const pool = new IndexWorkerPool();
  try {
    const batches = chunk(paths, BATCH_SIZE);
    await Promise.all(
      batches.map(async (batchPaths) => {
        const files: { path: string; lang: string; source: string }[] = [];
        for (const path of batchPaths) {
          if (bytesRead > MAX_INDEX_BYTES) {
            byteCapped = true;
            continue;
          }
          const bytes = await source.readFileAt!(rev, path);
          if (!bytes || isBinary(bytes)) continue;
          bytesRead += bytes.length;
          const text = decoder.decode(bytes);
          for (const word of tokenize(text)) {
            let set = identifierIndex.get(word);
            if (!set) {
              set = new Set();
              identifierIndex.set(word, set);
            }
            set.add(path);
          }
          const lang = detectLang(path);
          if (lang) files.push({ path, lang, source: text });
        }
        if (files.length === 0) {
          done += batchPaths.length;
          onProgress?.(done, paths.length);
          return;
        }
        const results = await pool.indexBatch(files);
        for (const { path, symbols } of results) {
          for (const sym of symbols) entries.push({ path, sym });
        }
        done += batchPaths.length;
        onProgress?.(done, paths.length);
      }),
    );
  } finally {
    pool.dispose();
  }

  return { entries, identifierIndex, totalFiles: paths.length, capped: byteCapped };
}
