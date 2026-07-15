/** What the viewer is currently comparing. */
import type { CommitInfo, Revision } from '../engine/model';

export type Comparison =
  | { kind: 'worktree' }
  | { kind: 'commit'; commit: CommitInfo }
  | { kind: 'branch'; name: string; sha: string }
  | { kind: 'tag'; name: string; sha: string };

/** The base (old) revision for a comparison. */
export function baseRevision(c: Comparison): Revision {
  // A branch/tag is shown two-dot against current HEAD, same base as 'worktree'.
  if (c.kind === 'worktree' || c.kind === 'branch' || c.kind === 'tag') {
    return { kind: 'ref', ref: 'HEAD' };
  }
  // A commit is shown against its parent (or an empty tree for a root commit).
  return c.commit.parent
    ? { kind: 'ref', ref: c.commit.parent }
    : { kind: 'empty' };
}

/** The head (new) revision for a comparison. */
export function headRevision(c: Comparison): Revision {
  if (c.kind === 'worktree') return { kind: 'worktree' };
  if (c.kind === 'branch' || c.kind === 'tag') return { kind: 'ref', ref: c.sha };
  return { kind: 'ref', ref: c.commit.sha };
}
