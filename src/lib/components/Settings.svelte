<script lang="ts">
  interface Props {
    theme: 'system' | 'light' | 'dark';
    viewMode: 'unified' | 'split';
    wrap: boolean;
    showSemantic: boolean;
    fontSize: number;
    minFontSize: number;
    maxFontSize: number;
    autoRefreshInterval: number;
    onTheme: (t: 'system' | 'light' | 'dark') => void;
    onViewMode: (m: 'unified' | 'split') => void;
    onWrap: (w: boolean) => void;
    onShowSemantic: (s: boolean) => void;
    onFontSize: (n: number) => void;
    onAutoRefreshInterval: (ms: number) => void;
    onClose: () => void;
  }
  let {
    theme,
    viewMode,
    wrap,
    showSemantic,
    fontSize,
    minFontSize,
    maxFontSize,
    autoRefreshInterval,
    onTheme,
    onViewMode,
    onWrap,
    onShowSemantic,
    onFontSize,
    onAutoRefreshInterval,
    onClose,
  }: Props = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={onBackdropClick} role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header>
      <h2 id="settings-title">Settings</h2>
      <button class="close" onclick={onClose} aria-label="Close settings">×</button>
    </header>

    <div class="body">
      <section>
        <h3>Appearance</h3>
        <div class="row">
          <span class="label">Theme</span>
          <div class="segmented">
            <button class:on={theme === 'system'} onclick={() => onTheme('system')}>System</button>
            <button class:on={theme === 'light'} onclick={() => onTheme('light')}>Light</button>
            <button class:on={theme === 'dark'} onclick={() => onTheme('dark')}>Dark</button>
          </div>
        </div>
        <div class="row">
          <span class="label">Diff font size</span>
          <div class="stepper">
            <button onclick={() => onFontSize(Math.max(minFontSize, fontSize - 1))} aria-label="Smaller font">A−</button>
            <span class="value">{fontSize}px</span>
            <button onclick={() => onFontSize(Math.min(maxFontSize, fontSize + 1))} aria-label="Larger font">A+</button>
          </div>
        </div>
      </section>

      <section>
        <h3>Diff defaults</h3>
        <div class="row">
          <span class="label">View mode</span>
          <div class="segmented">
            <button class:on={viewMode === 'unified'} onclick={() => onViewMode('unified')}>Unified</button>
            <button class:on={viewMode === 'split'} onclick={() => onViewMode('split')}>Split</button>
          </div>
        </div>
        <div class="row">
          <span class="label">Wrap long lines</span>
          <button class="toggle" class:on={wrap} onclick={() => onWrap(!wrap)}>{wrap ? 'On' : 'Off'}</button>
        </div>
        <div class="row">
          <span class="label">Semantic tree</span>
          <button class="toggle" class:on={showSemantic} onclick={() => onShowSemantic(!showSemantic)}>
            {showSemantic ? 'On' : 'Off'}
          </button>
        </div>
        <p class="hint">Semantic tree can still be toggled per file from the diff toolbar.</p>
      </section>

      <section>
        <h3>Live updates</h3>
        <div class="row">
          <span class="label">Auto-refresh interval</span>
          <div class="segmented">
            {#each [0, 1000, 2000, 5000, 10000] as ms (ms)}
              <button class:on={autoRefreshInterval === ms} onclick={() => onAutoRefreshInterval(ms)}>
                {ms === 0 ? 'Off' : `${ms / 1000}s`}
              </button>
            {/each}
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .dialog {
    width: min(440px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    border-radius: 10px 10px 0 0;
  }
  h2 {
    margin: 0;
    font-size: 0.875rem;
  }
  .close {
    border: none;
    background: none;
    padding: 0 4px;
    font-size: 1.125rem;
    line-height: 1;
    color: var(--fg-muted);
    cursor: pointer;
  }
  .close:hover {
    color: var(--accent);
  }
  .body {
    padding: 4px 16px 16px;
  }
  section {
    padding: 14px 0;
  }
  section + section {
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0 0 10px;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
  }
  .hint {
    margin: 2px 0 0;
    font-size: 0.7188rem;
    color: var(--fg-muted);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }
  .label {
    font-size: 0.7812rem;
  }
  .segmented {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .segmented button {
    border: none;
    border-radius: 0;
    background: var(--bg);
    color: var(--fg);
    padding: 4px 10px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .segmented button + button {
    border-left: 1px solid var(--border);
  }
  .segmented button.on {
    background: var(--accent);
    color: #fff;
  }
  .toggle {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-muted);
    padding: 4px 12px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .toggle.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .stepper button {
    border: none;
    border-radius: 0;
    background: var(--bg);
    color: var(--fg);
    padding: 3px 8px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .stepper .value {
    min-width: 4ch;
    text-align: center;
    font-size: 0.6875rem;
    color: var(--fg-muted);
    font-family: var(--mono);
  }
</style>
