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
  }
  let { file, selected = null, wrap = true, neutral = false, section = null, onHunkAction }: Props =
    $props();

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

  const seg = (line: DiffLine) => lineSegments(line, built.inline.get(line));

  function inRange(line: DiffLine | undefined, side: 'old' | 'new'): boolean {
    if (!line || !selected) return false;
    const ref = side === 'old' ? selected.old : selected.new;
    const ln = side === 'old' ? line.oldLine : line.newLine;
    return !!ref && ln !== null && ln >= ref.startLine && ln <= ref.endLine;
  }

  let container = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (!selected || !container) return;
    const target = selected.new?.startLine ?? selected.old?.startLine ?? null;
    const side = selected.new ? 'new' : 'old';
    if (target === null) return;
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
  .c-num { width: 44px; }
  .c-code { width: calc(50% - 44px); }
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
