/**
 * Zelda-1-style explored-panel map.
 *
 * Only visited panels are drawn. Cells stay square. They grow while the
 * trail is small, but never shrink below the size that would tile the well
 * east-to-west (one column per world panel). If that floor makes the strip
 * taller than the well, the view pans — and only whole tiles are drawn, so
 * nothing bleeds off the north or south edge.
 */

import { PANEL_H, PANEL_W } from '../core/config.js';
import { floodDepth } from '../core/flood.js';
import { panelsHigh, panelsWide, type TileMap } from '../core/tilemap.js';
import { Biome, Tile } from '../core/tiles.js';
import { PoiKind, type Poi, type World } from '../core/world.js';
import { BIOME_COLORS, PALETTE, TILE_RGB, tileColor } from '../render/palette.js';

export const MINIMAP_X = 0;
export const MINIMAP_Y = 0;
export const MINIMAP_W = 40;
/** Full HUD height, so the left column is black, not HUD grey. */
export const MINIMAP_H = 48;
/** Square used for tile sizing and for the map while you are not at the south. */
export const MINIMAP_CORE = 40;

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
  /** Whole rows that fit in the well at this cell size. */
  viewRows: number;
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

/**
 * How many panels have been stood on.
 *
 * The HUD map caches its raster, and this is the cheap half of the cache key:
 * a scan of one byte per panel, versus rebuilding the cell list every frame
 * to find out that nothing moved.
 */
export function countVisited(grid: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) n += grid[i];
  return n;
}

/** Inset so a cluster floats in the well instead of flushing to the frame. */
const FLOAT_PAD = 2;

/**
 * Fit visited panels into the well. Cells are square. They may grow while
 * the trail is small, but never drop below the east-west grid size — so a
 * long north-south walk pans instead of shrinking into specks.
 */
