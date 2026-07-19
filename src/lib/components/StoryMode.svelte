<script lang="ts">
  /**
   * Full-screen, story/reel-style review overlay: walks changed files one at
   * a time, ordered by computed importance (highest-impact first). Builds
   * every file's diff upfront (unlike the main viewer's lazy per-click
   * build), then runs a repo-wide pass for duplicate-code and blast-radius
   * signals before ranking. Read-only — no staging affordances.
   */
  import type { ChangedFile, DiffSource, FileDiff, Revision, SymbolChange } from '../engine/model';
  import { sectionKey, type SectionKey } from './staging';
  import FileDiffView from './FileDiffView.svelte';
  import {
    scoreFile,
    type FileImportance,
    type DuplicateMatch,
    type SymbolBlastRadius,
  } from '../engine/importance';
  import { buildRepoIndex, type RepoIndex } from '../engine/dup-index';
  import { findDuplicate } from '../engine/duplicates';
  import { confirmReferences, type FetchCache } from '../engine/blast-radius';

  interface Props {
    files: { section: SectionKey; file: ChangedFile }[];
    source: DiffSource;
    results: Record<string, FileDiff>;
    errors: Record<string, string>;
    viewed: Set<string>;
    head: (section: SectionKey) => Revision;
    viewMode: 'unified' | 'split';
    wrap: boolean;
    showSemantic: boolean;
    onBuildOne: (section: SectionKey, file: ChangedFile, force?: boolean) => Promise<void>;
    onMarkViewed: (section: SectionKey, path: string) => void;
    onClose: (last: { section: SectionKey; path: string } | null) => void;
  }
  let {
    files,
    source,
    results,
    errors,
    viewed,
    head,
    viewMode,
    wrap,
    showSemantic,
    onBuildOne,
    onMarkViewed,
    onClose,
  }: Props = $props();

  // Kinds where a textual name-match is a plausible real reference (see
  // blast-radius.ts's design notes) — member/test/other are too collision-prone.
  const BLAST_KINDS = new Set([
    'function', 'method', 'class', 'struct', 'interface', 'enum', 'type', 'trait', 'module', 'constant',
  ]);

  let phase = $state<'building' | 'indexing' | 'ready'>('building');
  let indexProgress = $state({ done: 0, total: 0 });
  let matching = $state(false);
  let order = $state<{ section: SectionKey; path: string; importance: FileImportance }[]>([]);
  let index = $state(0);

  const settledCount = $derived(
    files.filter((f) => {
      const k = sectionKey(f.section, f.file.path);
      return results[k] || errors[k];
    }).length,
  );

  // One-time kickoff, guarded like App.svelte's `didAutoOpen` so it fires
  // exactly once and never re-triggers as `results`/`errors` update — a
  // plain reactive $effect (no guard) would re-run this loop on every
  // build completion, re-requesting files that are still in flight.
  let kickedOff = false;
  $effect(() => {
    if (kickedOff) return;
    kickedOff = true;
    for (const f of files) {
      const k = sectionKey(f.section, f.file.path);
      if (!results[k] && !errors[k]) void onBuildOne(f.section, f.file);
    }
  });

  function collectChanged(roots: SymbolChange[], out: SymbolChange[] = []): SymbolChange[] {
    for (const c of roots) {
      if (c.status !== 'unchanged') out.push(c);
      collectChanged(c.children, out);
    }
    return out;
  }

  async function computeSignals(
    diff: FileDiff,
    repoIndex: RepoIndex,
    rev: Revision,
    cache: FetchCache,
  ): Promise<{ duplicates: DuplicateMatch[]; blastRadii: SymbolBlastRadius[] }> {
    const duplicates: DuplicateMatch[] = [];
    const blastRadii: SymbolBlastRadius[] = [];
    if (diff.semantic.textOnly) return { duplicates, blastRadii };

    const changed = collectChanged(diff.semantic.roots);
    await Promise.all(
      changed.map(async (c) => {
        if (c.status === 'added' || c.status === 'modified') {
          const dup = findDuplicate({ kind: c.kind, fingerprint: c.fingerprint }, diff.path, repoIndex);
          if (dup) {
            duplicates.push({
              symbolId: c.id,
              symbolName: c.name,
              matchPath: dup.path,
              matchName: dup.name,
              similarity: dup.similarity,
            });
          }
        }
        if (
          BLAST_KINDS.has(c.kind) &&
          (c.status === 'added' || c.status === 'modified' || c.status === 'removed') &&
          source.readFileAt
        ) {
          const br = await confirmReferences(c.name, diff.path, repoIndex, source, rev, cache);
          if (br.count > 0) blastRadii.push({ ...br, symbolId: c.id });
        }
      }),
    );
    return { duplicates, blastRadii };
  }

  async function runIndexingAndRank(): Promise<void> {
    const rev = head('unstaged');
    const repoIndex = await buildRepoIndex(source, rev, (done, total) => {
      indexProgress = { done, total };
    });

    matching = true;
    const cache: FetchCache = new Map();
    const ranked: { section: SectionKey; path: string; importance: FileImportance }[] = [];
    await Promise.all(
      files.map(async (f) => {
        const k = sectionKey(f.section, f.file.path);
        const diff = results[k];
        if (!diff) return;
        const signals = repoIndex ? await computeSignals(diff, repoIndex, rev, cache) : undefined;
        ranked.push({
          section: f.section,
          path: f.file.path,
          importance: scoreFile(diff, signals),
        });
      }),
    );
    ranked.sort((a, b) => b.importance.score - a.importance.score);
    order = ranked;
    matching = false;
    phase = 'ready';
  }

  $effect(() => {
    if (phase === 'building' && files.length > 0 && settledCount >= files.length) {
      phase = 'indexing';
      void runIndexingAndRank();
    } else if (phase === 'building' && files.length === 0) {
      phase = 'ready';
    }
  });

  const current = $derived(order[index] ?? null);
  const currentDiff = $derived(current ? results[sectionKey(current.section, current.path)] : null);

  $effect(() => {
    if (current) onMarkViewed(current.section, current.path);
  });

  function next() {
    if (index < order.length - 1) index++;
  }
  function prev() {
    if (index > 0) index--;
  }
  function close() {
    onClose(current ? { section: current.section, path: current.path } : null);
  }

  function onStoryKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={onStoryKey} />

