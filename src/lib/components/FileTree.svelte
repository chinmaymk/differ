<script lang="ts">
  import type { FileDiff } from '../engine/model';
  import type { TreeNode, TreeDir } from './file-tree';
  import { collectPaths } from './file-tree';
  import { fileStatusGlyph, statusColor } from './format';
  import Self from './FileTree.svelte';

  interface Props {
    nodes: TreeNode[];
    results: Record<string, FileDiff>;
    errors: Record<string, string>;
    selectedPath: string | null;
    viewed: Set<string>;
    onselect: (path: string) => void;
    ontoggleViewed: (path: string) => void;
    depth?: number;
    /**
     * Presence of exactly one of these two says which section this tree
     * renders: `onStage` set = unstaged tree (checkbox stages); `onUnstage`
     * set = staged tree (checkbox unstages). Neither set = read-only
     * (demo mode, or a historical-commit comparison).
     */
    onStage?: (paths: string[]) => void;
    onUnstage?: (paths: string[]) => void;
    /** Only ever passed alongside `onStage` (discard only applies to unstaged changes). */
    onDiscard?: (paths: string[]) => void;
  }
  let {
    nodes,
    results,
    errors,
    selectedPath,
    viewed,
    onselect,
    ontoggleViewed,
    depth = 0,
    onStage,
    onUnstage,
    onDiscard,
  }: Props = $props();

  const staged = $derived(!!onUnstage);
  const canStage = $derived(!!(onStage || onUnstage));

  let collapsed = $state<Record<string, boolean>>({});
  const isOpen = (d: TreeDir) => !collapsed[d.path];

  // Roll up +/- counts for a directory from its descendant files.
  function dirCounts(dir: TreeDir): { add: number; del: number } {
    let add = 0;
    let del = 0;
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file') {
          const r = results[n.path];
          if (r) {
            add += r.add;
            del += r.del;
          }
        } else walk(n.children);
      }
    };
    walk(dir.children);
    return { add, del };
  }

  function toggleStage(paths: string[]) {
    if (staged) onUnstage?.(paths);
    else onStage?.(paths);
  }

  const pad = (d: number) => `${d * 12 + 8}px`;
</script>

<ul class="tree">
  {#each nodes as node (node.path)}
    {#if node.type === 'dir'}
      {@const c = dirCounts(node)}
      <li>
        <div class="row dir" style="padding-left: {pad(depth)}">
          <button class="dirbtn" onclick={() => (collapsed[node.path] = isOpen(node))}>
            <span class="tw">{isOpen(node) ? '▾' : '▸'}</span>
            <span class="folder">{node.name}</span>
            <span class="counts">
              {#if c.add > 0}<span class="add">+{c.add}</span>{/if}
              {#if c.del > 0}<span class="del">−{c.del}</span>{/if}
            </span>
          </button>
          {#if canStage}
            <button
              class="stagebtn"
              title={staged ? 'Unstage all in this folder' : 'Stage all in this folder'}
              aria-label={staged ? 'Unstage folder' : 'Stage folder'}
              onclick={() => toggleStage(collectPaths(node))}
            >
              {staged ? '☑' : '☐'}
            </button>
          {/if}
          {#if onDiscard}
            <button
              class="discardbtn"
              title="Discard all changes in this folder"
              aria-label="Discard folder changes"
              onclick={() => onDiscard?.(collectPaths(node))}
            >
              ↺
            </button>
          {/if}
        </div>
        {#if isOpen(node)}
          <Self
            nodes={node.children}
            {results}
            {errors}
            {selectedPath}
            {viewed}
            {onselect}
            {ontoggleViewed}
            depth={depth + 1}
            {onStage}
            {onUnstage}
            {onDiscard}
          />
        {/if}
      </li>
    {:else}
      {@const r = results[node.path]}
      <li>
        <div
          class="row file"
          class:selected={node.path === selectedPath}
          class:viewed={viewed.has(node.path)}
          style="padding-left: {pad(depth)}"
        >
          <button class="filebtn" onclick={() => onselect(node.path)}>
            <span class="glyph" style="color: {statusColor(node.file.status)}" title={node.file.status}>
              {fileStatusGlyph(node.file.status)}
            </span>
            <span class="name">{node.name}</span>
            <span class="counts">
              {#if errors[node.path]}
                <span class="err" title={errors[node.path]}>!</span>
              {:else if r}
                {#if r.add > 0}<span class="add">+{r.add}</span>{/if}
                {#if r.del > 0}<span class="del">−{r.del}</span>{/if}
              {:else}
                <span class="spin">·</span>
              {/if}
            </span>
          </button>
          {#if canStage}
            <button
              class="stagebtn"
              title={staged ? 'Unstage' : 'Stage'}
              aria-label={staged ? 'Unstage file' : 'Stage file'}
              onclick={() => toggleStage([node.path])}
            >
              {staged ? '☑' : '☐'}
            </button>
          {/if}
          {#if onDiscard}
            <button
              class="discardbtn"
              title="Discard changes"
              aria-label="Discard file changes"
              onclick={() => onDiscard?.([node.path])}
            >
              ↺
            </button>
          {/if}
          <button
            class="viewbtn"
            title={viewed.has(node.path) ? 'Mark as not viewed' : 'Mark as viewed'}
            aria-label="toggle viewed"
            onclick={() => ontoggleViewed(node.path)}
          >
            {viewed.has(node.path) ? '✓' : '○'}
          </button>
        </div>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    color: var(--fg);
    font-size: 0.7812rem;
    border-radius: 6px;
    font-family: var(--mono);
  }
  .row.dir {
    padding: 0 4px 0 0;
    gap: 0;
  }
  .dirbtn {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
    padding: 4px 0;
    font-family: var(--mono);
    font-size: 0.7812rem;
  }
  .row.file {
    padding: 0 4px 0 0;
    gap: 0;
  }
  .filebtn {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
    padding: 4px 0 4px 0;
    font-family: var(--mono);
    font-size: 0.7812rem;
  }
  .row:hover,
  .row.file:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .row.selected {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .row.viewed .filebtn {
    opacity: 0.45;
  }
  .tw {
    width: 12px;
    color: var(--fg-muted);
    font-size: 0.625rem;
    flex: none;
  }
  .folder {
    font-weight: 600;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .glyph {
    font-weight: 700;
    width: 12px;
    text-align: center;
    flex: none;
    padding-left: 4px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .counts {
    margin-left: auto;
    display: flex;
    gap: 5px;
    font-size: 0.6875rem;
    flex: none;
    padding-left: 8px;
  }
  .add { color: var(--add-fg); }
  .del { color: var(--del-fg); }
  .err { color: var(--del-fg); font-weight: 700; }
  .spin { color: var(--fg-muted); }
  .stagebtn,
  .discardbtn,
  .viewbtn {
    flex: none;
    border: none;
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    width: 20px;
    font-size: 0.75rem;
  }
  .viewbtn {
    opacity: 0;
  }
  .row.file:hover .viewbtn,
  .row.viewed .viewbtn {
    opacity: 1;
  }
  .row.viewed .viewbtn {
    color: var(--add-fg);
  }
  .discardbtn {
    opacity: 0;
  }
  .row:hover .discardbtn {
    opacity: 1;
  }
  .discardbtn:hover {
    color: var(--del-fg);
  }
  .stagebtn:hover {
    color: var(--accent);
  }
</style>
