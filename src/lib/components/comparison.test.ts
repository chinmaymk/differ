import { describe, it, expect } from 'vitest';
import { baseRevision, headRevision, type Comparison } from './comparison';
import type { CommitInfo } from '../engine/model';

const commit = (sha: string, parent: string | null): CommitInfo => ({
  sha,
  shortSha: sha.slice(0, 7),
  summary: 'x',
  author: 'a',
  timestamp: 0,
  parent,
});

describe('comparison revisions', () => {
  it('working tree compares HEAD vs worktree', () => {
    const c: Comparison = { kind: 'worktree' };
    expect(baseRevision(c)).toEqual({ kind: 'ref', ref: 'HEAD' });
    expect(headRevision(c)).toEqual({ kind: 'worktree' });
  });

  it('a commit compares its parent vs itself', () => {
    const c: Comparison = { kind: 'commit', commit: commit('abc123def', 'parent99') };
    expect(baseRevision(c)).toEqual({ kind: 'ref', ref: 'parent99' });
    expect(headRevision(c)).toEqual({ kind: 'ref', ref: 'abc123def' });
  });

  it('a root commit compares an empty tree vs itself', () => {
    const c: Comparison = { kind: 'commit', commit: commit('root000', null) };
    expect(baseRevision(c)).toEqual({ kind: 'empty' });
    expect(headRevision(c)).toEqual({ kind: 'ref', ref: 'root000' });
  });
});