<div class="story">
  <header class="story-top">
    <div class="segments">
      {#each order as item, i (sectionKey(item.section, item.path))}
        <button
          class="segment"
          class:done={i < index || viewed.has(sectionKey(item.section, item.path))}
          class:active={i === index}
          onclick={() => (index = i)}
          aria-label={`Go to ${item.path}`}
        ></button>
      {/each}
    </div>
    <div class="story-controls">
      {#if order.length > 0}
        <span class="counter">{index + 1} / {order.length}</span>
      {/if}
      <button class="close" onclick={close} aria-label="Close Story Mode" title="Close (Esc)">✕</button>
    </div>
  </header>

  {#if phase !== 'ready'}
    <div class="loading">
      {#if phase === 'building'}
        <p>Preparing files… ({settledCount}/{files.length})</p>
      {:else if matching}
        <p>Finding duplicates &amp; checking references…</p>
      {:else}
        <p>Scanning repository… ({indexProgress.done}/{indexProgress.total})</p>
      {/if}
      <div class="spinner" aria-hidden="true"></div>
    </div>
  {:else if !current}
    <div class="loading">
      <p>No files to review.</p>
    </div>
  {:else}
    <div class="slide">
      <div class="diff-area">
        {#if currentDiff}
          <FileDiffView
            file={currentDiff}
            {viewMode}
            {wrap}
            {showSemantic}
            onToggleSemantic={() => {}}
            reasons={current.importance.reasons}
            startFolded
          />
        {/if}
      </div>
      <footer class="story-footer">
        <button onclick={prev} disabled={index === 0}>← Prev</button>
        <span class="counter">{index + 1} of {order.length}</span>
        <button onclick={next} disabled={index === order.length - 1}>Next →</button>
      </footer>
    </div>
  {/if}
</div>

<style>
  .story {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
  }
  .story-top {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
  }
  .segments {
    flex: 1;
    display: flex;
    gap: 3px;
    min-width: 0;
  }
  .segment {
    flex: 1;
    height: 4px;
    min-width: 3px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: var(--border);
    cursor: pointer;
  }
  .segment.done {
    background: var(--fg-muted);
  }
  .segment.active {
    background: var(--accent);
  }
  .story-controls {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .counter {
    color: var(--fg-muted);
    font-size: 0.7188rem;
    font-family: var(--mono);
    white-space: nowrap;
  }
  .close {
    border: none;
    background: none;
    color: var(--fg-muted);
    font-size: 1rem;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
  }
  .close:hover {
    color: var(--accent);
  }
  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--fg-muted);
  }
  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: story-spin 0.7s linear infinite;
  }
  @keyframes story-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .slide {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .diff-area {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .story-footer {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-subtle);
  }
</style>
