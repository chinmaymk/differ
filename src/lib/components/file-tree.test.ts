import { describe, it, expect } from 'vitest';
import { buildFileTree, type TreeDir, type TreeFile } from './file-tree';
import type { ChangedFile } from '../engine/model';

const f = (path: string): ChangedFile => ({ path, status: 'modified' });

describe('buildFileTree', () => {
  it('nests files under directories', () => {
    const tree = buildFileTree([f('src/a.ts'), f('src/b.ts'), f('readme.md')]);
    // Directories first, then files; alphabetical.
    expect(tree[0].type).toBe('dir');
    expect(tree[0].name).toBe('src');
    expect((tree[0] as TreeDir).children.map((c) => c.name)).toEqual(['a.ts', 'b.ts']);
    expect(tree[1].type).toBe('file');
    expect(tree[1].name).toBe('readme.md');
  });

  it('compacts single-child directory chains', () => {
    const tree = buildFileTree([f('a/b/c/deep.ts')]);
    // a → b → c collapses to one row "a/b/c".
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('dir');
    expect(tree[0].name).toBe('a/b/c');
    expect(((tree[0] as TreeDir).children[0] as TreeFile).name).toBe('deep.ts');
  });

  it('does not over-compact when a directory branches', () => {
    const tree = buildFileTree([f('a/b/one.ts'), f('a/c/two.ts')]);
    // `a` has two child dirs (b, c) — must not collapse.
    expect(tree[0].name).toBe('a');
    expect((tree[0] as TreeDir).children.map((c) => c.name)).toEqual(['b', 'c']);
  });
});
