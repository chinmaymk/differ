<script lang="ts">
  import type {
    BranchInfo,
    ChangedFile,
    CommitInfo,
    DiffSource,
    FileDiff,
    Hunk,
    HunkMode,
    Revision,
    TagInfo,
    WorktreeInfo,
  } from './lib/engine/model';
  import { EngineClient } from './lib/worker/client';
  import { sampleSource } from './lib/sources/samples';
  import {
    getRecentRepos,
    addRecentRepo,
    removeRecentRepo,
    type RecentRepo,
  } from './lib/sources/recent';
  import {
    baseRevision,
    headRevision,
    type Comparison,
  } from './lib/components/comparison';
  import { sectionKey, type SectionKey } from './lib/components/staging';
  import FileList from './lib/components/FileList.svelte';
  import FileDiffView from './lib/components/FileDiffView.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import ComparisonBar from './lib/components/ComparisonBar.svelte';

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const client = new EngineClient();

  let source = $state<DiffSource | null>(null);
  let comparison = $state<Comparison>({ kind: 'worktree' });
  let commits = $state<CommitInfo[]>([]);
  let branches = $state<BranchInfo[]>([]);
  let tags = $state<TagInfo[]>([]);
  let worktrees = $state<WorktreeInfo[]>([]);
  let recentRepos = $state<RecentRepo[]>(getRecentRepos());
  let stagedFiles = $state<ChangedFile[]>([]);
  let unstagedFiles = $state<ChangedFile[]>([]);
  /** Keyed by `sectionKey(section, path)` — the same path can have an
   * independent staged diff and unstaged diff open at once. */
  let results = $state<Record<string, FileDiff>>({});
  let errors = $state<Record<string, string>>({});
  let selected = $state<{ section: SectionKey; path: string } | null>(null);
  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let errorMsg = $state('');
  let viewed = $state<Set<string>>(new Set());

  const canBrowseHistory = $derived(
    !!source?.listCommits ||
      !!source?.listBranches ||
      !!source?.listTags ||
      !!source?.listWorktrees,
  );
  const canStage = $derived(!!source?.stagePaths && comparison.kind === 'worktree');

  // --- Persisted UI preferences ---------------------------------------------
  const SETTINGS_KEY = 'dv-settings';
  const MIN_FONT = 10;
  const MAX_FONT = 24;
  interface Settings {
    viewMode: 'unified' | 'split';
    wrap: boolean;
    showSemantic: boolean;
    fontSize: number;
  }
  function loadSettings(): Settings {
    const d: Settings = { viewMode: 'unified', wrap: true, showSemantic: true, fontSize: 14 };
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      return {
        viewMode: s.viewMode === 'split' ? 'split' : 'unified',
        wrap: typeof s.wrap === 'boolean' ? s.wrap : d.wrap,
        showSemantic: typeof s.showSemantic === 'boolean' ? s.showSemantic : d.showSemantic,
        fontSize:
          typeof s.fontSize === 'number' && s.fontSize >= MIN_FONT && s.fontSize <= MAX_FONT
            ? s.fontSize
            : d.fontSize,
      };
    } catch {
      return d;
    }
  }
  const initial = loadSettings();
  let viewMode = $state<'unified' | 'split'>(initial.viewMode);
  let wrap = $state(initial.wrap);
  let showSemantic = $state(initial.showSemantic);
  let fontSize = $state(initial.fontSize);
  let autoRefresh = $state(false); // intentionally not persisted (live action)

  $effect(() => {
    const s: Settings = { viewMode, wrap, showSemantic, fontSize };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  });
  function bumpFont(delta: number) {
    fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, fontSize + delta));
  }

  // --- Resizable file-tree sidebar ------------------------------------------
  const FL_KEY = 'dv-filelist-width';
  const FL_MIN = 160;
  const FL_MAX = 520;
  const FL_DEFAULT = 260;
  function loadFlWidth(): number {
    const v = Number(localStorage.getItem(FL_KEY));
    return v >= FL_MIN && v <= FL_MAX ? v : FL_DEFAULT;
  }
  function resetFlWidth() {
    fileListWidth = FL_DEFAULT;
    localStorage.setItem(FL_KEY, String(FL_DEFAULT));
  }
  let fileListWidth = $state(loadFlWidth());
  let flDragging = $state(false);
  function startFlDrag(e: PointerEvent) {
    flDragging = true;
    const startX = e.clientX;
    const startW = fileListWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      fileListWidth = Math.max(FL_MIN, Math.min(FL_MAX, startW + (ev.clientX - startX)));
    };
    const up = (ev: PointerEvent) => {
      flDragging = false;
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      localStorage.setItem(FL_KEY, String(fileListWidth));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  const selectedFile = $derived(
    selected ? results[sectionKey(selected.section, selected.path)] ?? null : null,
  );

  // --- Revisions per section --------------------------------------------
  // In "worktree" mode, staged/unstaged are two independent diffs (index vs
  // HEAD, workdir vs index); in "commit" mode there's only ever one diff, so
  // everything lives in the "unstaged" section and "staged" stays empty.
  function base(section: SectionKey): Revision {
    if (comparison.kind !== 'worktree') return baseRevision(comparison);
    return section === 'staged' ? { kind: 'ref', ref: 'HEAD' } : { kind: 'index' };
  }
  function head(section: SectionKey): Revision {
    if (comparison.kind !== 'worktree') return headRevision(comparison);
    return section === 'staged' ? { kind: 'index' } : { kind: 'worktree' };
  }

  function toggleViewed(section: SectionKey, path: string) {
    const k = sectionKey(section, path);
    const next = new Set(viewed);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    viewed = next;
  }

  function combinedList(): { section: SectionKey; file: ChangedFile }[] {
    return [
      ...stagedFiles.map((file) => ({ section: 'staged' as const, file })),
      ...unstagedFiles.map((file) => ({ section: 'unstaged' as const, file })),
    ];
  }

  // Keyboard navigation for high-volume review.
  function onKey(e: KeyboardEvent) {
    if (status !== 'ready') return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const list = combinedList();
    if (list.length === 0) return;
    const idx = list.findIndex(
      (x) => selected && x.section === selected.section && x.file.path === selected.path,
    );
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = list[Math.min(list.length - 1, idx + 1)];
      select(next.section, next.file.path);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = list[Math.max(0, idx - 1)];
      select(prev.section, prev.file.path);
    } else if (e.key === 'v' && selected) {
      e.preventDefault();
      toggleViewed(selected.section, selected.path);
    }
  }

  async function buildOne(
    src: DiffSource,
    section: SectionKey,
    file: ChangedFile,
    force = false,
  ): Promise<void> {
    const k = sectionKey(section, file.path);
    if (!force && (results[k] || errors[k])) return;
    try {
      const entry = await src.readEntry(base(section), head(section), file);
      const fd = await client.build(entry);
      results = { ...results, [k]: fd };
      if (errors[k]) {
        const next = { ...errors };
        delete next[k];
        errors = next;
      }
    } catch (e) {
      errors = { ...errors, [k]: e instanceof Error ? e.message : String(e) };
    }
  }

  function reselectAfterMutation(staged: ChangedFile[], unstaged: ChangedFile[]) {
    if (!selected) return;
    const { section, path } = selected;
    const sameList = section === 'staged' ? staged : unstaged;
    if (sameList.some((f) => f.path === path)) return; // still valid, nothing to do
    const otherSection: SectionKey = section === 'staged' ? 'unstaged' : 'staged';
    const otherList = otherSection === 'staged' ? staged : unstaged;
    if (otherList.some((f) => f.path === path)) {
      selected = { section: otherSection, path };
      return;
    }
    if (sameList[0]) {
      selected = { section, path: sameList[0].path };
      return;
    }
    selected = staged[0]
      ? { section: 'staged', path: staged[0].path }
      : unstaged[0]
        ? { section: 'unstaged', path: unstaged[0].path }
        : null;
  }

  // Auto-refresh working-tree changes as a coding agent edits files, and
  // after any local mutation (stage/unstage/discard/commit).
  let refreshing = false;
  async function refresh(): Promise<void> {
    if (!source || refreshing) return;
    refreshing = true;
    const src = source;
    try {
      let staged: ChangedFile[] = [];
      let unstaged: ChangedFile[];
      if (comparison.kind === 'worktree') {
        [staged, unstaged] = await Promise.all([
          src.listChanges(base('staged'), head('staged')),
          src.listChanges(base('unstaged'), head('unstaged')),
        ]);
      } else {
        unstaged = await src.listChanges(base('unstaged'), head('unstaged'));
      }
      const validKeys = new Set([
        ...staged.map((f) => sectionKey('staged', f.path)),
        ...unstaged.map((f) => sectionKey('unstaged', f.path)),
      ]);
      stagedFiles = staged;
      unstagedFiles = unstaged;
      results = Object.fromEntries(Object.entries(results).filter(([k]) => validKeys.has(k)));
      errors = Object.fromEntries(Object.entries(errors).filter(([k]) => validKeys.has(k)));
      viewed = new Set([...viewed].filter((k) => validKeys.has(k)));
      reselectAfterMutation(staged, unstaged);
      await Promise.all([
        ...staged.map((f) => buildOne(src, 'staged', f, true)),
        ...unstaged.map((f) => buildOne(src, 'unstaged', f, true)),
      ]);
    } catch {
      // Keep the last good state on a transient failure.
    } finally {
      refreshing = false;
    }
  }
  $effect(() => {
    if (!autoRefresh || !source) return;
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  });

  // Re-fetch the comparison picker's commit/branch/tag lists — separate from
  // `refresh()` (working-tree diff) since commit/revert/pull move HEAD,
  // branch tips, and tags without necessarily changing the working tree.
  async function refreshHistory(): Promise<void> {
    if (!source) return;
    const src = source;
    src.listCommits?.(80)
      .then((c) => (commits = c))
      .catch(() => {});
    src.listBranches?.()
      .then((b) => (branches = b))
      .catch(() => {});
    src.listTags?.()
      .then((t) => (tags = t))
      .catch(() => {});
  }

  // --- Loading -------------------------------------------------------------
  async function reload(): Promise<void> {
    if (!source) return;
    status = 'loading';
    errorMsg = '';
    results = {};
    errors = {};
    selected = null;
    viewed = new Set();
    const src = source;
    try {
      let staged: ChangedFile[] = [];
      let unstaged: ChangedFile[];
      if (comparison.kind === 'worktree') {
        [staged, unstaged] = await Promise.all([
          src.listChanges(base('staged'), head('staged')),
          src.listChanges(base('unstaged'), head('unstaged')),
        ]);
      } else {
        unstaged = await src.listChanges(base('unstaged'), head('unstaged'));
      }
      stagedFiles = staged;
      unstagedFiles = unstaged;
      status = 'ready';
      const first = staged[0]
        ? { section: 'staged' as const, file: staged[0] }
        : unstaged[0]
          ? { section: 'unstaged' as const, file: unstaged[0] }
          : null;
      if (first) {
        selected = { section: first.section, path: first.file.path };
        await buildOne(src, first.section, first.file);
      }
      for (const f of staged) buildOne(src, 'staged', f);
      for (const f of unstaged) buildOne(src, 'unstaged', f);
    } catch (e) {
      status = 'error';
      errorMsg = e instanceof Error ? e.message : String(e);
    }
  }

  async function openSource(src: DiffSource, recentPath?: string): Promise<void> {
    source = src;
    comparison = { kind: 'worktree' };
    commits = [];
    branches = [];
    tags = [];
    worktrees = [];
    autoRefresh = false;
    clearPushState();
    clearPullState();
    if (recentPath) {
      addRecentRepo(recentPath);
      recentRepos = getRecentRepos();
    }
    // Load history/branches/tags/worktrees for the comparison picker
    // (best-effort, non-blocking — the diff view shouldn't wait on these).
    src.listCommits?.(80)
      .then((c) => (commits = c))
      .catch(() => {});
    src.listBranches?.()
      .then((b) => (branches = b))
      .catch(() => {});
    src.listTags?.()
      .then((t) => (tags = t))
      .catch(() => {});
    src.listWorktrees?.()
      .then((w) => (worktrees = w))
      .catch(() => {});
    await reload();
  }

  async function openRepoPath(path: string): Promise<void> {
    const { TauriGitSource } = await import('./lib/sources/tauri-git');
    await openSource(new TauriGitSource(path), path);
  }

  async function pickRepo(): Promise<void> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, title: 'Open a Git repository' });
      if (typeof dir !== 'string') return;
      let path = dir;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        path = await invoke<string>('repo_root', { start: dir });
      } catch {
        // Not inside a repo; use the chosen directory directly.
      }
      await openRepoPath(path);
    } catch (e) {
      status = 'error';
      errorMsg = e instanceof Error ? e.message : String(e);
    }
  }

  function openDemo() {
    void openSource(sampleSource());
  }

  function setComparison(c: Comparison) {
    comparison = c;
    void reload();
  }

  function removeRecent(path: string) {
    removeRecentRepo(path);
    recentRepos = getRecentRepos();
  }

  function goHome() {
    source = null;
    status = 'idle';
    stagedFiles = [];
    unstagedFiles = [];
    results = {};
    errors = {};
    selected = null;
    commits = [];
    branches = [];
    tags = [];
    worktrees = [];
    recentRepos = getRecentRepos();
    clearPushState();
    clearPullState();
  }

  function select(section: SectionKey, path: string) {
    selected = { section, path };
    const file = (section === 'staged' ? stagedFiles : unstagedFiles).find((f) => f.path === path);
    if (source && file) void buildOne(source, section, file);
  }

  // --- Write operations: stage / unstage / discard / hunks / commit / push --
  let actionError = $state<string | null>(null);

  async function runAction(fn: () => Promise<unknown>): Promise<void> {
    try {
      actionError = null;
      await fn();
      await refresh();
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e);
    }
  }

  function confirmDiscard(label: string): boolean {
    return window.confirm(`Discard changes to ${label}? This cannot be undone.`);
  }

  function stagePaths(paths: string[]) {
    if (!source?.stagePaths || paths.length === 0) return;
    const src = source;
    void runAction(() => src.stagePaths!(paths));
  }
  function unstagePaths(paths: string[]) {
    if (!source?.unstagePaths || paths.length === 0) return;
    const src = source;
    void runAction(() => src.unstagePaths!(paths));
  }
  function discardPaths(paths: string[]) {
    if (!source?.discardPaths || paths.length === 0) return;
    const label = paths.length === 1 ? paths[0] : `${paths.length} files`;
    if (!confirmDiscard(label)) return;
    const src = source;
    void runAction(() => src.discardPaths!(paths));
  }

  function onHunkAction(hunk: Hunk, mode: HunkMode) {
    if (!source?.applyHunk || !selected) return;
    if (mode === 'discard' && !confirmDiscard('this hunk')) return;
    const path = selected.path;
    const src = source;
    void runAction(() =>
      src.applyHunk!(
        path,
        {
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          lines: hunk.lines.map((l) => ({ op: l.op, text: l.text })),
        },
        mode,
      ),
    );
  }

  let committing = $state(false);
  let pushing = $state(false);
  let pushResult = $state<string | null>(null);
  let pushError = $state<string | null>(null);
  // How long a finished push's success/error state lingers on the button
  // before it settles back to a plain "Push" — long enough to register,
  // short enough not to look stuck.
  const PUSH_STATE_LINGER_MS = 4000;
  let pushResetTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPushState() {
    if (pushResetTimer) {
      clearTimeout(pushResetTimer);
      pushResetTimer = null;
    }
    pushResult = null;
    pushError = null;
  }

  async function commitStaged(message: string): Promise<boolean> {
    if (!source?.commit || committing || pushing) return false;
    committing = true;
    actionError = null;
    try {
      await source.commit(message);
      // A prior push's success/error no longer describes reality — this
      // commit is unpushed, so the button shouldn't still read "Pushed".
      clearPushState();
      await refresh();
      await refreshHistory();
      return true;
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      committing = false;
    }
  }

  async function revertCommit(sha: string): Promise<void> {
    if (!source?.revertCommit) return;
    if (!window.confirm(`Revert commit ${sha.slice(0, 7)}? This creates a new commit undoing its changes.`)) {
      return;
    }
    const src = source;
    await runAction(() => src.revertCommit!(sha));
    await refreshHistory();
  }

  function openWorktree(path: string) {
    void openRepoPath(path);
  }

  async function doPush(): Promise<void> {
    if (!source?.push || pushing || committing) return;
    clearPushState();
    pushing = true;
    try {
      pushResult = await source.push();
    } catch (e) {
      pushError = e instanceof Error ? e.message : String(e);
    } finally {
      pushing = false;
      pushResetTimer = setTimeout(() => {
        pushResult = null;
        pushError = null;
        pushResetTimer = null;
      }, PUSH_STATE_LINGER_MS);
    }
  }

  let pulling = $state(false);
  let pullResult = $state<string | null>(null);
  let pullError = $state<string | null>(null);
  const PULL_STATE_LINGER_MS = 4000;
  let pullResetTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPullState() {
    if (pullResetTimer) {
      clearTimeout(pullResetTimer);
      pullResetTimer = null;
    }
    pullResult = null;
    pullError = null;
  }

  async function doPull(): Promise<void> {
    if (!source?.pull || pulling) return;
    clearPullState();
    pulling = true;
    try {
      pullResult = await source.pull();
      await refresh();
      await refreshHistory();
    } catch (e) {
      pullError = e instanceof Error ? e.message : String(e);
    } finally {
      pulling = false;
      pullResetTimer = setTimeout(() => {
        pullResult = null;
        pullError = null;
        pullResetTimer = null;
      }, PULL_STATE_LINGER_MS);
    }
  }

  // In the desktop app, auto-open the repo we were launched from.
  let didAutoOpen = false;
  $effect(() => {
    if (!isTauri || didAutoOpen) return;
    didAutoOpen = true;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const root = await invoke<string>('repo_root', { start: null });
        await openRepoPath(root);
      } catch {
        // Not launched inside a repo — stay on the welcome screen.
      }
    })();
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="app" style="--code-font-size: {fontSize}px">
  <header class="topbar">
    <button class="brand" onclick={goHome} title="Home">Diff Viewer</button>
    <div class="right">
      {#if source}
        <button class="src-label" onclick={goHome} title={source.label()}>{source.label()}</button>
      {/if}
      {#if isTauri}
        <button onclick={pickRepo}>Open…</button>
      {/if}
      {#if source?.pull}
        <button
          class="pull"
          class:success={!pulling && pullResult !== null}
          class:error={!pulling && pullError !== null}
          disabled={pulling}
          onclick={doPull}
          title={pullError ?? pullResult ?? 'Pull latest changes from remote'}
        >
          {#if pulling}
            <span class="spinner" aria-hidden="true"></span> Pulling…
          {:else if pullError !== null}
            ✗ Pull failed
          {:else if pullResult !== null}
            ✓ Pulled
          {:else}
            Pull
          {/if}
        </button>
      {/if}
      <div class="fontstepper" title="Diff font size">
        <button onclick={() => bumpFont(-1)} aria-label="Smaller font">A−</button>
        <span class="fs">{fontSize}</span>
        <button onclick={() => bumpFont(1)} aria-label="Larger font">A+</button>
      </div>
      {#if source && comparison.kind === 'worktree'}
        <button
          class="live"
          class:on={autoRefresh}
          onclick={() => (autoRefresh = !autoRefresh)}
          title="Re-scan for changes every 2 seconds"
        >
          <span class="dot"></span>{autoRefresh ? 'Live' : 'Auto-refresh'}
        </button>
      {/if}
    </div>
  </header>

  {#if status === 'idle'}
    <Welcome
      {isTauri}
      recent={recentRepos}
      onOpen={pickRepo}
      onOpenPath={openRepoPath}
      onRemoveRecent={removeRecent}
      onDemo={openDemo}
    />
  {:else if status === 'error'}
    <div class="placeholder error">
      <h2>Could not load</h2>
      <p>{errorMsg}</p>
      <button onclick={goHome}>Back</button>
    </div>
  {:else}
    <div
      class="main"
      class:fl-dragging={flDragging}
      style="grid-template-columns: {fileListWidth}px 6px 1fr"
    >
      <div class="sidebar">
        {#if canBrowseHistory}
          <ComparisonBar
            {comparison}
            {commits}
            {branches}
            {tags}
            {worktrees}
            canRevert={!!source?.revertCommit}
            currentPath={source?.label()}
            onSelect={setComparison}
            onOpenWorktree={openWorktree}
            onRevertCommit={(sha) => void revertCommit(sha)}
          />
        {/if}
        {#if actionError}
          <div class="action-error">
            <span>{actionError}</span>
            <button onclick={() => (actionError = null)} aria-label="Dismiss">×</button>
          </div>
        {/if}
        <FileList
          {stagedFiles}
          {unstagedFiles}
          {results}
          {errors}
          {selected}
          {viewed}
          onselect={select}
          ontoggleViewed={toggleViewed}
          {canStage}
          onStage={stagePaths}
          onUnstage={unstagePaths}
          onDiscard={discardPaths}
          {committing}
          {pushing}
          {pushResult}
          {pushError}
          onCommit={commitStaged}
          onPush={doPush}
        />
      </div>
      <div
        class="fl-divider"
        onpointerdown={startFlDrag}
        ondblclick={resetFlWidth}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file list"
        title="Drag to resize · double-click to reset"
      ></div>
      <div class="content">
        {#if selectedFile}
          <FileDiffView
            file={selectedFile}
            {viewMode}
            {wrap}
            {showSemantic}
            onViewMode={(m) => (viewMode = m)}
            onWrap={(w) => (wrap = w)}
            onToggleSemantic={() => (showSemantic = !showSemantic)}
            section={canStage ? (selected?.section ?? null) : null}
            {onHunkAction}
          />
        {:else if selected && errors[sectionKey(selected.section, selected.path)]}
          <div class="placeholder error"><p>{errors[sectionKey(selected.section, selected.path)]}</p></div>
        {:else if selected}
          <div class="placeholder"><p>Analyzing…</p></div>
        {:else}
          <div class="placeholder"><p>No changes in this comparison.</p></div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    flex: none;
  }
  .brand {
    font-weight: 700;
    letter-spacing: -0.01em;
    border: none;
    background: none;
    padding: 0;
    font-size: 14px;
  }
  .brand:hover {
    color: var(--accent);
  }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .src-label {
    color: var(--fg-muted);
    font-family: var(--mono);
    font-size: 11.5px;
    max-width: 32ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: none;
    background: none;
    padding: 0;
  }
  .src-label:hover {
    color: var(--accent);
  }
  .pull {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .pull.success {
    border-color: var(--add-fg);
    color: var(--add-fg);
  }
  .pull.error {
    border-color: var(--del-fg);
    color: var(--del-fg);
  }
  .pull .spinner {
    width: 9px;
    height: 9px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .fontstepper {
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .fontstepper button {
    border: none;
    border-radius: 0;
    background: var(--bg);
    padding: 3px 8px;
    font-size: 12px;
  }
  .fontstepper .fs {
    min-width: 2ch;
    text-align: center;
    font-size: 11px;
    color: var(--fg-muted);
    font-family: var(--mono);
  }
  .live {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
  }
  .live .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-muted);
  }
  .live.on {
    border-color: var(--add-fg);
    color: var(--add-fg);
  }
  .live.on .dot {
    background: var(--add-fg);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  button {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
    font-size: 12.5px;
  }
  button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .main {
    display: grid;
    grid-template-columns: 260px 6px 1fr;
    flex: 1;
    min-height: 0;
  }
  .main.fl-dragging {
    cursor: col-resize;
    user-select: none;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-subtle);
  }
  .action-error {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--del-fg) 12%, transparent);
    color: var(--del-fg);
    font-size: 11.5px;
  }
  .action-error span {
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }
  .action-error button {
    flex: none;
    border: none;
    background: none;
    padding: 0 2px;
    color: inherit;
    font-size: 14px;
    line-height: 1;
  }
  .fl-divider {
    cursor: col-resize;
    background: var(--border);
    position: relative;
  }
  .fl-divider::after {
    content: '';
    position: absolute;
    inset: 0 -4px;
  }
  .fl-divider:hover,
  .main.fl-dragging .fl-divider {
    background: var(--accent);
  }
  .content {
    min-width: 0;
    overflow: hidden;
  }
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    text-align: center;
    color: var(--fg-muted);
    padding: 40px;
  }
  .placeholder h2 {
    margin: 0;
    color: var(--fg);
  }
  .placeholder.error h2 {
    color: var(--del-fg);
  }
</style>
