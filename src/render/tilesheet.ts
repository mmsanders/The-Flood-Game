/**
 * The tilesheet, drawn in code rather than loaded from a file.
 *
 * Zero binary assets: every 16x16 tile is a handful of rectangles over a flat
 * base colour, in the spirit of the era. Because a tile's texture is fixed
 * rather than randomised, fields of grass or forest repeat the identical
 * sprite — which is exactly the old-school look we're after.
 *
 * The sheet is a 16x16 grid of tiles, indexed directly by tile ID: tile 0x21
 * lives at column 1, row 2. That makes the byte value and its sprite the same
 * lookup, with no indirection table to keep in sync.
 */

import { TILE_PX } from '../core/config.js';
import { Tile } from '../core/tiles.js';
import { PALETTE } from './palette.js';

export const SHEET_COLS = 16;
export const SHEET_SIZE = SHEET_COLS * TILE_PX;

export type Canvas = HTMLCanvasElement | OffscreenCanvas;

let cached: Canvas | null = null;

/** Build (or return the cached) tilesheet. */
export function getTilesheet(): Canvas {
  if (!cached) cached = buildTilesheet();
  return cached;
}

export function tileSheetX(tile: number): number {
  return (tile % SHEET_COLS) * TILE_PX;
}

export function tileSheetY(tile: number): number {
  return Math.floor(tile / SHEET_COLS) * TILE_PX;
}

function makeCanvas(w: number, h: number): Canvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export function buildTilesheet(): Canvas {
  const canvas = makeCanvas(SHEET_SIZE, SHEET_SIZE);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;

  // Unknown tiles show as magenta so a missing sprite is impossible to miss.
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, SHEET_SIZE, SHEET_SIZE);

  for (const [tile, draw] of Object.entries(TILE_PAINTERS)) {
    const id = Number(tile);
    ctx.save();
    ctx.translate(tileSheetX(id), tileSheetY(id));
    draw(ctx);
    ctx.restore();
  }

  return canvas;
}

/** Fill the whole 16x16 cell. */
function base(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
}

/** A single block of pixels within the cell. */
function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Scatter fixed 2x2 specks, so texture is identical in every instance. */
function specks(
  ctx: CanvasRenderingContext2D,
  color: string,
  spots: readonly (readonly [number, number])[],
): void {
  ctx.fillStyle = color;
  for (const [x, y] of spots) ctx.fillRect(x, y, 2, 2);
}

const SPARSE = [
  [2, 3],
  [9, 1],
  [5, 8],
  [12, 6],
  [7, 12],
  [1, 10],
  [13, 12],
] as const;

const DENSE = [
  [1, 1],
  [5, 2],
  [9, 3],
  [13, 1],
  [3, 6],
  [7, 5],
  [11, 7],
  [2, 10],
  [6, 11],
  [10, 12],
  [14, 9],
  [4, 13],
] as const;

type Painter = (ctx: CanvasRenderingContext2D) => void;

