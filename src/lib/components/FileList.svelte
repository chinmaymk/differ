<script lang="ts">
  import type { ChangedFile, FileDiff } from '../engine/model';
  import type { SectionKey } from './staging';
  import { sectionKey } from './staging';
  import { buildFileTree } from './file-tree';
  import FileTree from './FileTree.svelte';
  import CommitPanel from './CommitPanel.svelte';

  interface Props {
    stagedFiles: ChangedFile[];
    unstagedFiles: ChangedFile[];
    /** Keyed by `sectionKey(section, path)`. */
    results: Record<string, FileDiff>;
    errors: Record<string, string>;
    selected: { section: SectionKey; path: string } | null;
    /** Keyed by `sectionKey(section, path)`. */
    viewed: Set<string>;
    onselect: (section: SectionKey, path: string) => void;
    ontoggleViewed: (section: SectionKey, path: string) => void;
    /** True when the source supports write operations and we're looking at
     * uncommitted changes (vs. a read-only historical commit). */
    canStage: boolean;
    onStage: (paths: string[]) => void;
    onUnstage: (paths: string[]) => void;
    onDiscard: (paths: string[]) => void;
    committing: boolean;
    pushing: boolean;
    pushResult: string | null;
    pushError: string | null;
    onCommit: (message: string) => Promise<boolean>;
    onPush: () => void;
  }
  let {
    stagedFiles,
    unstagedFiles,
    results,
    errors,
    selected,
    viewed,
    onselect,
    ontoggleViewed,
    canStage,
    onStage,
    onUnstage,
    onDiscard,
    committing,
    pushing,
    pushResult,
    pushError,
    onCommit,
    onPush,
  }: Props = $props();

  const stagedTree = $derived(buildFileTree(stagedFiles));
  const unstagedTree = $derived(buildFileTree(unstagedFiles));

  // FileTree keys its internal maps/sets by bare path, so project the
  // composite-keyed maps down to whichever section it's rendering.
  function project<T>(map: Record<string, T>, section: SectionKey, files: ChangedFile[]): Record<string, T> {
    const out: Record<string, T> = {};
    for (const f of files) {
      const v = map[sectionKey(section, f.path)];
      if (v !== undefined) out[f.path] = v;
    }
    return out;
  }
  function projectViewed(section: SectionKey, files: ChangedFile[]): Set<string> {
    const out = new Set<string>();
    for (const f of files) if (viewed.has(sectionKey(section, f.path))) out.add(f.path);
    return out;
  }

  const totals = $derived.by(() => {
    let add = 0;
    let del = 0;
    for (const f of unstagedFiles) {
      const r = results[sectionKey('unstaged', f.path)];
      if (r) {
        add += r.add;
        del += r.del;
      }
    }
    for (const f of stagedFiles) {
      const r = results[sectionKey('staged', f.path)];
      if (r) {
        add += r.add;
        del += r.del;
      }
    }
    return { add, del };
  });
  const totalFiles = $derived(stagedFiles.length + unstagedFiles.length);
  const viewedCount = $derived(
    stagedFiles.filter((f) => viewed.has(sectionKey('staged', f.path))).length +
      unstagedFiles.filter((f) => viewed.has(sectionKey('unstaged', f.path))).length,
  );
</script>

<nav class="filelist">
  <div class="head">
    <div class="row1">
      <span>{totalFiles} file{totalFiles === 1 ? '' : 's'}</span>
      <span class="tot">
        <span class="add">+{totals.add}</span>
        <span class="del">−{totals.del}</span>
      </span>
    </div>
    {#if totalFiles > 0}
      <div class="progress" title="{viewedCount} of {totalFiles} viewed">
        <div class="bar" style="width: {(viewedCount / totalFiles) * 100}%"></div>
      </div>
    {/if}
  </div>
  <div class="body">
    {#if canStage}
      <div class="section">
        <div class="sechead">
          <span>Staged Changes</span>
          <span class="count">{stagedFiles.length}</span>
        </div>
        {#if stagedFiles.length > 0}
          <FileTree
            nodes={stagedTree}
            results={project(results, 'staged', stagedFiles)}
            errors={project(errors, 'staged', stagedFiles)}
            selectedPath={selected?.section === 'staged' ? selected.path : null}
            viewed={projectViewed('staged', stagedFiles)}
            onselect={(p) => onselect('staged', p)}
            ontoggleViewed={(p) => ontoggleViewed('staged', p)}
            onUnstage={onUnstage}
          />
        {/if}
      </div>
      <div class="section">
        <div class="sechead">
          <span>Changes</span>
          <span class="count">{unstagedFiles.length}</span>
        </div>
        {#if unstagedFiles.length > 0}
          <FileTree
            nodes={unstagedTree}
            results={project(results, 'unstaged', unstagedFiles)}
            errors={project(errors, 'unstaged', unstagedFiles)}
            selectedPath={selected?.section === 'unstaged' ? selected.path : null}
            viewed={projectViewed('unstaged', unstagedFiles)}
            onselect={(p) => onselect('unstaged', p)}
            ontoggleViewed={(p) => ontoggleViewed('unstaged', p)}
            onStage={onStage}
            onDiscard={onDiscard}
          />
        {/if}
      </div>
    {:else}
      <FileTree
        nodes={unstagedTree}
        results={project(results, 'unstaged', unstagedFiles)}
        errors={project(errors, 'unstaged', unstagedFiles)}
        selectedPath={selected?.section === 'unstaged' ? selected.path : null}
        viewed={projectViewed('unstaged', unstagedFiles)}
        onselect={(p) => onselect('unstaged', p)}
        ontoggleViewed={(p) => ontoggleViewed('unstaged', p)}
      />
    {/if}
  </div>
  {#if canStage}
    <CommitPanel
      stagedCount={stagedFiles.length}
      {committing}
      {pushing}
      {pushResult}
      {pushError}
      {onCommit}
      {onPush}
    />
  {/if}
</nav>

<style>
  .filelist {
    overflow: hidden;
    background: var(--bg-subtle);
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .head {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .row1 {
    display: flex;
    justify-content: space-between;
    font-size: 0.6875rem;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .tot {
    display: flex;
    gap: 6px;
    font-family: var(--mono);
  }
  .progress {
    margin-top: 6px;
    height: 3px;
    border-radius: 2px;
    background: var(--bg-inset);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--add-fg);
    transition: width 0.2s ease;
  }
  .body {
    overflow: auto;
    padding: 4px;
    flex: 1;
  }
  .section + .section {
    margin-top: 6px;
  }
  .sechead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px 4px;
    font-size: 0.6562rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
  }
  .sechead .count {
    font-family: var(--mono);
  }
  .add { color: var(--add-fg); }
  .del { color: var(--del-fg); }
</style>
