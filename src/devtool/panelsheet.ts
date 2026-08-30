/**
 * Panel inspector: one panel at full sprite detail, plus the bytes behind it.
 *
 * This is where the "every panel is just a list of 8-bit numbers" claim gets
 * shown rather than asserted — the hex dump beside the art is the same data.
 */

import { PANEL_H, PANEL_W } from '../core/config.js';
import { drownDayForElev } from '../core/flood.js';
import { hexDump } from '../core/serialize.js';
import { BIOME_NAMES, type Biome, isWalkable, tileName } from '../core/tiles.js';
import { getPanel, type World } from '../core/world.js';
import { renderPanel } from '../render/worldmap.js';
import { escapeHtml } from './readout.js';

export interface PanelSheetRefs {
  root: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
}

export function openPanelSheet(
  refs: PanelSheetRefs,
  world: World,
  px: number,
  py: number,
  day: number,
): void {
  const panel = getPanel(world, px, py);

  let min = 255;
  let max = 0;
  let sum = 0;
  let walkable = 0;
  const tileCounts = new Map<number, number>();

  for (let i = 0; i < panel.tiles.length; i++) {
    const e = panel.elev[i];
    if (e < min) min = e;
    if (e > max) max = e;
    sum += e;
    if (isWalkable(panel.tiles[i])) walkable++;
    tileCounts.set(panel.tiles[i], (tileCounts.get(panel.tiles[i]) ?? 0) + 1);
  }

  const mean = sum / panel.tiles.length;
  const drownFirst = drownDayForElev(min);
  const drownLast = drownDayForElev(max);

  const composition = [...tileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(
      ([tile, n]) =>
        `<div class="row"><span class="row-key">${escapeHtml(tileName(tile))} ` +
        `<span class="dim">0x${tile.toString(16).padStart(2, '0')}</span></span>` +
        `<span class="row-val">${n}</span></div>`,
    )
    .join('');

  refs.title.textContent = `Panel ${px}, ${py} — ${BIOME_NAMES[panel.biome as Biome]}`;
  refs.body.innerHTML = `
    <canvas class="panel-art" id="panel-art"
            width="${PANEL_W * 16}" height="${PANEL_H * 16}"></canvas>

    <div class="group">
      <h3>Elevation</h3>
      <div class="rows">
        <div class="row"><span class="row-key">Range</span>
          <span class="row-val">${min} – ${max} <span class="dim">(mean ${mean.toFixed(0)})</span></span></div>
        <div class="row"><span class="row-key">Drowns between</span>
          <span class="row-val">day ${drownFirst.toFixed(1)} – ${drownLast.toFixed(1)}</span></div>
        <div class="row"><span class="row-key">Walkable</span>
          <span class="row-val">${walkable}/${panel.tiles.length}
            <span class="dim">${((walkable / panel.tiles.length) * 100).toFixed(0)}%</span></span></div>
      </div>
    </div>

    <div class="group">
      <h3>Composition</h3>
      <div class="rows">${composition}</div>
    </div>

    <div class="group">
      <h3>Bytes <span class="dim">176 tiles + 176 elevation = 352 B</span></h3>
      <div class="dump-tabs">
        <button class="chip is-active" data-plane="tiles">Tile plane</button>
        <button class="chip" data-plane="elev">Elevation plane</button>
      </div>
      <pre class="dump" id="panel-dump">${escapeHtml(hexDump(panel.tiles))}</pre>
    </div>
  `;

  // Draw the panel art at full sprite detail.
  const art = refs.body.querySelector<HTMLCanvasElement>('#panel-art');
  if (art) {
    const rendered = renderPanel(world, px, py, { day, scale: 1 });
    const ctx = art.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rendered as CanvasImageSource, 0, 0);
    }
  }

  // Byte-plane tabs.
  const dump = refs.body.querySelector<HTMLElement>('#panel-dump');
  for (const tab of refs.body.querySelectorAll<HTMLButtonElement>('[data-plane]')) {
    tab.addEventListener('click', () => {
      for (const other of refs.body.querySelectorAll('[data-plane]')) {
        other.classList.toggle('is-active', other === tab);
      }
      if (dump) {
        const plane = tab.dataset.plane === 'elev' ? panel.elev : panel.tiles;
        dump.textContent = hexDump(plane);
      }
    });
  }

  refs.root.hidden = false;
}

export function closePanelSheet(refs: PanelSheetRefs): void {
  refs.root.hidden = true;
}
