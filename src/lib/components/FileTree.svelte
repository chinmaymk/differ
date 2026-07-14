<script lang="ts">
  import type { FileDiff } from '../engine/model';
  import type { TreeNode, TreeDir } from './file-tree';
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
  }: Props = $props();

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

  const pad = (d: number) => `${d * 12 + 8}px`;
</script>

<ul class="tree">
  {#each nodes as node (node.path)}
    {#if node.type === 'dir'}
      {@const c = dirCounts(node)}
      <li>
        <button class="row dir" style="padding-left: {pad(depth)}" onclick={() => (collapsed[node.path] = isOpen(node))}>
          <span class="tw">{isOpen(node) ? '▾' : '▸'}</span>
          <span class="folder">{node.name}</span>
          <span class="counts">
            {#if c.add > 0}<span class="add">+{c.add}</span>{/if}
            {#if c.del > 0}<span class="del">−{c.del}</span>{/if}
          </span>
        </button>
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
    border: none;
    background: none;
    color: var(--fg);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    padding-top: 4px;
    padding-bottom: 4px;
    padding-right: 8px;
    border-radius: 6px;
    font-family: var(--mono);
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
    font-size: 12.5px;
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
    font-size: 10px;
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
    font-size: 11px;
    flex: none;
    padding-left: 8px;
  }
  .add { color: var(--add-fg); }
  .del { color: var(--del-fg); }
  .err { color: var(--del-fg); font-weight: 700; }
  .spin { color: var(--fg-muted); }
  .viewbtn {
    flex: none;
    border: none;
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    width: 20px;
    font-size: 12px;
    opacity: 0;
  }
  .row.file:hover .viewbtn,
  .row.viewed .viewbtn {
    opacity: 1;
  }
  .row.viewed .viewbtn {
    color: var(--add-fg);
  }
</style>
