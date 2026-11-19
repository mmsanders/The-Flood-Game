/**
 * The full-screen map (Wave 8.1; round-one note 17).
 *
 * `M`, or the MAP button on the touch controls. One pixel per tile across the
 * whole width of the world, scrolled up and down, the flood drawn as it
 * stands. Unexplored screens are black. Without the Chart, what you have
 * explored is grey and the map says so; with it, colour, and markers for the
 * places you have seen — towns, caves, shrines, the ark, the slipway, the
 * skiff. Resources and pickups are never marked: the map reminds you where
 * things are, it doesn't do the looking for you.
 *
 * The world never changes shape while the map is open (it pauses the game),
 * so the raster is built once per opening and kept until something it shows
 * has changed.
 */

import { PANEL_H, PANEL_W } from '../core/config.js';
import { panelsHigh, panelsWide } from '../core/tilemap.js';
import { TILE_RGB } from '../render/palette.js';
import { carveTo, isResourceNode, Tile } from '../core/tiles.js';
import type { Biome } from '../core/tiles.js';
import { MINI_POI_COLOR, MiniPoi, panelPoiIndex, sampleMinimapInto } from './minimap.js';
import { currentDay, waterLevel } from './queries.js';
import { PLAYER_H, PLAYER_W, type GameState } from './types.js';

/** Tiles scrolled per second while up or down is held. */
export const MAP_SCROLL_TILES_PER_SEC = 140;

const BG = '#06080c';
const UNSEEN = [10, 12, 16] as const;

interface Cache {
  canvas: OffscreenCanvas | HTMLCanvasElement | null;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  image: ImageData | null;
  key: string;
}
const cache: Cache = { canvas: null, ctx: null, image: null, key: '' };

/** Pickups the map should not give away: drawn as the ground beneath. */
function hidden(tile: number): boolean {
  return (
    isResourceNode(tile) ||
    tile === Tile.HeartContainer ||
    tile === Tile.AxeLeft ||
    tile === Tile.PickaxeLeft
  );
}

/** Where Noah is on the world map, in tiles — his door, if he is inside. */
export function mapPosition(state: GameState): { x: number; y: number } {
  if (state.location.kind !== 'overworld' && state.location.returnTo) return state.location.returnTo;
  return {
    x: Math.floor((state.player.x + PLAYER_W / 2) / 16),
    y: Math.floor((state.player.y + PLAYER_H / 2) / 16),
  };
}

function explored(state: GameState): number {
  let n = 0;
  for (const v of state.exploredOverworld) n += v;
  return n;
}

function build(state: GameState): HTMLCanvasElement | OffscreenCanvas {
  const world = state.world;
  const w = world.w;
  const h = world.h;
  if (!cache.canvas || cache.canvas.width !== w || cache.canvas.height !== h) {
    cache.canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    cache.ctx = cache.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    cache.image = cache.ctx.createImageData(w, h);
    cache.key = '';
  }
  const level = waterLevel(state);
  const day = currentDay(state);
  const key = `${state.hasChart ? 1 : 0}:${explored(state)}:${state.mapRevision}:${Math.floor(level)}:${Math.floor(day * 4)}`;
  if (key === cache.key) return cache.canvas;
  cache.key = key;

  const data = cache.image!.data;
  const cols = panelsWide(world);
  const rows = panelsHigh(world);
  const pois = panelPoiIndex(world);
  for (let py = 0; py < rows; py++) {
    for (let px = 0; px < cols; px++) {
      const seen = state.exploredOverworld[py * cols + px] === 1;
      for (let y = 0; y < PANEL_H; y++) {
        for (let x = 0; x < PANEL_W; x++) {
          const tx = px * PANEL_W + x;
          const ty = py * PANEL_H + y;
          if (tx >= w || ty >= h) continue;
          const o = (ty * w + tx) * 4;
          if (!seen) {
            data[o] = UNSEEN[0];
            data[o + 1] = UNSEEN[1];
            data[o + 2] = UNSEEN[2];
            data[o + 3] = 255;
            continue;
          }
          sampleMinimapInto(world, px, py, (x + 0.5) / PANEL_W, (y + 0.5) / PANEL_H, level, day, data, o);
          const tile = world.tiles[ty * w + tx];
          if (hidden(tile) && world.elev[ty * w + tx] >= level) {
            const c = carveTo(world.biome[ty * w + tx] as Biome) * 3;
            data[o] = TILE_RGB[c];
            data[o + 1] = TILE_RGB[c + 1];
            data[o + 2] = TILE_RGB[c + 2];
          }
          if (!state.hasChart) {
            const g = ((data[o] + data[o + 1] + data[o + 2]) / 3) | 0;
            data[o] = g;
            data[o + 1] = g;
            data[o + 2] = g;
          }
        }
      }
    }
  }
  cache.ctx!.putImageData(cache.image!, 0, 0);

  // Markers for what you've seen, Chart in hand: a backed pip per landmark.
  if (state.hasChart) {
    const c = cache.ctx!;
    for (let py = 0; py < rows; py++) {
      for (let px = 0; px < cols; px++) {
        if (state.exploredOverworld[py * cols + px] !== 1) continue;
        const poi = pois[py * cols + px] as MiniPoi;
        if (poi === MiniPoi.None || poi === MiniPoi.Heart) continue;
        pip(c, px * PANEL_W + (PANEL_W >> 1), py * PANEL_H + (PANEL_H >> 1), MINI_POI_COLOR[poi]);
      }
    }
  }
  return cache.canvas;
}

