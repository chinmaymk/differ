<script lang="ts">
  import type { FileDiff, DiffLine, Hunk, HunkMode, InlineSpan, SymbolChange } from '../engine/model';
  import { computeHunkInline } from '../engine/text-diff';
  import { lineSegments } from './segments';
  import type { SectionKey } from './staging';

  interface Props {
    file: FileDiff;
    selected?: SymbolChange | null;
    wrap?: boolean;
    neutral?: boolean;
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

  interface SplitRow {
    kind: 'hunk' | 'pair';
    header?: string;
    hunk?: Hunk;
    left?: DiffLine;
    right?: DiffLine;
  }

  const built = $derived.by<{ rows: SplitRow[]; inline: Map<DiffLine, InlineSpan[]> }>(() => {
    const rows: SplitRow[] = [];
    const inline = new Map<DiffLine, InlineSpan[]>();
    for (const h of file.text.hunks) {
      for (const [line, spans] of computeHunkInline(h)) inline.set(line, spans);
      rows.push({
        kind: 'hunk',
        header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
        hunk: h,
      });
      const lines = h.lines;
      let i = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.op === 'context') {
          rows.push({ kind: 'pair', left: l, right: l });
          i++;
          continue;
        }
        const dels: DiffLine[] = [];
        while (i < lines.length && lines[i].op === 'del') dels.push(lines[i++]);
        const adds: DiffLine[] = [];
        while (i < lines.length && lines[i].op === 'add') adds.push(lines[i++]);
        const m = Math.max(dels.length, adds.length);
        for (let k = 0; k < m; k++) {
          rows.push({ kind: 'pair', left: dels[k], right: adds[k] });
        }
      }
    }
    return { rows, inline };
  });

  // Group pairs by top-level tree-sitter symbol (Story Mode only) — folding
  // follows code structure, not the incidental unified-diff hunk boundaries.
  // Folded, a block reads like an editor fold: its own first pair of lines,
  // unmodified, with a muted inline "N lines" marker appended — not a
  // separate synthetic header row.
  interface Pair {
    left?: DiffLine;
    right?: DiffLine;
  }
  interface GroupBlock {
    key: string;
    pairs: Pair[];
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
    for (const row of built.rows) {
      if (row.kind !== 'pair') continue;
      const newLine = row.right?.newLine ?? null;
      const oldLine = row.left?.oldLine ?? null;
      const root = topLevelSymbol(oldLine, newLine);
      const key = root?.id ?? '__file__';
      if (!current || current.key !== key) {
        current = { key, pairs: [] };
        blocks.push(current);
      }
      current.pairs.push({ left: row.left, right: row.right });
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
      b.pairs.some(
        (p) =>
          (newLine !== null && p.right?.newLine === newLine) ||
          (oldLine !== null && p.left?.oldLine === oldLine),
      ),
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

  const seg = (line: DiffLine) => lineSegments(line, built.inline.get(line));

  function inRange(line: DiffLine | undefined, side: 'old' | 'new'): boolean {
    if (!line || !selected) return false;
    const ref = side === 'old' ? selected.old : selected.new;
    const ln = side === 'old' ? line.oldLine : line.newLine;
    return !!ref && ln !== null && ln >= ref.startLine && ln <= ref.endLine;
  }

  let container = $state<HTMLDivElement | null>(null);

  // If the selected symbol is inside a folded block, expand that block first
  // so the target line actually exists in the DOM to scroll to.
  $effect(() => {
    if (!selected || !canFold) return;
    const block = blockFor(selected.old?.startLine ?? null, selected.new?.startLine ?? null);
    if (block && isFolded(block.key)) foldOverride[block.key] = false;
  });

  // Reads `isFolded` (not just `selected`) so this reruns once the effect
  // above has expanded the target block and the DOM has caught up.
  $effect(() => {
    if (!selected || !container) return;
    const target = selected.new?.startLine ?? selected.old?.startLine ?? null;
    const side = selected.new ? 'new' : 'old';
    if (target === null) return;
    if (canFold) {
      const block = blockFor(selected.old?.startLine ?? null, selected.new?.startLine ?? null);
      if (block && isFolded(block.key)) return;
    }
    container
      .querySelector<HTMLElement>(`[data-${side}="${target}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
</script>

<div class="split" class:nowrap={!wrap} class:neutral bind:this={container}>
  {#if file.binary}
    <p class="empty">Binary file — no textual diff.</p>
  {:else if file.text.truncated}
    <p class="empty">File too large to diff ({file.add + file.del} lines changed).</p>
  {:else if built.rows.length === 0}
    <p class="empty">No textual changes.</p>
  {:else if canFold}
    <table>
      <colgroup>
        <col class="c-fold" />
        <col class="c-num" /><col class="c-code-f" />
        <col class="c-num" /><col class="c-code-f" />
      </colgroup>
      <tbody>
        {#each groupedBlocks as block, i (i)}
          {@const foldable = block.pairs.length > 1}
          {@const folded = foldable && isFolded(block.key)}
          {@const head = block.pairs[0]}
          {@const rest = block.pairs.slice(1)}
          {@const restAdd = rest.filter((p) => p.right?.op === 'add').length}
          {@const restDel = rest.filter((p) => p.left?.op === 'del').length}
          {@const L = head.left}
          {@const R = head.right}
          <tr class:fold-head={folded} onclick={folded ? () => toggleFold(block.key) : undefined}>
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
            <td class="num" class:del={L?.op === 'del'}>{L?.oldLine ?? ''}</td>
            <td
              class="code"
              class:del={L?.op === 'del'}
              class:filler={!L}
              class:hl={inRange(L, 'old')}
              data-old={L?.oldLine ?? ''}
            >{#if L}{#each seg(L) as s}<span class={s.cls}>{s.text}</span>{/each}{/if}</td>
            <td class="num" class:add={R?.op === 'add'}>{R?.newLine ?? ''}</td>
            <td
              class="code"
              class:add={R?.op === 'add'}
              class:filler={!R}
              class:hl={inRange(R, 'new')}
              data-new={R?.newLine ?? ''}
            >{#if R}{#each seg(R) as s}<span class={s.cls}>{s.text}</span>{/each}{/if}{#if folded}<span class="fold-suffix">⋯ {rest.length} line{rest.length === 1 ? '' : 's'}{#if restAdd || restDel} <span class="fold-counts">{#if restAdd}<span class="add">+{restAdd}</span>{/if}{#if restDel}<span class="del">−{restDel}</span>{/if}</span>{/if} ⋯</span>{/if}</td>
          </tr>
          {#if !folded}
            {#each rest as p}
              {@const PL = p.left}
              {@const PR = p.right}
              <tr>
                <td class="fold-gutter"></td>
                <td class="num" class:del={PL?.op === 'del'}>{PL?.oldLine ?? ''}</td>
                <td
                  class="code"
                  class:del={PL?.op === 'del'}
                  class:filler={!PL}
                  class:hl={inRange(PL, 'old')}
                  data-old={PL?.oldLine ?? ''}
                >{#if PL}{#each seg(PL) as s}<span class={s.cls}>{s.text}</span>{/each}{/if}</td>
                <td class="num" class:add={PR?.op === 'add'}>{PR?.newLine ?? ''}</td>
                <td
                  class="code"
                  class:add={PR?.op === 'add'}
                  class:filler={!PR}
                  class:hl={inRange(PR, 'new')}
                  data-new={PR?.newLine ?? ''}
                >{#if PR}{#each seg(PR) as s}<span class={s.cls}>{s.text}</span>{/each}{/if}</td>
              </tr>
            {/each}
          {/if}
        {/each}
      </tbody>
    </table>
  {:else}
    <table>
      <colgroup>
        <col class="c-num" /><col class="c-code" />
        <col class="c-num" /><col class="c-code" />
      </colgroup>
      <tbody>
        {#each built.rows as row}
          {#if row.kind === 'hunk'}
            <tr class="hunk-row">
              <td class="hunk-head" colspan="4">
                {row.header}
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
          {:else}
            {@const L = row.left}
            {@const R = row.right}
            <tr>
              <td class="num" class:del={L?.op === 'del'}>{L?.oldLine ?? ''}</td>
              <td
                class="code"
                class:del={L?.op === 'del'}
                class:filler={!L}
                class:hl={inRange(L, 'old')}
                data-old={L?.oldLine ?? ''}
              >{#if L}{#each seg(L) as s}<span class={s.cls}>{s.text}</span>{/each}{/if}</td>
              <td class="num" class:add={R?.op === 'add'}>{R?.newLine ?? ''}</td>
              <td
                class="code"
                class:add={R?.op === 'add'}
                class:filler={!R}
                class:hl={inRange(R, 'new')}
                data-new={R?.newLine ?? ''}
              >{#if R}{#each seg(R) as s}<span class={s.cls}>{s.text}</span>{/each}{/if}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .split {
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
    table-layout: fixed;
  }
  .c-fold { width: 14px; }
  .c-num { width: 44px; }
  .c-code { width: calc(50% - 44px); }
  .c-code-f { width: calc(50% - 51px); }
  .num {
    text-align: right;
    padding: 0 8px;
    color: var(--fg-muted);
    user-select: none;
    white-space: nowrap;
    border-right: 1px solid var(--border);
    vertical-align: top;
  }
  .code {
    padding: 0 10px;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 4;
    vertical-align: top;
    border-right: 1px solid var(--border);
  }
  /* Fixed layout + wrapping don't mix; allow horizontal scroll when unwrapped. */
  .split.nowrap table {
    table-layout: auto;
  }
  .split.nowrap .code {
    white-space: pre;
    word-break: normal;
  }
  .code.del,
  .num.del { background: var(--del-bg); }
  .code.add,
  .num.add { background: var(--add-bg); }
  .code.filler { background: var(--bg-subtle); }
  .split.neutral .code.add,
  .split.neutral .num.add,
  .split.neutral .code.del,
  .split.neutral .num.del {
    background: transparent;
  }
  .code.hl { box-shadow: inset 2px 0 0 var(--accent); }
  .code :global(.chg) { border-radius: 2px; }
  .code.del :global(.chg) { background: var(--del-inline); }
  .code.add :global(.chg) { background: var(--add-inline); }
  .hunk-head {
    color: var(--accent);
    padding: 4px 12px;
    background: var(--bg-subtle);
    font-size: 0.6875rem;
  }
  .fold-gutter {
    width: 14px;
    min-width: 14px;
    padding: 0;
    text-align: center;
    vertical-align: top;
    user-select: none;
    border-right: 1px solid var(--border);
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
  tr.fold-head {
    cursor: pointer;
  }
  /* box-shadow (not background) so the underlying add/del tint still shows
     through on hover — it composites instead of replacing the row color. */
  tr.fold-head:hover td {
    box-shadow: inset 0 0 0 9999px color-mix(in srgb, var(--fg) 6%, transparent);
  }
  tr.fold-head:hover .fold-suffix {
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
  /* Syntax highlighting (shared classes) */
  .code :global(.tok-keyword) { color: var(--syn-keyword); }
  .code :global(.tok-string) { color: var(--syn-string); }
  .code :global(.tok-number) { color: var(--syn-number); }
  .code :global(.tok-comment) { color: var(--syn-comment); font-style: italic; }
  .code :global(.tok-type) { color: var(--syn-type); }
  .code :global(.tok-constant) { color: var(--syn-constant); }
  .code :global(.tok-function) { color: var(--syn-function); }
  .code :global(.tok-property) { color: var(--syn-property); }
</style>
