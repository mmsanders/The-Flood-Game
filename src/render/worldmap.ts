/**
 * Whole-world rendering for the dev tool.
 *
 * The overview is built as ImageData at exactly one pixel per tile and then
 * scaled up with smoothing off. That keeps the expensive part proportional to
 * the tile count rather than the zoom level, so a 12x40 map (84,480 tiles)
 * redraws in a few milliseconds even on a phone.
 */

import { PANEL_H, PANEL_W, TILE_PX } from '../core/config.js';
import { waterLevelAtDay } from '../core/flood.js';
import { isWalkable } from '../core/tiles.js';
import type { World } from '../core/world.js';
import { BIOME_COLORS, PALETTE, elevationColor, tileColor } from './palette.js';
import { type Canvas, getTilesheet, tileSheetX, tileSheetY } from './tilesheet.js';

export type Overlay = 'tiles' | 'biome' | 'elevation' | 'walkable';

export interface OverviewOptions {
  /** Day 0..40. Tiles below the water line at this day are tinted. */
  day: number;
  overlay: Overlay;
  showPois: boolean;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const FLOOD_RGB: Rgb = hexToRgb(PALETTE.water);
const FLOOD_DEEP_RGB: Rgb = hexToRgb(PALETTE.waterDeep);

/** Tile colours resolved to RGB once, since we touch them per pixel. */
const TILE_RGB = new Map<number, Rgb>();
function tileRgb(tile: number): Rgb {
  let rgb = TILE_RGB.get(tile);
  if (!rgb) {
    rgb = hexToRgb(tileColor(tile));
    TILE_RGB.set(tile, rgb);
  }
  return rgb;
}

const BIOME_RGB = BIOME_COLORS.map(hexToRgb);
const ELEV_RGB = new Map<number, Rgb>();
function elevRgb(elev: number): Rgb {
  let rgb = ELEV_RGB.get(elev);
  if (!rgb) {
    rgb = hexToRgb(elevationColor(elev));
    ELEV_RGB.set(elev, rgb);
  }
  return rgb;
}

const WALKABLE_RGB: Rgb = [222, 226, 214];
const BLOCKED_RGB: Rgb = [58, 54, 50];

function makeCanvas(w: number, h: number): Canvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

/** One pixel per tile. This is the expensive pass, so it stays 1:1. */
export function renderOverviewBitmap(world: World, opts: OverviewOptions): Canvas {
  const canvas = makeCanvas(world.w, world.h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = ctx.createImageData(world.w, world.h);
  const data = image.data;

  const level = waterLevelAtDay(opts.day);

  for (let i = 0; i < world.tiles.length; i++) {
    const tile = world.tiles[i];
    const elev = world.elev[i];

    let rgb: Rgb;
    switch (opts.overlay) {
      case 'biome':
        rgb = BIOME_RGB[world.biome[i]];
        break;
      case 'elevation':
        rgb = elevRgb(elev);
        break;
      case 'walkable':
        rgb = isWalkable(tile) ? WALKABLE_RGB : BLOCKED_RGB;
        break;
      default:
        rgb = tileRgb(tile);
    }

    let [r, g, b] = rgb;

    if (elev < level) {
      // Depth of submersion drives the tint, so the trench in the south reads
      // as deeper water than ground that only just went under.
      const depth = Math.min(1, (level - elev) / 60);
      const water = depth > 0.5 ? FLOOD_DEEP_RGB : FLOOD_RGB;
      const mix = 0.55 + depth * 0.4;
      r = Math.round(r * (1 - mix) + water[0] * mix);
      g = Math.round(g * (1 - mix) + water[1] * mix);
      b = Math.round(b * (1 - mix) + water[2] * mix);
    }

    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Scale the overview up, draw panel grid lines and POI markers.
 * Cheap: one scaled blit plus a handful of strokes.
 */
export function renderOverview(
  world: World,
  opts: OverviewOptions,
  scale: number,
): Canvas {
  const bitmap = renderOverviewBitmap(world, opts);
  const canvas = makeCanvas(world.w * scale, world.h * scale);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  drawPanelGrid(ctx, world, scale, canvas.width, canvas.height);
  if (opts.showPois) drawPoiMarkers(ctx, world, scale);

  return canvas;
}

function drawPanelGrid(
  ctx: CanvasRenderingContext2D,
  world: World,
  scale: number,
  width: number,
  height: number,
): void {
  if (scale < 2) return;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = 1; px < world.params.panelsX; px++) {
    const x = Math.round(px * PANEL_W * scale) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let py = 1; py < world.params.panelsY; py++) {
    const y = Math.round(py * PANEL_H * scale) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

const POI_STYLE = [
  { color: PALETTE.ark, glyph: 'A' },
  { color: '#c9a227', glyph: 'D' },
  { color: PALETTE.heart, glyph: '♥' },
  { color: PALETTE.town, glyph: 'T' },
];

function drawPoiMarkers(ctx: CanvasRenderingContext2D, world: World, scale: number): void {
  const r = Math.max(4, scale * 3);

  const marker = (x: number, y: number, color: string, glyph: string): void => {
    const cx = (x + 0.5) * scale;
    const cy = (y + 0.5) * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.3);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.stroke();

    if (r >= 6) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.25)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, cx, cy + r * 0.05);
    }
  };

  for (const poi of world.pois) {
    const style = POI_STYLE[poi.kind] ?? POI_STYLE[0];
    marker(poi.x, poi.y, style.color, style.glyph);
  }

  // Spawn last so it sits on top of anything it overlaps.
  marker(world.spawn.x, world.spawn.y, '#ffffff', 'S');
}

/**
 * A single panel at full sprite detail — what the game itself will look like.
 * Used by the dev tool's panel inspector.
 */
export function renderPanel(
  world: World,
  panelX: number,
  panelY: number,
  opts: { day: number; scale: number },
): Canvas {
  const scale = opts.scale;
  const canvas = makeCanvas(PANEL_W * TILE_PX * scale, PANEL_H * TILE_PX * scale);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);

  const sheet = getTilesheet();
  const level = waterLevelAtDay(opts.day);

  for (let ty = 0; ty < PANEL_H; ty++) {
    const wy = panelY * PANEL_H + ty;
    for (let tx = 0; tx < PANEL_W; tx++) {
      const wx = panelX * PANEL_W + tx;
      const i = wy * world.w + wx;
      const tile = world.tiles[i];

      ctx.drawImage(
        sheet as CanvasImageSource,
        tileSheetX(tile),
        tileSheetY(tile),
        TILE_PX,
        TILE_PX,
        tx * TILE_PX,
        ty * TILE_PX,
        TILE_PX,
        TILE_PX,
      );

      if (world.elev[i] < level) {
        const depth = Math.min(1, (level - world.elev[i]) / 60);
        ctx.fillStyle = depth > 0.5 ? 'rgba(20, 60, 120, 0.78)' : PALETTE.floodTint;
        ctx.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
      }
    }
  }

  return canvas;
}
