/** What the viewer is currently comparing. */
import type { CommitInfo, Revision } from '../engine/model';

export type Comparison =
  | { kind: 'worktree' }
  | { kind: 'commit'; commit: CommitInfo };

/** The base (old) revision for a comparison. */
export function baseRevision(c: Comparison): Revision {
  if (c.kind === 'worktree') return { kind: 'ref', ref: 'HEAD' };
  // A commit is shown against its parent (or an empty tree for a root commit).
  return c.commit.parent
    ? { kind: 'ref', ref: c.commit.parent }
    : { kind: 'empty' };
}

/** The head (new) revision for a comparison. */
export function headRevision(c: Comparison): Revision {
  return c.kind === 'worktree'
    ? { kind: 'worktree' }
    : { kind: 'ref', ref: c.commit.sha };
}
