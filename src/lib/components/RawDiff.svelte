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
  }
  let { file, selected = null, wrap = true, neutral = false, section = null, onHunkAction }: Props =
    $props();

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

  // Scroll the first line of the selected symbol into view when it changes.
  $effect(() => {
    if (!selected || !container) return;
    const target =
      selected.new?.startLine ?? selected.old?.startLine ?? null;
    const side = selected.new ? 'new' : 'old';
    if (target === null) return;
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
