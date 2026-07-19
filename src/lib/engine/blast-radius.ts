/**
 * Blast radius: a textual reference-count signal — deliberately not a
 * resolved import/call graph. Reuses the `identifierIndex` built by
 * `dup-index.ts`'s repo-wide pass instead of a second repo read.
 *
 * Two cheap, purely-textual refinements keep this from being pure noise:
 *  1. A corpus-relative document-frequency filter (replaces a fixed
 *     stoplist — calibrated to *this* codebase's own vocabulary).
 *  2. Local-context confirmation on the (small, capped) survivors: a name
 *     only counts as a real reference if it appears in a call/member/
 *     type-position/import shape, not just anywhere in the file.
 */
import type { DiffSource, Revision } from './model';
import type { RepoIndex } from './dup-index';
import { MIN_IDENTIFIER_LEN } from './dup-index';
import type { SymbolBlastRadius } from './importance';

// A name in >12% of indexed files is too generic to be a signal.
export const MAX_DOC_FREQ_RATIO = 0.12;
// Above this many post-filter candidates, skip stage 2 and report the raw count.
export const CONFIRM_CANDIDATE_CAP = 30;

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Dedup identifiers within one file before merging into a repo index. */
export function tokenize(source: string): Set<string> {
  const set = new Set<string>();
  for (const m of source.matchAll(IDENT_RE)) {
    if (m[0].length >= MIN_IDENTIFIER_LEN) set.add(m[0]);
  }
  return set;
}

/** Stage 1: corpus-relative frequency filter, no I/O, O(1). */
export function candidateFiles(
  symbolName: string,
  ownPath: string,
  index: RepoIndex,
): string[] | null {
  if (symbolName.length < MIN_IDENTIFIER_LEN) return null;
  const files = [...(index.identifierIndex.get(symbolName) ?? [])].filter(
    (p) => p !== ownPath,
  );
  if (files.length === 0) return null;
  if (index.totalFiles > 0 && files.length / index.totalFiles > MAX_DOC_FREQ_RATIO) {
    return null; // generic to *this* codebase, not just to English
  }
  return files;
}

export type RefContext = 'call' | 'member' | 'type-position' | 'import' | 'none';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Classify a single line's use of `name`, without a parser — a small set
 * of positive shapes (call, member-access, type-position, import) already
 * excludes the overwhelming majority of incidental prose/comment mentions. */
export function classifyContext(name: string, line: string): RefContext {
  const n = escapeRegExp(name);
  if (new RegExp(`\\b${n}\\s*\\(`).test(line)) return 'call';
  // `.` (member access) or `::` (Rust path) — deliberately NOT a bare `:`,
  // which would collide with a type annotation (`let w: Widget`) below.
  if (new RegExp(`(\\.|::)\\s*${n}\\b`).test(line)) return 'member';
  if (
    new RegExp(`\\b(new|extends|implements)\\s+${n}\\b|:\\s*${n}\\b|<\\s*${n}\\b`).test(line)
  ) {
    return 'type-position';
  }
  if (/\b(import|require|from)\b/.test(line) && new RegExp(`\\b${n}\\b`).test(line)) {
    return 'import';
  }
  return 'none';
}

/** Shared across multiple `confirmReferences` calls in one matching pass so
 * candidate files common to several changed symbols are fetched once. */
export type FetchCache = Map<string, Promise<Uint8Array | null>>;

const decoder = new TextDecoder('utf-8', { fatal: false });

function readCached(
  source: DiffSource,
  rev: Revision,
  path: string,
  cache?: FetchCache,
): Promise<Uint8Array | null> {
  if (!cache) return source.readFileAt!(rev, path);
  let p = cache.get(path);
  if (!p) {
    p = source.readFileAt!(rev, path);
    cache.set(path, p);
  }
  return p;
}

/**
 * Stage 2: local-context confirmation, bounded I/O over `candidateFiles`'
 * survivors. Falls back to the unconfirmed (but still frequency-filtered)
 * count when there are too many candidates to cheaply confirm, or when the
 * source can't read arbitrary files.
 */
export async function confirmReferences(
  symbolName: string,
  ownPath: string,
  index: RepoIndex,
  source: DiffSource,
  rev: Revision,
  cache?: FetchCache,
): Promise<SymbolBlastRadius> {
  const candidates = candidateFiles(symbolName, ownPath, index);
  if (!candidates) return { symbolId: '', count: 0, files: [] };
  if (candidates.length > CONFIRM_CANDIDATE_CAP || !source.readFileAt) {
    return { symbolId: '', count: candidates.length, files: candidates.slice(0, 5) };
  }

  const confirmed: string[] = [];
  for (const path of candidates) {
    const bytes = await readCached(source, rev, path, cache);
    if (!bytes) continue;
    const text = decoder.decode(bytes);
    const hit = text.split('\n').some((line) => classifyContext(symbolName, line) !== 'none');
    if (hit) confirmed.push(path);
  }
  return { symbolId: '', count: confirmed.length, files: confirmed.slice(0, 5) };
}
