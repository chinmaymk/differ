import { describe, it, expect } from 'vitest';
import { chunk } from './dup-index';

describe('chunk', () => {
  it('splits evenly divisible lists', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('keeps the remainder in a smaller final group', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns one group when size >= length', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it('returns an empty array for an empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('preserves order', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(chunk(items, 3).flat()).toEqual(items);
  });
});