const TILE_PAINTERS: Record<number, Painter> = {
  // -- ground ---------------------------------------------------------------
  [Tile.Grass]: (c) => {
    base(c, PALETTE.grass);
    specks(c, PALETTE.grassAlt, SPARSE);
  },

  [Tile.TallGrass]: (c) => {
    base(c, PALETTE.grass);
    c.fillStyle = PALETTE.tallGrass;
    for (let x = 1; x < TILE_PX; x += 4) {
      c.fillRect(x, 4, 2, 8);
      c.fillRect(x + 2, 8, 2, 6);
    }
  },

  [Tile.Dirt]: (c) => {
    base(c, PALETTE.dirt);
    specks(c, '#8f5f30', SPARSE);
  },

  [Tile.Crop]: (c) => {
    base(c, PALETTE.dirt);
    c.fillStyle = PALETTE.crop;
    for (let x = 2; x < TILE_PX; x += 5) c.fillRect(x, 2, 3, 12);
    px(c, 0, 14, TILE_PX, 2, '#8f5f30');
  },

  [Tile.Sand]: (c) => {
    base(c, PALETTE.sand);
    specks(c, '#c4ae74', SPARSE);
  },

  [Tile.Path]: (c) => {
    base(c, PALETTE.path);
    specks(c, '#a98f60', SPARSE);
  },

  [Tile.Gravel]: (c) => {
    base(c, PALETTE.gravel);
    specks(c, '#736d62', DENSE);
  },

  [Tile.StoneGround]: (c) => {
    base(c, PALETTE.stoneGround);
    px(c, 0, 0, TILE_PX, 1, '#8d8779');
    px(c, 0, 8, TILE_PX, 1, '#635e54');
    px(c, 8, 0, 1, 8, '#635e54');
    px(c, 4, 8, 1, 8, '#635e54');
  },

  [Tile.Snow]: (c) => {
    base(c, PALETTE.snow);
    specks(c, '#cdd8e0', SPARSE);
  },

  [Tile.Reed]: (c) => {
    base(c, PALETTE.reed);
    c.fillStyle = '#3f6b33';
    for (let x = 2; x < TILE_PX; x += 4) c.fillRect(x, 1, 1, 14);
  },

  // -- blocking scenery -----------------------------------------------------
  [Tile.Tree]: (c) => {
    base(c, PALETTE.grass);
    px(c, 7, 11, 2, 5, PALETTE.treeTrunk);
    c.fillStyle = PALETTE.tree;
    c.fillRect(3, 1, 10, 10);
    c.fillRect(1, 3, 14, 6);
    px(c, 4, 2, 4, 3, '#2a7d24');
  },

  [Tile.Shrub]: (c) => {
    base(c, PALETTE.grass);
    c.fillStyle = PALETTE.shrub;
    c.fillRect(3, 5, 10, 8);
    c.fillRect(2, 7, 12, 5);
    px(c, 4, 6, 3, 2, '#3f9a4c');
  },

  [Tile.Rock]: (c) => {
    base(c, PALETTE.gravel);
    c.fillStyle = PALETTE.rock;
    c.fillRect(3, 4, 10, 9);
    c.fillRect(2, 6, 12, 6);
    px(c, 4, 5, 4, 2, '#847c6f');
    px(c, 3, 11, 10, 2, PALETTE.rockShade);
  },

  [Tile.Cliff]: (c) => {
    base(c, PALETTE.cliff);
    px(c, 0, 0, TILE_PX, 3, '#635c52');
    px(c, 0, 13, TILE_PX, 3, PALETTE.cliffShade);
    px(c, 5, 3, 2, 10, PALETTE.cliffShade);
    px(c, 11, 3, 2, 10, PALETTE.cliffShade);
  },

  [Tile.Water]: (c) => {
    base(c, PALETTE.water);
    px(c, 0, 0, TILE_PX, 4, PALETTE.waterDeep);
    c.fillStyle = PALETTE.waterShallow;
    c.fillRect(2, 6, 5, 1);
    c.fillRect(9, 10, 5, 1);
    c.fillRect(4, 13, 4, 1);
  },

  // -- resource nodes -------------------------------------------------------
  [Tile.Flax]: (c) => {
    base(c, PALETTE.grass);
    c.fillStyle = '#6f9c3a';
    for (let x = 2; x < 15; x += 4) c.fillRect(x, 6, 2, 9);
    c.fillStyle = PALETTE.flax;
    for (let x = 2; x < 15; x += 4) c.fillRect(x - 1, 2, 4, 5);
  },

  [Tile.GopherTree]: (c) => {
    base(c, PALETTE.grass);
    px(c, 6, 9, 4, 7, PALETTE.gopher);
    c.fillStyle = '#2f6b26';
    c.fillRect(2, 1, 12, 9);
    c.fillRect(1, 3, 14, 5);
    px(c, 3, 2, 4, 2, '#468a35');
    px(c, 6, 11, 4, 1, '#5a3a1c');
  },

  [Tile.StoneNode]: (c) => {
    base(c, PALETTE.gravel);
    c.fillStyle = PALETTE.stoneNode;
    c.fillRect(2, 5, 6, 8);
    c.fillRect(8, 3, 6, 10);
    px(c, 3, 6, 3, 2, '#c3c9ce');
    px(c, 9, 4, 3, 2, '#c3c9ce');
    px(c, 2, 12, 12, 1, PALETTE.rockShade);
  },

  [Tile.PitchSeep]: (c) => {
    base(c, PALETTE.stoneGround);
    c.fillStyle = PALETTE.pitch;
    c.fillRect(3, 5, 10, 8);
    c.fillRect(2, 7, 12, 4);
    px(c, 5, 6, 3, 2, '#4a423c');
  },

  // -- points of interest ---------------------------------------------------
  [Tile.ArkSite]: (c) => {
    base(c, PALETTE.dirt);
    c.fillStyle = PALETTE.ark;
    c.fillRect(1, 6, 14, 3);
    c.fillRect(3, 9, 10, 3);
    px(c, 2, 3, 2, 6, '#7a4a1e');
    px(c, 12, 3, 2, 6, '#7a4a1e');
    px(c, 7, 1, 2, 6, '#7a4a1e');
  },

  [Tile.DungeonEntrance]: (c) => {
    base(c, PALETTE.rock);
    px(c, 1, 2, 14, 13, PALETTE.rockShade);
    c.fillStyle = PALETTE.dungeon;
    c.fillRect(5, 6, 6, 9);
    c.fillRect(4, 8, 8, 7);
    px(c, 1, 2, 14, 2, '#8a8276');
  },

  [Tile.HeartContainer]: (c) => {
    base(c, PALETTE.grass);
    c.fillStyle = PALETTE.heart;
    c.fillRect(3, 4, 4, 4);
    c.fillRect(9, 4, 4, 4);
    c.fillRect(3, 6, 10, 4);
    c.fillRect(5, 10, 6, 2);
    c.fillRect(7, 12, 2, 2);
    px(c, 4, 5, 2, 2, '#f07a7a');
  },

  // -- dungeon terrain ------------------------------------------------------
  [Tile.DungeonFloor]: (c) => {
    base(c, PALETTE.dungeonFloor);
    px(c, 0, 0, TILE_PX, 1, '#44404d');
    px(c, 0, 8, TILE_PX, 1, '#322f3a');
    px(c, 8, 0, 1, 8, '#322f3a');
    px(c, 4, 8, 1, 8, '#322f3a');
  },

  [Tile.DungeonWall]: (c) => {
    base(c, PALETTE.dungeonWall);
    px(c, 0, 0, TILE_PX, 4, PALETTE.dungeonWallTop);
    px(c, 0, 4, TILE_PX, 1, '#15131a');
    px(c, 5, 5, 2, 11, '#1b1922');
    px(c, 11, 5, 2, 11, '#1b1922');
  },

  [Tile.Stairs]: (c) => {
    base(c, PALETTE.dungeonFloor);
    c.fillStyle = PALETTE.stairs;
    for (let i = 0; i < 4; i++) c.fillRect(2 + i, 3 + i * 3, 12 - i * 2, 2);
    px(c, 2, 14, 12, 2, '#5d5474');
  },

  [Tile.Bridge]: (c) => {
    base(c, PALETTE.chasm);
    c.fillStyle = PALETTE.bridge;
    for (let y = 1; y < TILE_PX; y += 4) c.fillRect(0, y, TILE_PX, 3);
    px(c, 1, 0, 2, TILE_PX, '#7a5230');
    px(c, 13, 0, 2, TILE_PX, '#7a5230');
  },

  [Tile.Rope]: (c) => {
    base(c, PALETTE.ledge);
    c.fillStyle = PALETTE.rope;
    c.fillRect(0, 6, TILE_PX, 2);
    c.fillRect(0, 10, TILE_PX, 2);
    for (let x = 1; x < TILE_PX; x += 4) px(c, x, 5, 2, 8, '#a8875a');
  },

  [Tile.DoorOpen]: (c) => {
    base(c, PALETTE.dungeonWall);
    px(c, 3, 0, 10, TILE_PX, PALETTE.doorOpen);
    px(c, 3, 0, 2, TILE_PX, '#4a4653');
    px(c, 11, 0, 2, TILE_PX, '#4a4653');
  },

  // -- dungeon obstacles ----------------------------------------------------
  [Tile.Chasm]: (c) => {
    base(c, PALETTE.chasm);
    px(c, 0, 0, TILE_PX, 2, '#2a2733');
    px(c, 0, 14, TILE_PX, 2, '#2a2733');
    specks(c, '#1a1826', SPARSE);
  },

  [Tile.Ledge]: (c) => {
    base(c, PALETTE.ledge);
    px(c, 0, 0, TILE_PX, 3, '#6d5a46');
    px(c, 0, 6, TILE_PX, 2, '#3f342a');
    px(c, 0, 12, TILE_PX, 2, '#3f342a');
  },

  [Tile.DoorLocked]: (c) => {
    base(c, PALETTE.dungeonWall);
    px(c, 2, 0, 12, TILE_PX, PALETTE.doorLocked);
    px(c, 2, 0, 12, 2, '#8f6f1e');
    c.fillStyle = '#3a2e0c';
    c.fillRect(7, 7, 3, 3);
    c.fillRect(8, 9, 1, 3);
  },

  [Tile.Pit]: (c) => {
    base(c, PALETTE.dungeonFloor);
    c.fillStyle = PALETTE.pit;
    c.fillRect(3, 4, 10, 9);
    c.fillRect(2, 6, 12, 5);
    px(c, 3, 3, 10, 1, '#514c5e');
  },

  // -- dungeon pickups ------------------------------------------------------
  [Tile.Key]: (c) => {
    base(c, PALETTE.dungeonFloor);
    c.fillStyle = PALETTE.key;
    c.fillRect(4, 4, 5, 5);
    c.fillRect(8, 6, 5, 2);
    c.fillRect(11, 8, 2, 2);
    px(c, 5, 5, 2, 2, PALETTE.dungeonFloor);
  },

  [Tile.Chest]: (c) => {
    base(c, PALETTE.dungeonFloor);
    c.fillStyle = PALETTE.chest;
    c.fillRect(2, 5, 12, 9);
    px(c, 2, 5, 12, 3, '#e0a94a');
    px(c, 2, 8, 12, 1, '#7a5220');
    px(c, 7, 8, 2, 4, '#3a2610');
  },

  [Tile.TownDoor]: (c) => {
    base(c, PALETTE.dirt);
    px(c, 1, 4, 14, 11, PALETTE.town);
    px(c, 0, 2, TILE_PX, 3, '#8a4a20');
    px(c, 6, 8, 4, 7, '#3a2412');
    px(c, 3, 6, 3, 3, '#e8d9a0');
    px(c, 10, 6, 3, 3, '#e8d9a0');
  },
};
