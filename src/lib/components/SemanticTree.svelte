<script lang="ts">
  import type { SymbolChange } from '../engine/model';
  import { kindGlyph, statusLabel, statusColor } from './format';
  import Self from './SemanticTree.svelte';

  interface Props {
    changes: SymbolChange[];
    onselect: (c: SymbolChange) => void;
    selectedId?: string | null;
    depth?: number;
  }
  let { changes, onselect, selectedId = null, depth = 0 }: Props = $props();

  // Only surface symbols that actually changed (progressive disclosure).
  const visible = $derived(changes.filter((c) => c.hasChanges));

  // Expansion state per node id; every container starts folded so the panel
  // reads as a scannable top-level outline first, expand-on-demand for detail.
  let expanded = $state<Record<string, boolean>>({});
  function isOpen(c: SymbolChange): boolean {
    return expanded[c.id] ?? false;
  }
  function toggle(c: SymbolChange) {
    expanded[c.id] = !isOpen(c);
  }

  const hasVisibleChildren = (c: SymbolChange) =>
    c.children.some((x) => x.hasChanges);
</script>

<ul class="tree" class:root={depth === 0}>
  {#each visible as c (c.id)}
    <li>
      <div
        class="row"
        class:selected={c.id === selectedId}
        style="padding-left: {depth * 14 + 8}px"
      >
        {#if hasVisibleChildren(c)}
          <button class="twisty" onclick={() => toggle(c)} aria-label="toggle">
            {isOpen(c) ? '▾' : '▸'}
          </button>
        {:else}
          <span class="twisty-spacer"></span>
        {/if}

        <button class="label" onclick={() => onselect(c)} title={statusLabel(c.status)}>
          <span class="glyph" style="color: {statusColor(c.status)}">{kindGlyph(c.kind)}</span>
          <span class="name">
            {#if c.status === 'renamed' && c.oldName}
              <span class="old-name">{c.oldName}</span>
              <span class="arrow">→</span>
            {/if}
            {c.name}
          </span>
          <span class="badge" style="color: {statusColor(c.status)}">{statusLabel(c.status)}</span>
          {#if c.confidence !== undefined && c.confidence < 1}
            <span class="conf">{Math.round(c.confidence * 100)}%</span>
          {/if}
          <span class="counts">
            {#if c.add > 0}<span class="add">+{c.add}</span>{/if}
            {#if c.del > 0}<span class="del">−{c.del}</span>{/if}
          </span>
        </button>
      </div>

      {#if hasVisibleChildren(c) && isOpen(c)}
        <Self changes={c.children} {onselect} {selectedId} depth={depth + 1} />
      {/if}
    </li>
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
    gap: 2px;
    border-radius: 5px;
  }
  .row.selected {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .row:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .twisty,
  .twisty-spacer {
    width: 16px;
    flex: none;
    text-align: center;
  }
  .twisty {
    background: none;
    border: none;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0;
    font-size: 0.625rem;
  }
  .label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    padding: 3px 6px 3px 0;
    min-width: 0;
    font-size: 0.7812rem;
  }
  .glyph {
    font-family: var(--mono);
    font-weight: 600;
    width: 14px;
    text-align: center;
    flex: none;
  }
  .name {
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .old-name {
    color: var(--fg-muted);
    text-decoration: line-through;
  }
  .arrow {
    color: var(--fg-muted);
  }
  .badge {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.85;
    flex: none;
  }
  .conf {
    font-size: 0.625rem;
    color: var(--fg-muted);
  }
  .counts {
    margin-left: auto;
    display: flex;
    gap: 6px;
    font-family: var(--mono);
    font-size: 0.6875rem;
    padding-left: 8px;
    flex: none;
  }
  .add {
    color: var(--add-fg);
  }
  .del {
    color: var(--del-fg);
  }
</style>
