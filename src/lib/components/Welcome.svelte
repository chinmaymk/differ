<script lang="ts">
  import type { RecentRepo } from '../sources/recent';

  interface Props {
    isTauri: boolean;
    recent: RecentRepo[];
    onOpen: () => void;
    onOpenPath: (path: string) => void;
    onRemoveRecent: (path: string) => void;
    onDemo: () => void;
  }
  let { isTauri, recent, onOpen, onOpenPath, onRemoveRecent, onDemo }: Props = $props();

  let manualPath = $state('');
  function openManual() {
    if (manualPath.trim()) onOpenPath(manualPath.trim());
  }

  function ago(ms: number): string {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
</script>

<div class="welcome" class:with-recent={recent.length > 0}>
  {#if recent.length > 0}
    <aside class="recent">
      <div class="recent-head">Recent</div>
      <ul>
        {#each recent as r (r.path)}
          <li>
            <button class="repo" onclick={() => onOpenPath(r.path)} title={r.path}>
              <span class="rname">{r.name}</span>
              <span class="rpath">{r.path}</span>
              <span class="rago">{ago(r.lastOpened)}</span>
            </button>
            <button class="rx" aria-label="Remove" title="Remove from recent" onclick={() => onRemoveRecent(r.path)}>×</button>
          </li>
        {/each}
      </ul>
    </aside>
  {/if}

  <main class="hero">
    <div class="logo">◨</div>
    <h1>Diff Viewer</h1>
    <p class="tag">Text &amp; semantic diffs for reviewing code changes.</p>

    <div class="actions">
      {#if isTauri}
        <button class="primary" onclick={onOpen}>Open repository…</button>
        <div class="manual">
          <input
            placeholder="…or paste a path"
            bind:value={manualPath}
            onkeydown={(e) => e.key === 'Enter' && openManual()}
          />
          <button onclick={openManual} disabled={!manualPath.trim()}>Open</button>
        </div>
      {/if}
      <button class="secondary" onclick={onDemo}>Try the demo</button>
    </div>

    {#if isTauri}
      <p class="hint">Opens a repository showing its uncommitted (working-tree) changes. Browse past commits once it's open.</p>
    {:else}
      <p class="hint">Open the demo to explore the text &amp; semantic diff.</p>
    {/if}
  </main>
</div>

<style>
  .welcome {
    height: 100%;
    display: grid;
    grid-template-columns: 1fr;
    place-items: center;
  }
  .welcome.with-recent {
    grid-template-columns: minmax(240px, 320px) 1fr;
    place-items: stretch;
  }
  .recent {
    border-right: 1px solid var(--border);
    background: var(--bg-subtle);
    overflow: auto;
    padding: 20px 12px;
  }
  .recent-head {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    padding: 0 8px 10px;
  }
  .recent ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .recent li {
    display: flex;
    align-items: center;
  }
  .repo {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 7px 8px;
    cursor: pointer;
    text-align: left;
    color: var(--fg);
  }
  .repo:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .rname {
    font-weight: 600;
    font-size: 0.8125rem;
  }
  .rpath {
    font-size: 0.6875rem;
    color: var(--fg-muted);
    font-family: var(--mono);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rago {
    font-size: 0.6562rem;
    color: var(--fg-muted);
  }
  .rx {
    border: none;
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0 8px;
    opacity: 0;
  }
  .recent li:hover .rx {
    opacity: 1;
  }
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px;
    text-align: center;
    max-width: 460px;
    margin: 0 auto;
  }
  .logo {
    font-size: 2.75rem;
    color: var(--accent);
    line-height: 1;
  }
  h1 {
    margin: 4px 0 0;
    font-size: 1.7rem;
  }
  .tag {
    color: var(--fg-muted);
    margin: 0 0 8px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 320px;
    align-items: stretch;
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 0.875rem;
    cursor: pointer;
    font-weight: 600;
  }
  .primary:hover {
    opacity: 0.93;
  }
  .secondary {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 18px;
    cursor: pointer;
    font-size: 0.8125rem;
  }
  .secondary:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .manual {
    display: flex;
    gap: 6px;
  }
  .manual input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--mono);
    font-size: 0.75rem;
  }
  .manual button {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    padding: 0 14px;
    cursor: pointer;
  }
  .manual button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .hint {
    color: var(--fg-muted);
    font-size: 0.75rem;
    margin-top: 8px;
    max-width: 340px;
  }
</style>
