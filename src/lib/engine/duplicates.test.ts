import { describe, it, expect } from 'vitest';
import { findDuplicate, DUPLICATE_THRESHOLD, MIN_FINGERPRINT_LINES } from './duplicates';
import { diceSimilarity } from './similarity';
import type { RepoIndex } from './dup-index';

function repoIndex(entries: RepoIndex['entries']): RepoIndex {
  return { entries, identifierIndex: new Map(), totalFiles: entries.length, capped: false };
}

const BIG_FP = [1, 2, 3, 4, 5, 6, 7, 8];

describe('findDuplicate', () => {
  it('matches an exact fingerprint at similarity 1', () => {
    const index = repoIndex([{ path: 'b.ts', sym: { name: 'formatDate', kind: 'function', fingerprint: BIG_FP } }]);
    const result = findDuplicate({ kind: 'function', fingerprint: BIG_FP }, 'a.ts', index);
    expect(result).toEqual({ path: 'b.ts', name: 'formatDate', similarity: 1 });
  });

  it('rejects candidates below the threshold', () => {
    const index = repoIndex([
      { path: 'b.ts', sym: { name: 'unrelated', kind: 'function', fingerprint: [100, 200, 300, 400] } },
    ]);
    const result = findDuplicate({ kind: 'function', fingerprint: BIG_FP }, 'a.ts', index);
    expect(result).toBeNull();
  });

  it('excludes matches from the same file', () => {
    const index = repoIndex([{ path: 'a.ts', sym: { name: 'self', kind: 'function', fingerprint: BIG_FP } }]);
    const result = findDuplicate({ kind: 'function', fingerprint: BIG_FP }, 'a.ts', index);
    expect(result).toBeNull();
  });

  it('excludes matches of a different kind', () => {
    const index = repoIndex([{ path: 'b.ts', sym: { name: 'formatDate', kind: 'method', fingerprint: BIG_FP } }]);
    const result = findDuplicate({ kind: 'function', fingerprint: BIG_FP }, 'a.ts', index);
    expect(result).toBeNull();
  });

  it('guards MIN_FINGERPRINT_LINES on the query side', () => {
    const index = repoIndex([{ path: 'b.ts', sym: { name: 'x', kind: 'function', fingerprint: BIG_FP } }]);
    const tiny = BIG_FP.slice(0, MIN_FINGERPRINT_LINES - 1);
    const result = findDuplicate({ kind: 'function', fingerprint: tiny }, 'a.ts', index);
    expect(result).toBeNull();
  });

  it('guards MIN_FINGERPRINT_LINES on the index side', () => {
    const tiny = BIG_FP.slice(0, MIN_FINGERPRINT_LINES - 1);
    const index = repoIndex([{ path: 'b.ts', sym: { name: 'x', kind: 'function', fingerprint: tiny } }]);
    const result = findDuplicate({ kind: 'function', fingerprint: BIG_FP }, 'a.ts', index);
    expect(result).toBeNull();
  });

  it('picks the best match among multiple candidates', () => {
    const index = repoIndex([
      { path: 'b.ts', sym: { name: 'okMatch', kind: 'function', fingerprint: [1, 2, 3, 4, 5, 6, 9, 10] } },
      { path: 'c.ts', sym: { name: 'bestMatch', kind: 'function', fingerprint: [1, 2, 3, 4, 5, 6, 7, 9] } },
    ]);
    const result = findDuplicate({ kind: 'function', fingerprint: BIG_FP }, 'a.ts', index);
    expect(result?.name).toBe('bestMatch');
  });

  it('length-ratio pruning never diverges from a brute-force scan', () => {
    // Deterministic pseudo-random fixtures (no Math.random per repo convention).
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const randomFingerprint = (n: number) =>
      Array.from(new Set(Array.from({ length: n }, () => Math.floor(rand() * 40)))).sort((a, b) => a - b);

    for (let trial = 0; trial < 20; trial++) {
      const entries: RepoIndex['entries'] = Array.from({ length: 15 }, (_, i) => ({
        path: `f${i}.ts`,
        sym: { name: `sym${i}`, kind: 'function' as const, fingerprint: randomFingerprint(4 + Math.floor(rand() * 10)) },
      }));
      const index = repoIndex(entries);
      const target = { kind: 'function' as const, fingerprint: randomFingerprint(4 + Math.floor(rand() * 10)) };

      const pruned = findDuplicate(target, '__query__.ts', index);

      // Brute force: scan every same-kind, sufficiently-long candidate directly.
      let bruteBest: { path: string; name: string; similarity: number } | null = null;
      let bruteScore = 0;
      for (const e of entries) {
        if (e.sym.fingerprint.length < MIN_FINGERPRINT_LINES) continue;
        if (target.fingerprint.length < MIN_FINGERPRINT_LINES) continue;
        const score = diceSimilarity(target.fingerprint, e.sym.fingerprint);
        if (score >= DUPLICATE_THRESHOLD && score > bruteScore) {
          bruteScore = score;
          bruteBest = { path: e.path, name: e.sym.name, similarity: score };
        }
      }

      expect(pruned?.similarity ?? 0).toBeCloseTo(bruteBest?.similarity ?? 0);
      expect(pruned?.path ?? null).toBe(bruteBest?.path ?? null);
    }
  });
});
