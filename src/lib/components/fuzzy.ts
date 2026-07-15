/** Small dependency-free subsequence fuzzy matcher for filtering picker lists
 * (commits, branches, worktrees) by an arbitrary search box. */

/**
 * Case-insensitive subsequence match: every character of `query` must appear
 * in `text`, in order, though not necessarily contiguously. Returns a score
 * (higher = better match) or `null` when `query` doesn't match at all.
 * Earlier and more contiguous matches score higher.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return null;
    consecutive = idx === ti ? consecutive + 1 : 0;
    score += Math.max(1, 10 - (idx - ti)) + consecutive * 3;
    ti = idx + 1;
  }
  return score;
}

/** Filter and rank `items` by fuzzy-matching `query` against `textOf(item)`.
 * Returns `items` unchanged (original order) when `query` is blank. */
export function fuzzyFilter<T>(query: string, items: T[], textOf: (item: T) => string): T[] {
  const q = query.trim();
  if (!q) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(q, textOf(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
