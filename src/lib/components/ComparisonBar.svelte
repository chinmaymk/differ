<script lang="ts">
  import type { CommitInfo } from '../engine/model';
  import type { Comparison } from './comparison';

  interface Props {
    comparison: Comparison;
    commits: CommitInfo[];
    onSelect: (c: Comparison) => void;
  }
  let { comparison, commits, onSelect }: Props = $props();

  let open = $state(false);

  const label = $derived(
    comparison.kind === 'worktree'
      ? 'Uncommitted changes'
      : `${comparison.commit.shortSha}  ${comparison.commit.summary}`,
  );

  function choose(c: Comparison) {
    open = false;
    onSelect(c);
  }

  function ago(sec: number): string {
    const s = Math.floor(Date.now() / 1000) - sec;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  function onWindowClick(e: MouseEvent) {
    if (open && !(e.target as HTMLElement).closest('.cmp')) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="cmp">
  <button class="trigger" onclick={() => (open = !open)} title="Change what you're comparing">
    <span class="ico">{comparison.kind === 'worktree' ? '◐' : '◉'}</span>
    <span class="lbl">{label}</span>
    <span class="chev">▾</span>
  </button>

  {#if open}
    <div class="menu">
      <button
        class="opt"
        class:on={comparison.kind === 'worktree'}
        onclick={() => choose({ kind: 'worktree' })}
      >
        <span class="ico">◐</span>
        <span class="otext"><span class="otitle">Uncommitted changes</span><span class="osub">Working tree vs HEAD</span></span>
      </button>

      {#if commits.length > 0}
        <div class="sec">History</div>
        <div class="commits">
          {#each commits as c (c.sha)}
            <button
              class="opt"
              class:on={comparison.kind === 'commit' && comparison.commit.sha === c.sha}
              onclick={() => choose({ kind: 'commit', commit: c })}
            >
              <span class="sha">{c.shortSha}</span>
              <span class="otext">
                <span class="otitle">{c.summary}</span>
                <span class="osub">{c.author} · {ago(c.timestamp)}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cmp {
    position: relative;
    padding: 8px;
    border-bottom: 1px solid var(--border);
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    cursor: pointer;
    color: var(--fg);
    font-size: 12px;
    text-align: left;
  }
  .trigger:hover {
    border-color: var(--accent);
  }
  .ico {
    color: var(--accent);
    flex: none;
  }
  .lbl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    color: var(--fg-muted);
    flex: none;
  }
  .menu {
    position: absolute;
    top: calc(100% - 2px);
    left: 8px;
    right: 8px;
    z-index: 20;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
  }
  .sec {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    padding: 8px 10px 4px;
    border-top: 1px solid var(--border);
  }
  .commits {
    overflow: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: none;
    background: none;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    padding: 7px 10px;
  }
  .opt:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .opt.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .sha {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
    flex: none;
    width: 7ch;
  }
  .otext {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .otitle {
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .osub {
    font-size: 10.5px;
    color: var(--fg-muted);
  }
</style>
