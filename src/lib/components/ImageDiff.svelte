<script lang="ts">
  import type { ImageDiff } from '../engine/model';

  interface Props {
    image: ImageDiff;
    status: string;
  }
  let { image, status }: Props = $props();

  const both = $derived(!!image.old && !!image.new);
  type Mode = '2up' | 'swipe' | 'onion';
  let mode = $state<Mode>('2up');
  let swipe = $state(50); // percentage
  let onion = $state(50); // percentage opacity of new over old

  let dimsOld = $state('');
  let dimsNew = $state('');
  function onImg(which: 'old' | 'new', e: Event) {
    const img = e.target as HTMLImageElement;
    const d = `${img.naturalWidth}×${img.naturalHeight}`;
    if (which === 'old') dimsOld = d;
    else dimsNew = d;
  }
</script>

<div class="imgdiff">
  {#if both}
    <div class="modes">
      <div class="seg">
        <button class:on={mode === '2up'} onclick={() => (mode = '2up')}>2-up</button>
        <button class:on={mode === 'swipe'} onclick={() => (mode = 'swipe')}>Swipe</button>
        <button class:on={mode === 'onion'} onclick={() => (mode = 'onion')}>Onion</button>
      </div>
    </div>
  {/if}

  {#if !both}
    <!-- Pure add or delete: show the one image with a clear label. -->
    <div class="single">
      <span class="tag" class:add={status === 'added'} class:del={status === 'removed'}>
        {status === 'added' ? 'Added' : 'Removed'}
      </span>
      <div class="frame">
        <img
          src={(image.new ?? image.old)!}
          alt={status}
          onload={(e) => onImg(image.new ? 'new' : 'old', e)}
        />
      </div>
      <span class="dims">{image.new ? dimsNew : dimsOld}</span>
    </div>
  {:else if mode === '2up'}
    <div class="twoup">
      <div class="side">
        <span class="tag del">Before</span>
        <div class="frame"><img src={image.old!} alt="before" onload={(e) => onImg('old', e)} /></div>
        <span class="dims">{dimsOld}</span>
      </div>
      <div class="side">
        <span class="tag add">After</span>
        <div class="frame"><img src={image.new!} alt="after" onload={(e) => onImg('new', e)} /></div>
        <span class="dims">{dimsNew}</span>
      </div>
    </div>
  {:else if mode === 'swipe'}
    <div class="stage">
      <div class="overlay frame">
        <img src={image.old!} alt="before" onload={(e) => onImg('old', e)} />
        <div class="clip" style="width: {swipe}%">
          <img src={image.new!} alt="after" onload={(e) => onImg('new', e)} />
        </div>
        <div class="handle" style="left: {swipe}%"></div>
      </div>
      <input type="range" min="0" max="100" bind:value={swipe} aria-label="swipe" />
      <div class="legend"><span class="del">Before {dimsOld}</span><span class="add">After {dimsNew}</span></div>
    </div>
  {:else}
    <div class="stage">
      <div class="overlay frame">
        <img src={image.old!} alt="before" onload={(e) => onImg('old', e)} />
        <img class="onion" src={image.new!} alt="after" style="opacity: {onion / 100}" onload={(e) => onImg('new', e)} />
      </div>
      <input type="range" min="0" max="100" bind:value={onion} aria-label="onion opacity" />
      <div class="legend"><span class="del">Before</span><span class="add">After</span></div>
    </div>
  {/if}
</div>

<style>
  .imgdiff {
    padding: 16px;
    overflow: auto;
    height: 100%;
  }
  .modes {
    margin-bottom: 12px;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: var(--bg);
    color: var(--fg-muted);
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
  }
  .seg button.on {
    background: var(--accent);
    color: #fff;
  }
  .twoup {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .side,
  .single {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
  }
  .tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--fg-muted);
  }
  .tag.add { color: var(--add-fg); border-color: var(--add-fg); }
  .tag.del { color: var(--del-fg); border-color: var(--del-fg); }
  /* Checkerboard so transparency is visible. */
  .frame {
    background-image:
      linear-gradient(45deg, var(--bg-inset) 25%, transparent 25%),
      linear-gradient(-45deg, var(--bg-inset) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--bg-inset) 75%),
      linear-gradient(-45deg, transparent 75%, var(--bg-inset) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    max-width: 100%;
  }
  .frame img {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .dims {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-muted);
  }
  .stage {
    max-width: 720px;
  }
  .overlay {
    position: relative;
    display: inline-block;
    line-height: 0;
  }
  .overlay > img {
    max-width: 100%;
  }
  .clip {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    overflow: hidden;
    border-right: 2px solid var(--accent);
  }
  .clip img {
    max-width: none;
  }
  .onion {
    position: absolute;
    top: 0;
    left: 0;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    transform: translateX(-1px);
    pointer-events: none;
  }
  input[type='range'] {
    width: 100%;
    margin: 10px 0 6px;
  }
  .legend {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-family: var(--mono);
  }
  .legend .del { color: var(--del-fg); }
  .legend .add { color: var(--add-fg); }
</style>
