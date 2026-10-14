<script>
  import { style } from '../scene.js';
  export let nodes = [];
</script>
{#each nodes as p (p.id)}
  {#if p.type === 'image'}<img data-id={p.id} style={style(p)} src={p.src} alt="" />
  {:else}<div data-id={p.id} style={style(p)}>{p.type === 'text' ? p.text : ''}</div>{/if}
{/each}
