/**
 * Zelda-1-style explored-panel map.
 *
 * Only visited panels are drawn. Early on, cells are large squares recentred
 * in the well. Cell size follows how many columns you have actually walked,
 * not the world's full width, so a tall-but-narrow trail still looks like a
 * floating cluster. A little pad around the cluster keeps the edge of the
 * world a secret until you have walked it. Tiles stay square; when the
 * strip is taller than the well the view follows the player with a dead
 * zone: stay two-thirds up while heading north, wait until two-thirds down
 * before scrolling south.
 */

import { PANEL_H, PANEL_W } from '../core/config.js';
import type { TileMap } from '../core/tilemap.js';
import { Biome } from '../core/tiles.js';
import { PoiKind, type Poi } from '../core/world.js';
import { BIOME_COLORS, PALETTE, tileColor } from '../render/palette.js';

export const MINIMAP_X = 0;
export const MINIMAP_Y = 0;
export const MINIMAP_W = 40;
export const MINIMAP_H = 40;

export interface MiniMapCell {
  x: number;
  y: number;
}

export interface MiniMapLayout {
  cell: number;
  gap: number;
  originX: number;
  originY: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  /** True when the square-tile strip is taller than the well. */
  scrolls: boolean;
  wellX: number;
  wellY: number;
  wellW: number;
  wellH: number;
}

/** Packed 0/1 grid → the panels that have actually been stood on. */
export function visitedCells(grid: Uint8Array, width: number): MiniMapCell[] {
  const cells: MiniMapCell[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) cells.push({ x: i % width, y: (i / width) | 0 });
  }
  return cells;
}

/** Inset so a cluster floats in the well instead of flushing to the frame. */
const FLOAT_PAD = 2;

/**
 * Fit visited panels into the well. Cells are always square, sized from the
 * explored column count so they nearly fill the width with a little pad.
 * Row count never shrinks the tiles — a north-south trail pans instead of
 * pretending you have already seen the whole east-west span.
 */
export function layoutMiniMap(
  cells: readonly MiniMapCell[],
  wellX: number,
  wellY: number,
  wellW: number,
  wellH: number,
  _worldCols: number,
  _worldRows: number,
): MiniMapLayout | null {
  if (cells.length === 0) return null;

  let minX = cells[0].x;
  let minY = cells[0].y;
  let maxX = minX;
  let maxY = minY;
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i];
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const innerW = Math.max(1, wellW - FLOAT_PAD * 2);
  const { cell, gap } = fitWidth(cols, innerW);
  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = rows * cell + (rows - 1) * gap;
  const scrolls = gridH > wellH;

  return {
    cell,
    gap,
    originX: wellX + ((wellW - gridW) >> 1),
    originY: scrolls ? wellY : wellY + ((wellH - gridH) >> 1),
    minX,
    minY,
    cols,
    rows,
    scrolls,
    wellX,
    wellY,
    wellW,
    wellH,
  };
}

/**
 * Keep the player in a vertical dead zone: two-thirds up while climbing,
 * and only start following south once they sit two-thirds down.
 *
 * `viewY` is the panel-row at the top of the well. Units are panels, and
 * may be fractional so a 3px cell still pans smoothly.
 */
export function followMinimapView(
  viewY: number,
  playerPanelY: number,
  cell: number,
  wellH: number,
  worldRows: number,
  scrolls: boolean,
): number {
  if (!scrolls || cell <= 0) return viewY;
  const viewRows = wellH / cell;
  const lo = viewRows / 3;
  const hi = (2 * viewRows) / 3;
  const rel = playerPanelY - viewY;
  let next = viewY;
  if (rel < lo) next = playerPanelY - lo;
  else if (rel > hi) next = playerPanelY - hi;
  const maxY = Math.max(0, worldRows - viewRows);
  if (next < 0) return 0;
  if (next > maxY) return maxY;
  return next;
}

export const enum MiniPoi {
  None = 0,
  Heart = 1,
  Town = 2,
  Ark = 3,
  Dungeon = 4,
}

type Rgb = readonly [number, number, number];

const SHALLOW: Rgb = [0x2b, 0x6c, 0xb0];
const DEEP: Rgb = [0x1c, 0x4a, 0x80];
const BIOME_RGB: Rgb[] = BIOME_COLORS.map(hexToRgb);

function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function hex(rgb: Rgb): string {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    (a[0] + (b[0] - a[0]) * u + 0.5) | 0,
    (a[1] + (b[1] - a[1]) * u + 0.5) | 0,
    (a[2] + (b[2] - a[2]) * u + 0.5) | 0,
  ];
}

/** Land colour for a 1px cell: biome, cooled as water takes the panel. */
export function minimapLandColor(biome: Biome, depth: number): string {
  return hex(mix(BIOME_RGB[biome] ?? BIOME_RGB[Biome.Valley], SHALLOW, depth * 0.4));
}

/** Standing water on the map. Deepens once more than half the panel is gone. */
export function minimapWaterColor(depth: number): string {
  if (depth <= 0.55) return hex(SHALLOW);
  return hex(mix(SHALLOW, DEEP, (depth - 0.55) / 0.45));
}

