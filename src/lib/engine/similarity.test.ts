import { describe, it, expect } from 'vitest';
import { diceSimilarity } from './similarity';

describe('diceSimilarity', () => {
  it('returns 1 for two empty arrays', () => {
    expect(diceSimilarity([], [])).toBe(1);
  });

  it('returns 0 when only one side is empty', () => {
    expect(diceSimilarity([], [1, 2, 3])).toBe(0);
    expect(diceSimilarity([1, 2, 3], [])).toBe(0);
  });

  it('returns 1 for identical arrays', () => {
    expect(diceSimilarity([1, 2, 3], [1, 2, 3])).toBe(1);
  });

  it('returns 0 for disjoint arrays', () => {
    expect(diceSimilarity([1, 2, 3], [4, 5, 6])).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    // intersection = {1,2,3,4}, |a|=5 |b|=5 -> 2*4/10 = 0.8
    expect(diceSimilarity([1, 2, 3, 4, 5], [1, 2, 3, 4, 9])).toBeCloseTo(0.8);
  });

  it('handles differently sized arrays', () => {
    // intersection = {2,3}, |a|=2 |b|=4 -> 2*2/6 = 0.666...
    expect(diceSimilarity([2, 3], [1, 2, 3, 4])).toBeCloseTo(2 / 3);
  });
});
