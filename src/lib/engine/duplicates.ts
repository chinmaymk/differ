/**
 * Repo-wide duplicate-code matching: does a changed symbol resemble an
 * existing symbol elsewhere in the working tree? Pure — no tree-sitter, no
 * I/O — operates on the fingerprints already computed by `dup-index.ts`'s
 * repo-wide pass and `extract.ts`'s per-file extraction.
 */
import type { SymbolKind } from './model';
import { diceSimilarity } from './similarity';
import type { RepoIndex } from './dup-index';

// Stricter than RENAME_THRESHOLD(0.6)/MOVE_THRESHOLD(0.7) in semantic-diff.ts
// — cross-file matches have no name/parent constraint to help disambiguate.
export const DUPLICATE_THRESHOLD = 0.75;
// Skip trivial one-liners/getters, on both the query and index sides.
export const MIN_FINGERPRINT_LINES = 4;

export interface DuplicateTarget {
  kind: SymbolKind;
  fingerprint: number[];
}

export interface DuplicateResult {
  path: string;
  name: string;
  similarity: number;
}

/**
 * Find the best duplicate match for `target` (a diffed symbol) among a
 * repo-wide `RepoIndex`, excluding its own file. Returns null if none
 * clears `DUPLICATE_THRESHOLD` or the target is too small to be meaningful.
 *
 * A length-ratio bound (`2*min(la,lb)/(la+lb)`) is an exact upper bound on
 * Dice similarity, so it prunes candidates with zero false negatives before
 * paying for the real `diceSimilarity` call — the main defense against the
 * worst-case cost of changed-symbols x indexed-symbols comparisons.
 */
export function findDuplicate(
  target: DuplicateTarget,
  ownPath: string,
  index: RepoIndex,
): DuplicateResult | null {
  if (target.fingerprint.length < MIN_FINGERPRINT_LINES) return null;

  let best: DuplicateResult | null = null;
  let bestScore = 0;
  const la = target.fingerprint.length;

  for (const entry of index.entries) {
    if (entry.path === ownPath) continue;
    if (entry.sym.kind !== target.kind) continue;
    const lb = entry.sym.fingerprint.length;
    if (lb < MIN_FINGERPRINT_LINES) continue;

    const upperBound = (2 * Math.min(la, lb)) / (la + lb);
    if (upperBound < DUPLICATE_THRESHOLD) continue;

    const score = diceSimilarity(target.fingerprint, entry.sym.fingerprint);
    if (score >= DUPLICATE_THRESHOLD && score > bestScore) {
      bestScore = score;
      best = { path: entry.path, name: entry.sym.name, similarity: score };
    }
  }

  return best;
}
