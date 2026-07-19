<script lang="ts">
  import type { BranchInfo, CommitInfo, TagInfo, WorktreeInfo } from '../engine/model';
  import type { Comparison } from './comparison';
  import { fuzzyFilter } from './fuzzy';

  interface Props {
    comparison: Comparison;
    commits: CommitInfo[];
    branches: BranchInfo[];
    tags: TagInfo[];
    worktrees: WorktreeInfo[];
    canRevert: boolean;
    currentPath: string | undefined;
    onSelect: (c: Comparison) => void;
    onOpenWorktree: (path: string) => void;
    onRevertCommit: (sha: string) => void;
  }
  let {
    comparison,
    commits,
    branches,
    tags,
    worktrees,
    canRevert,
    currentPath,
    onSelect,
    onOpenWorktree,
    onRevertCommit,
  }: Props = $props();

  type Tab = 'history' | 'branches' | 'tags' | 'worktrees';
  let open = $state(false);
  let tab = $state<Tab>('history');
  let query = $state('');
  let copied = $state<string | null>(null);
  /** sha of the commit whose "…" actions popover is open, if any. */
  let menuFor = $state<string | null>(null);
  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);

  const COPY_FLASH_MS = 1200;
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Floating, independently-resizable menu ---------------------------
  // Rendered via `position: fixed` (not anchored under `.cmp`) so it isn't
  // clipped by the sidebar's `overflow: hidden` and can grow across the
  // window; size/position are plain state rather than CSS so the resize
  // handle and viewport clamping can drive them directly.
  const MENU_SIZE_KEY = 'dv-cmp-menu-size';
  const MENU_MIN_W = 320;
  const MENU_MIN_H = 260;
  const MENU_DEFAULT_W = 480;
  const MENU_DEFAULT_H = 480;
  const VIEWPORT_MARGIN = 12;

  function loadMenuSize(): { w: number; h: number } {
    try {
      const s = JSON.parse(localStorage.getItem(MENU_SIZE_KEY) ?? '{}');
      return {
        w: typeof s.w === 'number' && s.w >= MENU_MIN_W ? s.w : MENU_DEFAULT_W,
        h: typeof s.h === 'number' && s.h >= MENU_MIN_H ? s.h : MENU_DEFAULT_H,
      };
    } catch {
      return { w: MENU_DEFAULT_W, h: MENU_DEFAULT_H };
    }
  }
  const initialMenuSize = loadMenuSize();
  let menuWidth = $state(initialMenuSize.w);
  let menuHeight = $state(initialMenuSize.h);
  let menuTop = $state(0);
  let menuLeft = $state(0);
  let resizing = $state(false);

  function saveMenuSize() {
    localStorage.setItem(MENU_SIZE_KEY, JSON.stringify({ w: menuWidth, h: menuHeight }));
  }

  /** Anchor the menu below the trigger, clamped so it stays fully on-screen
   * regardless of where the trigger sits or how large the menu has grown. */
  function positionMenu() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const maxLeft = window.innerWidth - menuWidth - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - menuHeight - VIEWPORT_MARGIN;
    menuLeft = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
    menuTop = Math.max(VIEWPORT_MARGIN, Math.min(rect.bottom + 4, maxTop));
  }

  function startResize(e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    resizing = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = menuWidth;
    const startH = menuHeight;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const maxW = window.innerWidth - menuLeft - VIEWPORT_MARGIN;
      const maxH = window.innerHeight - menuTop - VIEWPORT_MARGIN;
      menuWidth = Math.max(MENU_MIN_W, Math.min(maxW, startW + (ev.clientX - startX)));
      menuHeight = Math.max(MENU_MIN_H, Math.min(maxH, startH + (ev.clientY - startY)));
    };
    const up = (ev: PointerEvent) => {
      resizing = false;
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      saveMenuSize();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  $effect(() => {
    if (!open) return;
    const onResize = () => positionMenu();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const label = $derived(
    comparison.kind === 'worktree'
      ? 'Uncommitted changes'
      : comparison.kind === 'branch'
        ? `Branch: ${comparison.name}`
        : comparison.kind === 'tag'
          ? `Tag: ${comparison.name}`
          : `${comparison.commit.shortSha}  ${comparison.commit.summary}`,
  );
  const triggerIcon = $derived(
    comparison.kind === 'worktree'
      ? '◐'
      : comparison.kind === 'branch'
        ? '◈'
        : comparison.kind === 'tag'
          ? '◆'
          : '◉',
  );

  const filteredCommits = $derived(
    fuzzyFilter(query, commits, (c) => `${c.sha} ${c.summary} ${c.author}`),
  );
  const filteredBranches = $derived(
    fuzzyFilter(query, branches, (b) => `${b.name} ${b.upstream ?? ''}`),
  );
  const filteredTags = $derived(
    fuzzyFilter(query, tags, (t) => `${t.name} ${t.message ?? ''}`),
  );
  const filteredWorktrees = $derived(
    fuzzyFilter(query, worktrees, (w) => `${w.path} ${w.branch ?? ''}`),
  );
  const emptyMessage = $derived(
    tab === 'history'
      ? commits.length === 0
        ? 'No commits yet'
        : 'No matching commits'
      : tab === 'branches'
        ? branches.length === 0
          ? 'No branches'
          : 'No matching branches'
        : tab === 'tags'
          ? tags.length === 0
            ? 'No tags'
            : 'No matching tags'
          : worktrees.length === 0
            ? 'No worktrees'
            : 'No matching worktrees',
  );

  function toggleOpen() {
    open = !open;
    menuFor = null;
    if (open) {
      query = '';
      positionMenu();
    }
  }

  function choose(c: Comparison) {
    open = false;
    menuFor = null;
    onSelect(c);
  }

  function openWorktree(path: string) {
    open = false;
    menuFor = null;
    onOpenWorktree(path);
  }

  function toggleMenu(e: MouseEvent, sha: string) {
    e.stopPropagation();
    menuFor = menuFor === sha ? null : sha;
  }

  function revert(e: MouseEvent, sha: string) {
    e.stopPropagation();
    open = false;
    menuFor = null;
    onRevertCommit(sha);
  }

  function copy(e: MouseEvent, key: string, text: string) {
    e.stopPropagation();
    menuFor = null;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        if (copyResetTimer) clearTimeout(copyResetTimer);
        copied = key;
        copyResetTimer = setTimeout(() => {
          copied = null;
          copyResetTimer = null;
        }, COPY_FLASH_MS);
      })
      .catch(() => {});
  }

  function ago(sec: number): string {
    const s = Math.floor(Date.now() / 1000) - sec;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  function onWindowClick(e: MouseEvent) {
    if (resizing) return;
    const target = e.target as HTMLElement;
    if (menuFor && !target.closest('.rowmenu')) menuFor = null;
    if (open && !target.closest('.cmp')) open = false;
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      open = false;
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="cmp">
  <button
    class="trigger"
    bind:this={triggerEl}
    onclick={toggleOpen}
    title="Change what you're comparing"
  >
    <span class="ico">{triggerIcon}</span>
    <span class="lbl">{label}</span>
    <span class="chev">▾</span>
  </button>

  {#if open}
    <div
      class="menu"
      style="top: {menuTop}px; left: {menuLeft}px; width: {menuWidth}px; height: {menuHeight}px;"
    >
      <div class="menu-body">
      <button
        class="opt pinned"
        class:on={comparison.kind === 'worktree'}
        onclick={() => choose({ kind: 'worktree' })}
      >
        <span class="ico">◐</span>
        <span class="otext"
          ><span class="otitle">Uncommitted changes</span><span class="osub"
            >Working tree vs HEAD</span
          ></span
        >
      </button>

      <div class="tabs">
        <button class="tab" class:on={tab === 'history'} onclick={() => (tab = 'history')}>
          History <span class="count">{commits.length}</span>
        </button>
        <button class="tab" class:on={tab === 'branches'} onclick={() => (tab = 'branches')}>
          Branches <span class="count">{branches.length}</span>
        </button>
        <button class="tab" class:on={tab === 'tags'} onclick={() => (tab = 'tags')}>
          Tags <span class="count">{tags.length}</span>
        </button>
        <button class="tab" class:on={tab === 'worktrees'} onclick={() => (tab = 'worktrees')}>
          Worktrees <span class="count">{worktrees.length}</span>
        </button>
      </div>

      <div class="search">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={query}
          onkeydown={onSearchKeydown}
          autofocus
          placeholder={tab === 'history'
            ? 'Search commits…'
            : tab === 'branches'
              ? 'Search branches…'
              : tab === 'tags'
                ? 'Search tags…'
                : 'Search worktrees…'}
        />
      </div>

      <div class="list">
        {#if tab === 'history'}
          {#if filteredCommits.length === 0}
            <div class="empty">{emptyMessage}</div>
          {/if}
          {#each filteredCommits as c (c.sha)}
            <div class="row">
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
              <div class="rowmenu">
                <button
                  class="iconbtn dots"
                  title="More actions"
                  aria-haspopup="true"
                  aria-expanded={menuFor === c.sha}
                  onclick={(e) => toggleMenu(e, c.sha)}
                >
                  {copied === `sha:${c.sha}` || copied === `msg:${c.sha}` ? '✓' : '⋯'}
                </button>
                {#if menuFor === c.sha}
                  <div class="menu-pop">
                    <button class="menu-item" onclick={(e) => copy(e, `sha:${c.sha}`, c.sha)}>
                      Copy SHA
                    </button>
                    <button class="menu-item" onclick={(e) => copy(e, `msg:${c.sha}`, c.summary)}>
                      Copy message
                    </button>
                    {#if canRevert}
                      <button class="menu-item danger" onclick={(e) => revert(e, c.sha)}>
                        Revert commit
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        {:else if tab === 'branches'}
          {#if filteredBranches.length === 0}
            <div class="empty">{emptyMessage}</div>
          {/if}
          {#each filteredBranches as b (`${b.name}:${b.isRemote}`)}
            <div class="row">
              <button
                class="opt"
                class:on={comparison.kind === 'branch' && comparison.name === b.name}
                onclick={() => choose({ kind: 'branch', name: b.name, sha: b.sha })}
              >
                <span class="sha">{b.shortSha}</span>
                <span class="otext">
                  <span class="otitle"
                    >{b.name}
                    {#if b.isHead}<span class="badge">current</span>{/if}
                    {#if b.isRemote}<span class="badge muted">remote</span>{/if}</span
                  >
                  <span class="osub">{b.upstream ?? (b.isRemote ? 'remote-tracking' : 'local')}</span>
                </span>
              </button>
              <div class="row-actions">
                <button
                  class="iconbtn"
                  title="Copy branch name"
                  onclick={(e) => copy(e, `branch:${b.name}`, b.name)}
                >
                  {copied === `branch:${b.name}` ? '✓' : '⧉'}
                </button>
              </div>
            </div>
          {/each}
        {:else if tab === 'tags'}
          {#if filteredTags.length === 0}
            <div class="empty">{emptyMessage}</div>
          {/if}
          {#each filteredTags as t (t.name)}
            <div class="row">
              <button
                class="opt"
                class:on={comparison.kind === 'tag' && comparison.name === t.name}
                onclick={() => choose({ kind: 'tag', name: t.name, sha: t.sha })}
              >
                <span class="sha">{t.shortSha}</span>
                <span class="otext">
                  <span class="otitle">{t.name}</span>
                  <span class="osub">{t.message?.split('\n')[0] || 'lightweight tag'}</span>
                </span>
              </button>
              <div class="row-actions">
                <button
                  class="iconbtn"
                  title="Copy tag name"
                  onclick={(e) => copy(e, `tag:${t.name}`, t.name)}
                >
                  {copied === `tag:${t.name}` ? '✓' : '⧉'}
                </button>
              </div>
            </div>
          {/each}
        {:else}
          {#if filteredWorktrees.length === 0}
            <div class="empty">{emptyMessage}</div>
          {/if}
          {#each filteredWorktrees as w (w.path)}
            <button
              class="opt full"
              class:on={w.path === currentPath}
              onclick={() => openWorktree(w.path)}
            >
              <span class="sha">{w.shortSha ?? '·······'}</span>
              <span class="otext">
                <span class="otitle"
                  >{w.branch ?? 'detached'}
                  {#if w.isLocked}<span class="badge muted">locked</span>{/if}
                  {#if w.path === currentPath}<span class="badge">current</span>{/if}</span
                >
                <span class="osub path">{w.path}</span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
      </div>

      <div
        class="resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize comparison picker"
        title="Drag to resize"
        onpointerdown={startResize}
      ></div>
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
    font-size: 0.75rem;
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
    /* `fixed` (not anchored to `.cmp`) so the sidebar's `overflow: hidden`
     * can't clip it, and it can be resized across the whole window. Actual
     * top/left/width/height come from inline style (see script). No
     * `overflow: hidden` here — that lives on `.menu-body` instead, so the
     * corner `.resize-handle` isn't clipped (and un-clickable) by the
     * rounded corner it shares with this box. */
    position: fixed;
    z-index: 100;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
    display: flex;
    flex-direction: column;
  }
  .menu-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 8px;
  }
  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
    background: linear-gradient(
      135deg,
      transparent 0%,
      transparent 45%,
      var(--border) 45%,
      var(--border) 55%,
      transparent 55%,
      transparent 65%,
      var(--border) 65%,
      var(--border) 75%,
      transparent 75%
    );
  }
  .resize-handle:hover {
    background: linear-gradient(
      135deg,
      transparent 0%,
      transparent 45%,
      var(--accent) 45%,
      var(--accent) 55%,
      transparent 55%,
      transparent 65%,
      var(--accent) 65%,
      var(--accent) 75%,
      transparent 75%
    );
  }
  .tabs {
    display: flex;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .tab {
    flex: 1;
    border: none;
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 7px 6px;
    font-size: 0.6875rem;
    text-align: center;
  }
  .tab:hover {
    color: var(--fg);
  }
  .tab.on {
    color: var(--accent);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .count {
    color: var(--fg-muted);
    font-size: 0.625rem;
  }
  .search {
    flex: none;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .search input {
    width: 100%;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 0.75rem;
    color: var(--fg);
  }
  .search input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .list {
    overflow: auto;
  }
  .empty {
    padding: 16px 10px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 0.7188rem;
  }
  .row {
    display: flex;
    align-items: stretch;
    min-width: 0;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    min-width: 0;
    border: none;
    background: none;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    padding: 7px 10px;
  }
  /* Inside `.row` (a horizontal flex container alongside `.rowmenu`/
   * `.row-actions`), `.opt` must grow/shrink to fill the remaining width so
   * long titles ellipsis instead of pushing row actions off-screen. Outside
   * `.row` (the pinned "Uncommitted changes" row, a direct child of `.menu`'s
   * *vertical* flex column) `flex: 1` would instead grow the row to fill the
   * menu's height, which is the opposite of what we want. */
  .row .opt {
    flex: 1;
  }
  .opt.pinned,
  .opt.full {
    width: 100%;
  }
  .opt:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .opt.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    padding: 0 6px;
  }
  .iconbtn {
    border: 1px solid transparent;
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    border-radius: 4px;
    padding: 3px 5px;
    font-size: 0.6875rem;
    line-height: 1;
  }
  .iconbtn:hover {
    border-color: var(--border);
    color: var(--accent);
  }
  .rowmenu {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 6px;
  }
  .dots {
    font-size: 0.875rem;
    padding: 3px 7px;
  }
  .rowmenu:has(.menu-pop) .dots,
  .dots:hover {
    border-color: var(--border);
    color: var(--accent);
  }
  .menu-pop {
    position: absolute;
    top: calc(100% + 2px);
    right: 0;
    z-index: 30;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    min-width: 150px;
    display: flex;
    flex-direction: column;
    padding: 4px;
  }
  .menu-item {
    border: none;
    background: none;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .menu-item:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .menu-item.danger {
    color: var(--del-fg);
  }
  .menu-item.danger:hover {
    background: color-mix(in srgb, var(--del-fg) 12%, transparent);
  }
  .sha {
    font-family: var(--mono);
    font-size: 0.6875rem;
    color: var(--accent);
    flex: none;
    width: 7ch;
  }
  .otext {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .otitle {
    font-size: 0.7812rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .osub {
    font-size: 0.6562rem;
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .osub.path {
    font-family: var(--mono);
  }
  .badge {
    flex: none;
    font-size: 0.5625rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }
  .badge.muted {
    background: var(--bg-subtle);
    color: var(--fg-muted);
  }
</style>
