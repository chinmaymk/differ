<script lang="ts">
  import type { FileDiff, Hunk, HunkMode, SymbolChange, SymbolStatus } from '../engine/model';
  import type { ImportanceReason } from '../engine/importance';
  import SemanticTree from './SemanticTree.svelte';
  import RawDiff from './RawDiff.svelte';
  import SplitDiff from './SplitDiff.svelte';
  import ImageDiff from './ImageDiff.svelte';
  import { splitPath, statusColor } from './format';
  import type { SectionKey } from './staging';

  interface Props {
    file: FileDiff;
    viewMode: 'unified' | 'split';
    wrap: boolean;
    showSemantic: boolean;
    onToggleSemantic: () => void;
    section?: SectionKey | null;
    onHunkAction?: (hunk: Hunk, mode: HunkMode) => void;
    /** Story Mode's importance-ranking reasons, folded into the semantic
     * panel instead of a separate top strip. Absent for the main viewer. */
    reasons?: ImportanceReason[];
    /** Hunks start collapsed to just their header (Story Mode only). */
    startFolded?: boolean;
  }
  let {
    file,
    viewMode,
    wrap,
    showSemantic,
    onToggleSemantic,
    section = null,
    onHunkAction,
    reasons = [],
    startFolded = false,
  }: Props = $props();

  let selected = $state<SymbolChange | null>(null);
  // Reset only when the displayed *file* changes (by path), not merely
  // re-rendered — a background rebuild (e.g. auto-refresh) replaces `file`
  // with a new object reference for the same path, and must not silently
  // clear an in-progress symbol selection.
  $effect(() => {
    file.path;
    selected = null;
  });

  // Resizable semantic panel (persisted across sessions).
  const WIDTH_KEY = 'dv-semantic-width';
  const MIN_W = 180;
  const MAX_W = 720;
  const DEFAULT_W = 300;
  function loadWidth(): number {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
  }
  function resetWidth() {
    semWidth = DEFAULT_W;
    localStorage.setItem(WIDTH_KEY, String(DEFAULT_W));
  }
  let semWidth = $state(loadWidth());
  let dragging = $state(false);

  function startDrag(e: PointerEvent) {
    dragging = true;
    const startX = e.clientX;
    const startW = semWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      // Dragging left (negative dx) widens the right-hand panel.
      semWidth = Math.max(MIN_W, Math.min(MAX_W, startW - (ev.clientX - startX)));
    };
    const up = (ev: PointerEvent) => {
      dragging = false;
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      localStorage.setItem(WIDTH_KEY, String(semWidth));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function countByStatus(roots: SymbolChange[]): Record<string, number> {
    const acc: Record<string, number> = {};
    const walk = (cs: SymbolChange[]) => {
      for (const c of cs) {
        if (c.status !== 'unchanged') acc[c.status] = (acc[c.status] ?? 0) + 1;
        walk(c.children);
      }
    };
    walk(roots);
    return acc;
  }

  const summary = $derived(countByStatus(file.semantic.roots));
  const summaryText = $derived(
    (['modified', 'added', 'removed', 'renamed', 'moved'] as SymbolStatus[])
      .filter((s) => summary[s])
      .map((s) => `${summary[s]} ${s}`)
      .join(', '),
  );
  const path = $derived(splitPath(file.path));
  const isImage = $derived(!!file.image);
  // Whole-file add/remove: don't drown every line in green/red.
  const neutral = $derived(file.status === 'added' || file.status === 'removed');
  const hasSemantic = $derived(
    !isImage && !file.semantic.textOnly && file.semantic.roots.some((r) => r.hasChanges),
  );
  const showTree = $derived(hasSemantic && showSemantic);
  const statusText: Record<string, string> = {
    added: 'New file',
    removed: 'Deleted',
    renamed: 'Renamed',
    modified: 'Modified',
  };
</script>

<div class="view">
  <header>
    <div class="title">
      <span class="dir">{path.dir}</span><span class="name">{path.name}</span>
      <span class="badge" style="color: {statusColor(file.status)}; border-color: {statusColor(file.status)}">
        {statusText[file.status]}
      </span>
      {#if !isImage && !neutral}
        <span class="counts">
          {#if file.add > 0}<span class="add">+{file.add}</span>{/if}
          {#if file.del > 0}<span class="del">−{file.del}</span>{/if}
        </span>
      {/if}
      {#if file.oldPath && file.status === 'renamed'}
        <span class="from">from {file.oldPath}</span>
      {/if}

      {#if !isImage && hasSemantic}
        <div class="toolbar">
          <button class="toggle" class:on={showSemantic} onclick={onToggleSemantic}>Semantic</button>
        </div>
      {/if}
    </div>
    <div class="sub">
      {#if isImage}
        <span class="muted">Image</span>
      {:else if file.semantic.textOnly}
        <span class="muted">
          Text diff
          {#if file.semantic.reason === 'unsupported'}(no semantic parser for this file){/if}
          {#if file.semantic.reason === 'too-large'}(file too large for semantic analysis){/if}
          {#if file.semantic.reason === 'parse-error'}(could not parse){/if}
        </span>
      {:else if summaryText}
        <span class="muted">{summaryText}</span>
      {:else}
        <span class="muted">No symbol-level changes</span>
      {/if}
    </div>
  </header>

  {#if isImage && file.image}
    <div class="imgpane"><ImageDiff image={file.image} status={file.status} /></div>
  {:else}
    <div
      class="body"
      class:no-semantic={!showTree}
      class:dragging
      style={showTree ? `grid-template-columns: 1fr 6px ${semWidth}px` : ''}
    >
      <section class="rawpane">
        {#if viewMode === 'split'}
          <SplitDiff {file} {selected} {wrap} {neutral} {section} {onHunkAction} {startFolded} />
        {:else}
          <RawDiff {file} {selected} {wrap} {neutral} {section} {onHunkAction} {startFolded} />
        {/if}
      </section>
      {#if showTree}
        <div
          class="divider"
          onpointerdown={startDrag}
          ondblclick={resetWidth}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize semantic panel"
          title="Drag to resize · double-click to reset"
        ></div>
        <aside class="semantic">
          <div class="pane-title">Semantic changes</div>
          {#if reasons.length > 0}
            <div class="reasons">
              {#each reasons as reason (reason.text)}
                <span
                  class="reason"
                  class:duplicate={reason.kind === 'duplicate'}
                  class:blast={reason.kind === 'blast-radius'}
                >
                  {reason.text}
                </span>
              {/each}
            </div>
          {/if}
          <SemanticTree
            changes={file.semantic.roots}
            selectedId={selected?.id ?? null}
            onselect={(c) => (selected = c)}
          />
        </aside>
      {/if}
    </div>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  header {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    flex: none;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--mono);
    font-size: 0.8125rem;
    flex-wrap: wrap;
  }
  .dir { color: var(--fg-muted); }
  .name { font-weight: 600; }
  .badge {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 7px;
    border: 1px solid;
    border-radius: 999px;
    font-family: var(--sans);
  }
  .from {
    color: var(--fg-muted);
    font-size: 0.7188rem;
  }
  .counts {
    display: flex;
    gap: 8px;
    font-size: 0.75rem;
  }
  .add { color: var(--add-fg); }
  .del { color: var(--del-fg); }
  .sub {
    margin-top: 3px;
    font-size: 0.75rem;
  }
  .muted { color: var(--fg-muted); }
  .toolbar {
    margin-left: auto;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .toggle {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-muted);
    padding: 3px 10px;
    cursor: pointer;
    font-size: 0.7188rem;
  }
  .toggle.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .body {
    display: grid;
    grid-template-columns: 1fr 6px 300px;
    min-height: 0;
    flex: 1;
  }
  .body.no-semantic {
    grid-template-columns: 1fr;
  }
  .body.dragging {
    cursor: col-resize;
    user-select: none;
  }
  .divider {
    cursor: col-resize;
    background: var(--border);
    position: relative;
  }
  .divider::after {
    /* Wider invisible hit area so the 6px line is easy to grab. */
    content: '';
    position: absolute;
    inset: 0 -4px;
  }
  .divider:hover,
  .body.dragging .divider {
    background: var(--accent);
  }
  .semantic {
    overflow: auto;
    padding: 8px 6px;
    background: var(--bg-subtle);
  }
  .pane-title {
    font-size: 0.6562rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    padding: 2px 8px 8px;
  }
  .reasons {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0 8px 10px;
  }
  .reason {
    font-size: 0.6875rem;
    padding: 3px 9px;
    border-radius: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--fg-muted);
  }
  .reason.duplicate {
    border-color: var(--accent);
    color: var(--accent);
  }
  .reason.blast {
    border-color: var(--del-fg);
    color: var(--del-fg);
  }
  .rawpane {
    min-width: 0;
    overflow: hidden;
  }
  .imgpane {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