function pip(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, color: string): void {
  c.fillStyle = '#000';
  c.fillRect(x - 2, y - 2, 5, 5);
  c.fillStyle = color;
  c.fillRect(x - 1, y - 1, 3, 3);
}

/**
 * Draw the map over the whole screen. `scroll` is in tiles from the default
 * view, which centres on Noah; it is clamped here and the clamped value
 * returned, so the caller's scroll never runs away past the ends.
 */
export function drawFullMap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  screenW: number,
  screenH: number,
  scroll: number,
): number {
  const world = state.world;
  const raster = build(state);
  const headH = 14;
  const viewH = screenH - headH - 10;
  const ox = Math.floor((screenW - world.w) / 2);

  const me = mapPosition(state);
  const maxTop = Math.max(0, world.h - viewH);
  const wanted = me.y - Math.floor(viewH / 2) + scroll;
  const top = Math.max(0, Math.min(maxTop, wanted));
  const clamped = top - (me.y - Math.floor(viewH / 2));

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, screenW, screenH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raster as CanvasImageSource, 0, top, world.w, viewH, ox, headH, world.w, viewH);

  // Noah: a blinking white cross. The skiff, if it is set down somewhere.
  const blink = Math.floor(performance.now() / 300) % 2 === 0;
  if (state.hasChart && state.boatX >= 0 && state.boatY >= 0) {
    const by = state.boatY - top + headH;
    if (by >= headH && by < headH + viewH) {
      ctx.fillStyle = '#000';
      ctx.fillRect(ox + state.boatX - 2, by - 1, 5, 3);
      ctx.fillStyle = '#c8a46a';
      ctx.fillRect(ox + state.boatX - 1, by, 3, 1);
    }
  }
  const my = me.y - top + headH;
  if (my >= headH && my < headH + viewH) {
    ctx.fillStyle = '#000';
    ctx.fillRect(ox + me.x - 2, my - 2, 5, 5);
    ctx.fillStyle = blink ? '#ffffff' : '#e04a3a';
    ctx.fillRect(ox + me.x - 1, my, 3, 1);
    ctx.fillRect(ox + me.x, my - 1, 1, 3);
  }

  // Frame and words.
  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - 0.5, headH - 0.5, world.w + 1, viewH + 1);
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#efe6d2';
  ctx.fillText('THE WORLD', ox, 3);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8d98ab';
  ctx.fillText(state.hasChart ? '▲▼ scroll · M close' : 'A map would help.', ox + world.w, 3);
  ctx.textAlign = 'left';

  // Which way is up: a strip showing where the view sits in the world.
  const barH = viewH;
  const thumb = Math.max(4, Math.round((viewH / world.h) * barH));
  const at = Math.round((top / Math.max(1, world.h)) * barH);
  ctx.fillStyle = '#1a2030';
  ctx.fillRect(ox + world.w + 4, headH, 2, barH);
  ctx.fillStyle = '#8d98ab';
  ctx.fillRect(ox + world.w + 4, headH + at, 2, thumb);

  return clamped;
}
