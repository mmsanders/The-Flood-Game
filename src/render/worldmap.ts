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
import { type TileMap, panelsHigh, panelsWide } from '../core/tilemap.js';
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
export function renderOverviewBitmap(map: TileMap, opts: OverviewOptions): Canvas {
  const canvas = makeCanvas(map.w, map.h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = ctx.createImageData(map.w, map.h);
  const data = image.data;

  const level = waterLevelAtDay(opts.day);

  for (let i = 0; i < map.tiles.length; i++) {
    const tile = map.tiles[i];
    const elev = map.elev[i];

    let rgb: Rgb;
    switch (opts.overlay) {
      case 'biome':
        rgb = BIOME_RGB[map.biome[i]];
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

    if (map.floods && elev < level) {
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
 * Panel grid lines, drawn in world (tile) coordinates. The caller has already
 * applied the zoom transform, so line width is divided back out to keep hairlines
 * hairline-thin at every zoom level.
 */
export function drawPanelGrid(
  ctx: CanvasRenderingContext2D,
  map: TileMap,
  scale: number,
): void {
  if (scale < 1.5) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let px = 1; px < panelsWide(map); px++) {
    ctx.moveTo(px * PANEL_W, 0);
    ctx.lineTo(px * PANEL_W, map.h);
  }
  for (let py = 1; py < panelsHigh(map); py++) {
    ctx.moveTo(0, py * PANEL_H);
    ctx.lineTo(map.w, py * PANEL_H);
  }
  ctx.stroke();
  ctx.restore();
}

export const POI_STYLE = [
  { color: PALETTE.ark, glyph: 'A', label: 'Ark site' },
  { color: '#e0b52e', glyph: 'D', label: 'Dungeon' },
  { color: PALETTE.heart, glyph: '♥', label: 'Heart container' },
  { color: PALETTE.town, glyph: 'T', label: 'Town' },
] as const;

/** POI markers in world coordinates, sized in screen pixels. */
export function drawPoiMarkers(
  ctx: CanvasRenderingContext2D,
  world: World,
  scale: number,
): void {
  // Marker radius is fixed on screen, so pins stay tappable when zoomed out.
  const r = Math.max(3.5, Math.min(9, 30 / scale)) / 1;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const marker = (x: number, y: number, color: string, glyph: string): void => {
    const cx = x + 0.5;
    const cy = y + 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, r * 0.25);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.stroke();

    if (r * scale >= 9) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 1.3}px system-ui, sans-serif`;
      ctx.fillText(glyph, cx, cy + r * 0.08);
    }
  };

  for (const poi of world.pois) {
    const style = POI_STYLE[poi.kind] ?? POI_STYLE[0];
    marker(poi.x, poi.y, style.color, style.glyph);
  }

  // Spawn last so it sits on top of anything it overlaps.
  marker(world.spawn.x, world.spawn.y, '#ffffff', 'S');
  ctx.restore();
}

/**
 * A single panel at full sprite detail — what the game itself will look like.
 * Used by the dev tool's panel inspector.
 */
export function renderPanel(
  map: TileMap,
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
      const i = wy * map.w + wx;
      const tile = map.tiles[i];

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

      if (map.floods && map.elev[i] < level) {
        const depth = Math.min(1, (level - map.elev[i]) / 60);
        ctx.fillStyle = depth > 0.5 ? 'rgba(20, 60, 120, 0.78)' : PALETTE.floodTint;
        ctx.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
      }
    }
  }

  return canvas;
}
