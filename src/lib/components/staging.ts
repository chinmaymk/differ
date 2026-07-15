/** Which half of "uncommitted changes" a file/diff belongs to. */
export type SectionKey = 'staged' | 'unstaged';

/**
 * Composite key for `results`/`errors`/`viewed` maps in App.svelte: the same
 * path can have two independent diffs open at once (a staged one and an
 * unstaged one), so a bare path is no longer a unique key.
 */
export function sectionKey(section: SectionKey, path: string): string {
  return `${section}:${path}`;
}
