<script lang="ts">
  interface Props {
    stagedCount: number;
    committing: boolean;
    pushing: boolean;
    pushResult: string | null;
    pushError: string | null;
    onCommit: (message: string) => Promise<boolean>;
    onPush: () => void;
  }
  let { stagedCount, committing, pushing, pushResult, pushError, onCommit, onPush }: Props =
    $props();

  let message = $state('');

  async function submit() {
    const ok = await onCommit(message);
    if (ok) message = '';
  }

  // Commit + push in one click: staged changes present → commit them, then
  // push; nothing staged → just push whatever's already committed.
  async function commitAndPush() {
    if (stagedCount > 0) {
      const ok = await onCommit(message);
      if (!ok) return; // commit failed; error surfaces via the app's action banner
      message = '';
    }
    await onPush();
  }

  const pushState = $derived(
    pushing ? 'pushing' : pushError ? 'error' : pushResult !== null ? 'success' : 'idle',
  );
  const busy = $derived(committing || pushing);
</script>

<div class="commit">
  <textarea
    bind:value={message}
    placeholder="Commit message"
    rows="2"
    disabled={busy}
    onkeydown={(e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    }}
  ></textarea>
  <div class="actions">
    <button
      class="commitbtn"
      disabled={stagedCount === 0 || !message.trim() || busy}
      onclick={submit}
    >
      {committing ? 'Committing…' : `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'}`}
    </button>
    <button
      class="pushbtn"
      class:success={pushState === 'success'}
      class:error={pushState === 'error'}
      disabled={busy || (stagedCount > 0 && !message.trim())}
      onclick={commitAndPush}
    >
      {#if committing}
        <span class="spinner" aria-hidden="true"></span> Committing…
      {:else if pushState === 'pushing'}
        <span class="spinner" aria-hidden="true"></span> Pushing…
      {:else if pushState === 'success'}
        <span aria-hidden="true">✓</span> Pushed
      {:else if pushState === 'error'}
        <span aria-hidden="true">✗</span> Push failed
      {:else if stagedCount > 0}
        Commit &amp; push
      {:else}
        Push
      {/if}
    </button>
  </div>
  {#if pushError}
    <p class="status err">{pushError}</p>
  {:else if pushResult}
    <p class="status ok">{pushResult || 'Pushed'}</p>
  {/if}
</div>

<style>
  .commit {
    flex: none;
    padding: 8px;
    border-top: 1px solid var(--border);
    background: var(--bg-subtle);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  textarea {
    resize: vertical;
    min-height: 40px;
    font-family: var(--sans);
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
  }
  textarea:disabled {
    opacity: 0.6;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  button {
    flex: 1;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
    font-size: 12px;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .commitbtn:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .pushbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .pushbtn.success {
    border-color: var(--add-fg);
    color: var(--add-fg);
  }
  .pushbtn.error {
    border-color: var(--del-fg);
    color: var(--del-fg);
  }
  .spinner {
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
  .status {
    margin: 0;
    font-size: 11px;
    font-family: var(--mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .status.ok {
    color: var(--add-fg);
  }
  .status.err {
    color: var(--del-fg);
  }
</style>