/**
 * Single-pixel (or 2px) cells cannot show a waterline, so they become a
 * straight dry→shallow→deep tint of the flood fraction.
 */
export function minimapFlatColor(biome: Biome, depth: number): string {
  const land = BIOME_RGB[biome] ?? BIOME_RGB[Biome.Valley];
  if (depth <= 0) return hex(land);
  if (depth >= 1) return hex(DEEP);
  if (depth < 0.5) return hex(mix(land, SHALLOW, depth * 2));
  return hex(mix(SHALLOW, DEEP, (depth - 0.5) * 2));
}

/** Majority biome of a panel, for the 1px-wide map. */
export function dominantBiome(map: TileMap, panelX: number, panelY: number): Biome {
  const counts = [0, 0, 0, 0];
  visitPanel(map, panelX, panelY, (i) => {
    counts[map.biome[i]]++;
  });
  let best = Biome.Valley;
  let n = -1;
  for (let b = 0; b < counts.length; b++) {
    if (counts[b] > n) {
      n = counts[b];
      best = b as Biome;
    }
  }
  return best;
}

/**
 * Highest-priority landmark sitting on this panel. Dungeons beat the ark,
 * which beats a town, which beats a heart — so a crowded screen still reads.
 */
export function panelPoi(pois: readonly Poi[], panelX: number, panelY: number): MiniPoi {
  let best = MiniPoi.None;
  for (const p of pois) {
    if (((p.x / PANEL_W) | 0) !== panelX || ((p.y / PANEL_H) | 0) !== panelY) continue;
    const kind =
      p.kind === PoiKind.Dungeon
        ? MiniPoi.Dungeon
        : p.kind === PoiKind.Ark
          ? MiniPoi.Ark
          : p.kind === PoiKind.Town
            ? MiniPoi.Town
            : p.kind === PoiKind.Heart
              ? MiniPoi.Heart
              : MiniPoi.None;
    if (kind > best) best = kind;
  }
  return best;
}

export function panelHasTile(
  map: TileMap,
  panelX: number,
  panelY: number,
  tile: number,
): boolean {
  let found = false;
  visitPanel(map, panelX, panelY, (i) => {
    if (map.tiles[i] === tile) found = true;
  });
  return found;
}

export const MINI_POI_COLOR: Record<MiniPoi, string> = {
  [MiniPoi.None]: '#000000',
  [MiniPoi.Heart]: PALETTE.heart,
  [MiniPoi.Town]: PALETTE.town,
  [MiniPoi.Ark]: PALETTE.ark,
  [MiniPoi.Dungeon]: '#c8b8e8',
};

/**
 * One HUD pixel of a panel: the actual tile, or floodwater if that tile is
 * already under. Large cells become a tiny world painting; 1px cells sample
 * the centre.
 */
export function sampleMinimapPixel(
  map: TileMap,
  panelX: number,
  panelY: number,
  u: number,
  v: number,
  waterLevel: number,
): string {
  const x0 = panelX * PANEL_W;
  const y0 = panelY * PANEL_H;
  const tx = x0 + Math.min(PANEL_W - 1, Math.max(0, (u * PANEL_W) | 0));
  const ty = y0 + Math.min(PANEL_H - 1, Math.max(0, (v * PANEL_H) | 0));
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return '#080a0e';
  const i = ty * map.w + tx;
  const elev = map.elev[i];
  if (map.floods && elev < waterLevel) {
    const t = Math.min(1, (waterLevel - elev) / 80);
    return hex(mix(SHALLOW, DEEP, t));
  }
  return tileColor(map.tiles[i]);
}

function visitPanel(
  map: TileMap,
  panelX: number,
  panelY: number,
  fn: (i: number) => void,
): void {
  const x0 = panelX * PANEL_W;
  const y0 = panelY * PANEL_H;
  const x1 = Math.min(map.w, x0 + PANEL_W);
  const y1 = Math.min(map.h, y0 + PANEL_H);
  for (let y = Math.max(0, y0); y < y1; y++) {
    const row = y * map.w;
    for (let x = Math.max(0, x0); x < x1; x++) fn(row + x);
  }
}

/** How many pixels of a cell are drawn as water, rising from the bottom. */
export function floodFillHeight(cellH: number, depth: number): number {
  if (depth <= 0 || cellH <= 0) return 0;
  return Math.max(1, Math.round(cellH * depth));
}

export function cellRect(
  layout: MiniMapLayout,
  x: number,
  y: number,
  viewY = 0,
): { x: number; y: number; w: number; h: number } {
  const lx = x - layout.minX;
  const ly = layout.scrolls ? y - viewY : y - layout.minY;
  const step = layout.cell + layout.gap;
  return {
    x: layout.originX + lx * step,
    y: layout.originY + ly * step,
    w: layout.cell,
    h: layout.cell,
  };
}

function fitWidth(cols: number, innerW: number): { cell: number; gap: number } {
  for (const gap of [1, 0]) {
    const cell = Math.floor((innerW - (cols - 1) * gap) / cols);
    if (gap === 1 && cell >= 4) return { cell, gap };
    if (gap === 0) return { cell: Math.max(1, cell), gap: 0 };
  }
  return { cell: 1, gap: 0 };
}
