<script lang="ts">
  import type { FileDiff, DiffLine, Hunk, HunkMode, InlineSpan, SymbolChange } from '../engine/model';
  import { computeHunkInline } from '../engine/text-diff';
  import { lineSegments } from './segments';
  import { enclosingSymbols } from './symbol-path';
  import type { SectionKey } from './staging';

  interface Props {
    file: FileDiff;
    selected?: SymbolChange | null;
    wrap?: boolean;
    /** Whole-file add/remove: render neutral (no full-line green/red). */
    neutral?: boolean;
    /** Which side of "uncommitted changes" is showing; null for read-only
     * (demo mode, or a historical-commit comparison) — hides hunk actions. */
    section?: SectionKey | null;
    onHunkAction?: (hunk: Hunk, mode: HunkMode) => void;
    /** Render as a symbol-grouped outline, folded to each top-level
     * tree-sitter symbol's header by default (Story Mode: a slide shouldn't
     * dump a wall of lines before the reader's chosen to see it). Mutually
     * exclusive with hunk staging actions — Story Mode is read-only. */
    startFolded?: boolean;
  }
  let {
    file,
    selected = null,
    wrap = true,
    neutral = false,
    section = null,
    onHunkAction,
    startFolded = false,
  }: Props = $props();

  interface Row {
    kind: 'hunk' | 'line';
    header?: string;
    crumb?: string;
    hunk?: Hunk;
    line?: DiffLine;
  }

  // Build render rows and word-level spans purely (no model mutation, so this
  // is safe inside a derived). Recomputes only when the file changes.
  const built = $derived.by<{ rows: Row[]; inline: Map<DiffLine, InlineSpan[]> }>(() => {
    const rows: Row[] = [];
    const inline = new Map<DiffLine, InlineSpan[]>();
    for (const h of file.text.hunks) {
      for (const [line, spans] of computeHunkInline(h)) inline.set(line, spans);
      const crumb = enclosingSymbols(file.semantic.roots, h.newStart)
        .map((s) => s.name)
        .join(' › ');
      rows.push({
        kind: 'hunk',
        header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
        crumb,
        hunk: h,
      });
      for (const line of h.lines) rows.push({ kind: 'line', line });
    }
    return { rows, inline };
  });
  const rows = $derived(built.rows);

  // Group lines by top-level tree-sitter symbol (Story Mode only) — folding
  // follows code structure, not the incidental unified-diff hunk boundaries.
  // Folded, a block reads like an editor fold: its own first line of code,
  // unmodified, with a muted inline "N lines" marker appended — not a
  // separate synthetic header row.
  interface GroupBlock {
    key: string;
    lines: DiffLine[];
  }

  function topLevelSymbol(oldLine: number | null, newLine: number | null): SymbolChange | null {
    for (const r of file.semantic.roots) {
      if (r.new && newLine !== null && newLine >= r.new.startLine && newLine <= r.new.endLine) return r;
      if (r.old && oldLine !== null && oldLine >= r.old.startLine && oldLine <= r.old.endLine) return r;
    }
    return null;
  }

  const groupedBlocks = $derived.by<GroupBlock[]>(() => {
    if (!startFolded || file.semantic.textOnly) return [];
    const blocks: GroupBlock[] = [];
    let current: GroupBlock | null = null;
    for (const h of file.text.hunks) {
      for (const line of h.lines) {
        const root = topLevelSymbol(line.oldLine, line.newLine);
        const key = root?.id ?? '__file__';
        if (!current || current.key !== key) {
          current = { key, lines: [] };
          blocks.push(current);
        }
        current.lines.push(line);
      }
    }
    return blocks;
  });

  // Folding only makes sense when it actually produces an outline — a
  // text-only file (no symbol tree, e.g. an unsupported language like
  // Svelte) or a file whose whole diff sits under one symbol/no symbol at
  // all would otherwise "fold" to a single line hiding the entire file,
  // which isn't a fold, it's just hiding everything.
  const canFold = $derived(startFolded && groupedBlocks.length > 1);

  function blockFor(oldLine: number | null, newLine: number | null): GroupBlock | undefined {
    return groupedBlocks.find((b) =>
      b.lines.some((l) => (newLine !== null && l.newLine === newLine) || (oldLine !== null && l.oldLine === oldLine)),
    );
  }

  // Fold state per symbol-group key; reset only when the displayed *file*
  // changes (by path), not merely re-rendered — a background rebuild (e.g.
  // auto-refresh) replaces the `file` object with a new reference for the
  // same path, and must not silently discard the reader's expand state.
  let foldOverride = $state<Record<string, boolean>>({});
  $effect(() => {
    file.path;
    foldOverride = {};
  });
  function isFolded(key: string): boolean {
    return foldOverride[key] ?? true;
  }
  function toggleFold(key: string) {
    foldOverride[key] = !isFolded(key);
  }
  function sign(l: DiffLine): string {
    return l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' ';
  }

  const segments = (line: DiffLine) => lineSegments(line, built.inline.get(line));

  function inRange(line: DiffLine): boolean {
    if (!selected) return false;
    if (selected.new && line.newLine !== null) {
      if (line.newLine >= selected.new.startLine && line.newLine <= selected.new.endLine)
        return true;
    }
    if (selected.old && line.oldLine !== null) {
      if (line.oldLine >= selected.old.startLine && line.oldLine <= selected.old.endLine)
        return true;
    }
    return false;
  }

  let container = $state<HTMLDivElement | null>(null);

  // If the selected symbol is inside a folded block, expand that block first
  // so the target line actually exists in the DOM to scroll to.
  $effect(() => {
    if (!selected || !canFold) return;
    const block = blockFor(selected.old?.startLine ?? null, selected.new?.startLine ?? null);
    if (block && isFolded(block.key)) foldOverride[block.key] = false;
  });

  // Scroll the first line of the selected symbol into view when it changes.
  // Reads `isFolded` (not just `selected`) so this reruns once the effect
  // above has expanded the target block and the DOM has caught up.
  $effect(() => {
    if (!selected || !container) return;
    const target =
      selected.new?.startLine ?? selected.old?.startLine ?? null;
    const side = selected.new ? 'new' : 'old';
    if (target === null) return;
    if (canFold) {
      const block = blockFor(selected.old?.startLine ?? null, selected.new?.startLine ?? null);
      if (block && isFolded(block.key)) return;
    }
    const el = container.querySelector<HTMLElement>(
      `[data-${side}="${target}"]`,
    );
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
</script>

<div class="raw" class:nowrap={!wrap} class:neutral bind:this={container}>
  {#if file.binary}
    <p class="empty">Binary file — no textual diff.</p>
  {:else if file.text.truncated}
    <p class="empty">File too large to diff ({file.add + file.del} lines changed).</p>
  {:else if rows.length === 0}
    <p class="empty">No textual changes.</p>
  {:else if canFold}
    <table>
      <tbody>
        {#each groupedBlocks as block, i (i)}
          {@const foldable = block.lines.length > 1}
          {@const folded = foldable && isFolded(block.key)}
          {@const head = block.lines[0]}
          {@const rest = block.lines.slice(1)}
          {@const restAdd = rest.filter((l) => l.op === 'add').length}
          {@const restDel = rest.filter((l) => l.op === 'del').length}
          <tr
            class="line {head.op}"
            class:hl={inRange(head)}
            class:fold-head={folded}
            data-old={head.oldLine ?? ''}
            data-new={head.newLine ?? ''}
            onclick={folded ? () => toggleFold(block.key) : undefined}
          >
            <td class="fold-gutter">
              {#if foldable}
                <button
                  class="fold-toggle"
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleFold(block.key);
                  }}
                  aria-label={folded ? 'Expand' : 'Collapse'}
                >{folded ? '▸' : '▾'}</button>
              {/if}
            </td>
            <td class="gutter num">{head.oldLine ?? ''}</td>
            <td class="gutter num">{head.newLine ?? ''}</td>
            <td class="code">
              <span class="sign">{sign(head)}</span
              >{#each segments(head) as seg}<span class={seg.cls}>{seg.text}</span>{/each}
              {#if folded}
                <span class="fold-suffix"
                  >⋯ {rest.length} line{rest.length === 1 ? '' : 's'}{#if restAdd || restDel} <span class="fold-counts">{#if restAdd}<span class="add">+{restAdd}</span>{/if}{#if restDel}<span class="del">−{restDel}</span>{/if}</span>{/if} ⋯</span
                >
              {/if}
            </td>
          </tr>
          {#if !folded}
            {#each rest as l}
              <tr
                class="line {l.op}"
                class:hl={inRange(l)}
                data-old={l.oldLine ?? ''}
                data-new={l.newLine ?? ''}
              >
                <td class="fold-gutter"></td>
                <td class="gutter num">{l.oldLine ?? ''}</td>
                <td class="gutter num">{l.newLine ?? ''}</td>
                <td class="code">
                  <span class="sign">{sign(l)}</span
                  >{#each segments(l) as seg}<span class={seg.cls}>{seg.text}</span>{/each}
                </td>
              </tr>
            {/each}
          {/if}
        {/each}
      </tbody>
    </table>
  {:else}
    <table>
      <tbody>
        {#each rows as row}
          {#if row.kind === 'hunk'}
            <tr class="hunk-row">
              <td class="gutter" colspan="2"></td>
              <td class="hunk-head">
                <span class="hunk-at">{row.header}</span>
                {#if row.crumb}<span class="crumb">{row.crumb}</span>{/if}
                {#if onHunkAction && row.hunk}
                  {@const hunk = row.hunk}
                  <span class="hunk-actions">
                    {#if section === 'unstaged'}
                      <button onclick={() => onHunkAction(hunk, 'stage')}>Stage hunk</button>
                      <button class="danger" onclick={() => onHunkAction(hunk, 'discard')}>Discard hunk</button>
                    {:else if section === 'staged'}
                      <button onclick={() => onHunkAction(hunk, 'unstage')}>Unstage hunk</button>
                    {/if}
                  </span>
                {/if}
              </td>
            </tr>
          {:else if row.line}
            {@const l = row.line}
            <tr
              class="line {l.op}"
              class:hl={inRange(l)}
              data-old={l.oldLine ?? ''}
              data-new={l.newLine ?? ''}
            >
              <td class="gutter num">{l.oldLine ?? ''}</td>
              <td class="gutter num">{l.newLine ?? ''}</td>
              <td class="code">
                <span class="sign">{l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}</span
                >{#each segments(l) as seg}<span class={seg.cls}>{seg.text}</span>{/each}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .raw {
    height: 100%;
    overflow: auto;
    background: var(--bg);
  }
  .empty {
    color: var(--fg-muted);
    padding: 24px;
    text-align: center;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--mono);
    font-size: var(--code-font-size, 0.75rem);
    line-height: 1.55;
  }
  .gutter {
    text-align: right;
    padding: 0 8px;
    color: var(--fg-muted);
    user-select: none;
    width: 1%;
    white-space: nowrap;
    border-right: 1px solid var(--border);
    vertical-align: top;
  }
  .code {
    padding: 0 12px;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 4;
  }
  .raw.nowrap .code {
    white-space: pre;
    word-break: normal;
  }
  /* Neutral mode: whole-file add/remove reads like plain code, not a green/red
     wall. Syntax highlighting stays; the header badge conveys add/remove. */
  .raw.neutral .line.add,
  .raw.neutral .line.del {
    background: transparent;
  }
  .raw.neutral .sign {
    visibility: hidden;
  }
  .sign {
    display: inline-block;
    width: 1ch;
    color: var(--fg-muted);
    user-select: none;
  }
  .line.add {
    background: var(--add-bg);
  }
  .line.add .sign {
    color: var(--add-fg);
  }
  .line.del {
    background: var(--del-bg);
  }
  .line.del .sign {
    color: var(--del-fg);
  }
  .line.add .chg {
    background: var(--add-inline);
    border-radius: 2px;
  }
  .line.del .chg {
    background: var(--del-inline);
    border-radius: 2px;
  }

  /* Syntax highlighting */
  .code :global(.tok-keyword) { color: var(--syn-keyword); }
  .code :global(.tok-string) { color: var(--syn-string); }
  .code :global(.tok-number) { color: var(--syn-number); }
  .code :global(.tok-comment) { color: var(--syn-comment); font-style: italic; }
  .code :global(.tok-type) { color: var(--syn-type); }
  .code :global(.tok-constant) { color: var(--syn-constant); }
  .code :global(.tok-function) { color: var(--syn-function); }
  .code :global(.tok-property) { color: var(--syn-property); }
  .line.hl td {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .hunk-row .hunk-head {
    padding: 4px 12px;
    background: var(--bg-subtle);
    font-size: 0.6875rem;
  }
  .hunk-at {
    color: var(--accent);
  }
  .crumb {
    color: var(--fg-muted);
    margin-left: 10px;
  }
  .fold-gutter {
    width: 14px;
    min-width: 14px;
    padding: 0;
    text-align: center;
    vertical-align: top;
    user-select: none;
  }
  .fold-toggle {
    border: none;
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0;
    font-size: 0.5625rem;
    line-height: inherit;
    vertical-align: top;
  }
  .fold-toggle:hover {
    color: var(--accent);
  }
  .line.fold-head {
    cursor: pointer;
  }
  /* box-shadow (not background) so the underlying add/del tint still shows
     through on hover — it composites instead of replacing the row color. */
  .line.fold-head:hover td {
    box-shadow: inset 0 0 0 9999px color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .line.fold-head:hover .fold-suffix {
    background: var(--bg-inset);
  }
  .fold-suffix {
    margin-left: 8px;
    padding: 0 6px;
    border-radius: 3px;
    background: var(--bg-subtle);
    color: var(--fg-muted);
    font-style: italic;
    font-size: 0.9em;
  }
  .fold-counts {
    font-style: normal;
    margin-left: 4px;
  }
  .fold-counts .add {
    color: var(--add-fg);
  }
  .fold-counts .del {
    color: var(--del-fg);
  }
  .hunk-row .gutter {
    background: var(--bg-subtle);
  }
  .hunk-actions {
    float: right;
    display: flex;
    gap: 6px;
  }
  .hunk-actions button {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--fg-muted);
    padding: 1px 8px;
    cursor: pointer;
    font-size: 0.6562rem;
    font-family: var(--sans);
  }
  .hunk-actions button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .hunk-actions button.danger:hover {
    border-color: var(--del-fg);
    color: var(--del-fg);
  }
</style>
