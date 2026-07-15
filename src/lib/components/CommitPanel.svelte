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
</script>

<div class="commit">
  <textarea
    bind:value={message}
    placeholder="Commit message"
    rows="2"
    disabled={committing}
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
      disabled={stagedCount === 0 || !message.trim() || committing}
      onclick={submit}
    >
      {committing ? 'Committing…' : `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'}`}
    </button>
    <button class="pushbtn" disabled={pushing} onclick={onPush}>
      {pushing ? 'Pushing…' : 'Push'}
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