export function layoutMiniMap(
  cells: readonly MiniMapCell[],
  wellX: number,
  wellY: number,
  wellW: number,
  wellH: number,
  worldCols: number,
  worldRows: number,
  playerPanelY = 0,
  fillSouth = false,
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
  const core = Math.min(wellW, wellH, MINIMAP_CORE);
  const minCell = Math.max(1, Math.floor(wellW / Math.max(1, worldCols)));
  const fitted = fitSquare(cols, rows, wellW - FLOAT_PAD * 2, core - FLOAT_PAD * 2);
  const cell = Math.max(minCell, fitted.cell);
  const gap = cell > minCell ? fitted.gap : 0;
  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = rows * cell + (rows - 1) * gap;
  const scrolls = gridH > core;
  const step = cell + gap;
  const coreRows = Math.max(1, Math.floor((core + gap) / step));
  const maxRows = Math.max(1, Math.floor((wellH + gap) / step));
  const extra = Math.max(0, maxRows - coreRows);
  const distFromSouth = worldRows - 1 - playerPanelY;
  let viewRows = rows;
  if (scrolls) {
    if (fillSouth) viewRows = Math.min(maxRows, rows);
    else viewRows = distFromSouth >= extra ? coreRows : maxRows - distFromSouth;
    viewRows = Math.max(1, Math.min(viewRows, rows, maxRows));
  }

  return {
    cell,
    gap,
    originX: wellX + ((wellW - gridW) >> 1),
    originY: scrolls ? wellY : wellY + ((core - gridH) >> 1),
    minX,
    minY,
    cols,
    rows,
    scrolls,
    viewRows,
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
 * `viewY` is an integer panel-row at the top of the well, so tiles never
 * sit half-off the frame.
 */
export function followMinimapView(
  viewY: number,
  playerPanelY: number,
  viewRows: number,
  exploredMinY: number,
  exploredRows: number,
  scrolls: boolean,
): number {
  if (!scrolls || viewRows <= 0) return exploredMinY;
  const lo = viewRows / 3;
  const hi = (2 * viewRows) / 3;
  let next = viewY;
  const rel = playerPanelY - viewY;
  if (rel < lo) next = playerPanelY - lo;
  else if (rel > hi) next = playerPanelY - hi;
  next = Math.round(next);
  const minY = exploredMinY;
  const maxY = exploredMinY + Math.max(0, exploredRows - viewRows);
  if (next < minY) return minY;
  if (next > maxY) return maxY;
  return next;
}

export const enum MiniPoi {
  None = 0,
  Heart = 1,
  Slipway = 2,
  Town = 3,
  Shrine = 4,
  Ark = 5,
  Dungeon = 6,
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
            : p.kind === PoiKind.BoatYard
              ? MiniPoi.Slipway
              : p.kind === PoiKind.Shrine
                ? MiniPoi.Shrine
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

/**
 * Which landmark each overworld panel shows on the HUD map, one byte per panel.
 *
 * Built once per world and cached against it. The naive version asked this
 * question per panel per frame, and answering it for a town meant scanning all
 * 176 tiles of the panel — roughly 170,000 tile reads a frame late in a run,
 * to recompute an answer that cannot change. Towns and shrines are placed by
 * worldgen and never appear or move during play.
 */
const poiIndexCache = new WeakMap<World, Uint8Array>();

export function panelPoiIndex(world: World): Uint8Array {
  const cached = poiIndexCache.get(world);
  if (cached) return cached;

  const cols = panelsWide(world);
  const rows = panelsHigh(world);
  const index = new Uint8Array(cols * rows);

  for (let py = 0; py < rows; py++) {
    for (let px = 0; px < cols; px++) {
      let poi = panelPoi(world.pois, px, py);
      if (poi === MiniPoi.None && panelHasTile(world, px, py, Tile.TownDoor)) {
        poi = MiniPoi.Town;
      }
      index[py * cols + px] = poi;
    }
  }

  poiIndexCache.set(world, index);
  return index;
}

/**
 * Same sample as `sampleMinimapRgb`, written straight into an RGBA buffer.
 *
 * Avoids returning a fresh three-element tuple per pixel, and reads the tile
 * colour out of a byte table rather than re-parsing a hex string.
 */
export function sampleMinimapInto(
  map: TileMap,
  panelX: number,
  panelY: number,
  u: number,
  v: number,
  waterLevel: number,
  runoff: number,
  out: Uint8ClampedArray,
  o: number,
): void {
  const x0 = panelX * PANEL_W;
  const y0 = panelY * PANEL_H;
  const tx = x0 + Math.min(PANEL_W - 1, Math.max(0, (u * PANEL_W) | 0));
  const ty = y0 + Math.min(PANEL_H - 1, Math.max(0, (v * PANEL_H) | 0));

  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) {
    out[o] = WELL_RGB[0];
    out[o + 1] = WELL_RGB[1];
    out[o + 2] = WELL_RGB[2];
    out[o + 3] = 255;
    return;
  }

  const i = ty * map.w + tx;
  const c = map.tiles[i] * 3;
  let r = TILE_RGB[c];
  let g = TILE_RGB[c + 1];
  let b = TILE_RGB[c + 2];

  if (map.floods) {
    // The gorge runs before the sea arrives, so the HUD map shows the river
    // filling in from the north — which is the clearest signal the rain has
    // actually started.
    const flood = floodDepth(map.elev[i], waterLevel);
    const depth = map.tiles[i] === Tile.Gorge && runoff > flood ? runoff : flood;
    if (depth > 0) {
      const wet = depth >= 3 ? DEEP : SHALLOW;
      const t = depth === 1 ? 0.28 : depth === 2 ? 0.52 : depth === 3 ? 0.78 : 1;
      r = (r + (wet[0] - r) * t + 0.5) | 0;
      g = (g + (wet[1] - g) * t + 0.5) | 0;
      b = (b + (wet[2] - b) * t + 0.5) | 0;
    }
  }

  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
  out[o + 3] = 255;
}

export const MINI_POI_COLOR: Record<MiniPoi, string> = {
  [MiniPoi.None]: '#000000',
  [MiniPoi.Heart]: PALETTE.heart,
  [MiniPoi.Slipway]: PALETTE.dock,
  [MiniPoi.Town]: PALETTE.town,
  [MiniPoi.Shrine]: PALETTE.shrine,
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
  return hex(sampleMinimapRgb(map, panelX, panelY, u, v, waterLevel));
}

const WELL_RGB: Rgb = [8, 10, 14];

/** Same sample as `sampleMinimapPixel`, as bytes, for ImageData. */
export function sampleMinimapRgb(
  map: TileMap,
  panelX: number,
  panelY: number,
  u: number,
  v: number,
  waterLevel: number,
): Rgb {
  const x0 = panelX * PANEL_W;
  const y0 = panelY * PANEL_H;
  const tx = x0 + Math.min(PANEL_W - 1, Math.max(0, (u * PANEL_W) | 0));
  const ty = y0 + Math.min(PANEL_H - 1, Math.max(0, (v * PANEL_H) | 0));
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return WELL_RGB;
  const i = ty * map.w + tx;
  const land = hexToRgb(tileColor(map.tiles[i]));
  if (!map.floods) return land;
  const depth = floodDepth(map.elev[i], waterLevel);
  if (depth <= 0) return land;
  const wet = depth >= 3 ? DEEP : SHALLOW;
  const t = depth === 1 ? 0.28 : depth === 2 ? 0.52 : depth === 3 ? 0.78 : 1;
  return mix(land, wet, t);
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

function fitSquare(
  cols: number,
  rows: number,
  innerW: number,
  innerH: number,
): { cell: number; gap: number } {
  const w = Math.max(1, innerW);
  const h = Math.max(1, innerH);
  for (const gap of [1, 0]) {
    const cell = Math.min(
      Math.floor((w - (cols - 1) * gap) / cols),
      Math.floor((h - (rows - 1) * gap) / rows),
    );
    if (gap === 1 && cell >= 4) return { cell, gap };
    if (gap === 0) return { cell: Math.max(1, cell), gap: 0 };
  }
  return { cell: 1, gap: 0 };
}
