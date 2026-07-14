<script lang="ts">
  import type { ChangedFile, FileDiff } from '../engine/model';
  import { buildFileTree } from './file-tree';
  import FileTree from './FileTree.svelte';

  interface Props {
    files: ChangedFile[];
    results: Record<string, FileDiff>;
    errors: Record<string, string>;
    selectedPath: string | null;
    viewed: Set<string>;
    onselect: (path: string) => void;
    ontoggleViewed: (path: string) => void;
  }
  let { files, results, errors, selectedPath, viewed, onselect, ontoggleViewed }: Props =
    $props();

  const tree = $derived(buildFileTree(files));
  const totals = $derived.by(() => {
    let add = 0;
    let del = 0;
    for (const f of files) {
      const r = results[f.path];
      if (r) {
        add += r.add;
        del += r.del;
      }
    }
    return { add, del };
  });
  const viewedCount = $derived(files.filter((f) => viewed.has(f.path)).length);
</script>

<nav class="filelist">
  <div class="head">
    <div class="row1">
      <span>{files.length} file{files.length === 1 ? '' : 's'}</span>
      <span class="tot">
        <span class="add">+{totals.add}</span>
        <span class="del">−{totals.del}</span>
      </span>
    </div>
    {#if files.length > 0}
      <div class="progress" title="{viewedCount} of {files.length} viewed">
        <div class="bar" style="width: {(viewedCount / files.length) * 100}%"></div>
      </div>
    {/if}
  </div>
  <div class="body">
    <FileTree
      nodes={tree}
      {results}
      {errors}
      {selectedPath}
      {viewed}
      {onselect}
      {ontoggleViewed}
    />
  </div>
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
    font-size: 11px;
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
  .add { color: var(--add-fg); }
  .del { color: var(--del-fg); }
</style>
