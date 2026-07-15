import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyFilter } from './fuzzy';

describe('fuzzyScore', () => {
  it('matches an empty query against anything with score 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('matches a case-insensitive subsequence', () => {
    expect(fuzzyScore('fx', 'feature/fix-bug')).not.toBeNull();
    expect(fuzzyScore('FEAT', 'feature/fix-bug')).not.toBeNull();
  });

  it('rejects out-of-order or missing characters', () => {
    expect(fuzzyScore('xf', 'feature')).toBeNull();
    expect(fuzzyScore('zzz', 'feature')).toBeNull();
  });

  it('scores earlier and more contiguous matches higher', () => {
    const early = fuzzyScore('feat', 'feature');
    const late = fuzzyScore('feat', 'xxxxxfeat');
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(early as number).toBeGreaterThan(late as number);

    const contiguous = fuzzyScore('ab', 'ab-cdef');
    const scattered = fuzzyScore('ab', 'a-b-cdef');
    expect(contiguous as number).toBeGreaterThan(scattered as number);
  });
});

describe('fuzzyFilter', () => {
  const items = ['main', 'loginxx', 'xxlogin', 'release/1.0'];

  it('returns items unchanged in original order when query is blank', () => {
    expect(fuzzyFilter('  ', items, (x) => x)).toEqual(items);
  });

  it('filters out non-matches and sorts closer matches first', () => {
    const result = fuzzyFilter('login', items, (x) => x);
    expect(result).toEqual(['loginxx', 'xxlogin']);
  });

  it('excludes items with no match', () => {
    const result = fuzzyFilter('zzz', items, (x) => x);
    expect(result).toEqual([]);
  });
});
