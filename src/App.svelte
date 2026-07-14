<script lang="ts">
  import type { ChangedFile, CommitInfo, DiffSource, FileDiff } from './lib/engine/model';
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
  import FileList from './lib/components/FileList.svelte';
  import FileDiffView from './lib/components/FileDiffView.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import ComparisonBar from './lib/components/ComparisonBar.svelte';

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const client = new EngineClient();

  let source = $state<DiffSource | null>(null);
  let comparison = $state<Comparison>({ kind: 'worktree' });
  let commits = $state<CommitInfo[]>([]);
  let recentRepos = $state<RecentRepo[]>(getRecentRepos());
  let files = $state<ChangedFile[]>([]);
  let results = $state<Record<string, FileDiff>>({});
  let errors = $state<Record<string, string>>({});
  let selectedPath = $state<string | null>(null);
  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let errorMsg = $state('');
  let viewed = $state<Set<string>>(new Set());

  // Old/new revisions derived from the current comparison.
  const base = $derived(baseRevision(comparison));
  const head = $derived(headRevision(comparison));
  const canBrowseHistory = $derived(!!source?.listCommits);

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

  const selectedFile = $derived(selectedPath ? results[selectedPath] ?? null : null);

  function toggleViewed(path: string) {
    const next = new Set(viewed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    viewed = next;
  }

  // Keyboard navigation for high-volume review.
  function onKey(e: KeyboardEvent) {
    if (status !== 'ready' || files.length === 0) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const idx = files.findIndex((f) => f.path === selectedPath);
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      select(files[Math.min(files.length - 1, idx + 1)].path);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(files[Math.max(0, idx - 1)].path);
    } else if (e.key === 'v' && selectedPath) {
      e.preventDefault();
      toggleViewed(selectedPath);
    }
  }

  async function buildOne(src: DiffSource, file: ChangedFile, force = false): Promise<void> {
    if (!force && (results[file.path] || errors[file.path])) return;
    try {
      const entry = await src.readEntry(base, head, file);
      const fd = await client.build(entry);
      results = { ...results, [file.path]: fd };
      if (errors[file.path]) {
        const next = { ...errors };
        delete next[file.path];
        errors = next;
      }
    } catch (e) {
      errors = { ...errors, [file.path]: e instanceof Error ? e.message : String(e) };
    }
  }

  // Auto-refresh working-tree changes as a coding agent edits files.
  let refreshing = false;
  async function refresh(): Promise<void> {
    if (!source || refreshing) return;
    refreshing = true;
    try {
      const list = await source.listChanges(base, head);
      const paths = new Set(list.map((f) => f.path));
      files = list;
      results = Object.fromEntries(Object.entries(results).filter(([p]) => paths.has(p)));
      errors = Object.fromEntries(Object.entries(errors).filter(([p]) => paths.has(p)));
      viewed = new Set([...viewed].filter((p) => paths.has(p)));
      if (selectedPath && !paths.has(selectedPath)) selectedPath = list[0]?.path ?? null;
      await Promise.all(list.map((f) => buildOne(source!, f, true)));
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

  // --- Loading -------------------------------------------------------------
  async function reload(): Promise<void> {
    if (!source) return;
    status = 'loading';
    errorMsg = '';
    results = {};
    errors = {};
    selectedPath = null;
    viewed = new Set();
    const src = source;
    try {
      const list = await src.listChanges(base, head);
      files = list;
      selectedPath = list[0]?.path ?? null;
      status = 'ready';
      if (selectedPath) await buildOne(src, list[0]);
      for (const f of list) buildOne(src, f);
    } catch (e) {
      status = 'error';
      errorMsg = e instanceof Error ? e.message : String(e);
    }
  }

  async function openSource(src: DiffSource, recentPath?: string): Promise<void> {
    source = src;
    comparison = { kind: 'worktree' };
    commits = [];
    autoRefresh = false;
    if (recentPath) {
      addRecentRepo(recentPath);
      recentRepos = getRecentRepos();
    }
    // Load history for the commit picker (best-effort, non-blocking).
    src.listCommits?.(80)
      .then((c) => (commits = c))
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
    files = [];
    results = {};
    errors = {};
    selectedPath = null;
    commits = [];
    recentRepos = getRecentRepos();
  }

  function select(path: string) {
    selectedPath = path;
    if (source) void buildOne(source, files.find((f) => f.path === path)!);
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
      <button onclick={openDemo}>Demo</button>
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
          <ComparisonBar {comparison} {commits} onSelect={setComparison} />
        {/if}
        <FileList
          {files}
          {results}
          {errors}
          {selectedPath}
          {viewed}
          onselect={select}
          ontoggleViewed={toggleViewed}
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
          />
        {:else if selectedPath && errors[selectedPath]}
          <div class="placeholder error"><p>{errors[selectedPath]}</p></div>
        {:else if selectedPath}
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
