/**
 * Dice-coefficient similarity over sorted, de-duplicated fingerprint arrays.
 * Shared by rename/move detection (semantic-diff.ts) and repo-wide
 * duplicate-code detection (duplicates.ts) so the two can never drift.
 */

/** Dice coefficient over two sorted, de-duplicated hash arrays. */
export function diceSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let inter = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      inter++;
      i++;
      j++;
    } else if (a[i] < b[j]) {
      i++;
    } else {
      j++;
    }
  }
  return (2 * inter) / (a.length + b.length);
}
