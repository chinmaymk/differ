/**
 * Correlation: tie the line-level text diff to the semantic change tree so the
 * UI can show "function foo: +8 −2" and drill from a symbol into its exact
 * changed lines. Each symbol's counts come from the changed lines that fall in
 * its own byte-line range (nested symbols therefore roll up into parents).
 */
import type { SemanticDiff, SymbolChange, TextDiff } from './model';

/** Collect sorted changed-line numbers for each side of a text diff. */
function changedLines(text: TextDiff): { old: number[]; neu: number[] } {
  const old: number[] = [];
  const neu: number[] = [];
  for (const h of text.hunks) {
    for (const l of h.lines) {
      if (l.op === 'del' && l.oldLine !== null) old.push(l.oldLine);
      else if (l.op === 'add' && l.newLine !== null) neu.push(l.newLine);
    }
  }
  // Hunks are already in order, but be defensive.
  old.sort((a, b) => a - b);
  neu.sort((a, b) => a - b);
  return { old, neu };
}

/** Count how many values in a sorted array fall within [lo, hi] inclusive. */
function countInRange(sorted: number[], lo: number, hi: number): number {
  return upperBound(sorted, hi) - lowerBound(sorted, lo);
}

/** First index with value >= target. */
function lowerBound(a: number[], target: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with value > target. */
function upperBound(a: number[], target: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function assign(node: SymbolChange, oldLines: number[], newLines: number[]): void {
  node.del = node.old ? countInRange(oldLines, node.old.startLine, node.old.endLine) : 0;
  node.add = node.new ? countInRange(newLines, node.new.startLine, node.new.endLine) : 0;
  for (const child of node.children) assign(child, oldLines, newLines);
}

/**
 * Fill `add`/`del` on every symbol change and compute `fileLevel` (changes
 * outside any top-level symbol). Mutates `semantic` in place.
 */
export function correlate(text: TextDiff, semantic: SemanticDiff): void {
  const { old: oldLines, neu: newLines } = changedLines(text);

  for (const root of semantic.roots) assign(root, oldLines, newLines);

  let coveredDel = 0;
  let coveredAdd = 0;
  for (const root of semantic.roots) {
    if (root.old) coveredDel += countInRange(oldLines, root.old.startLine, root.old.endLine);
    if (root.new) coveredAdd += countInRange(newLines, root.new.startLine, root.new.endLine);
  }
  semantic.fileLevel = {
    del: Math.max(0, oldLines.length - coveredDel),
    add: Math.max(0, newLines.length - coveredAdd),
  };
}
