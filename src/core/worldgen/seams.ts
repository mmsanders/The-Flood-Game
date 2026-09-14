/**
 * Panel seams.
 *
 * A Zelda screen cannot show the first column of the next panel, so a tree
 * sitting just over the boundary is an invisible wall. After paint, every
 * scenery blocker on a seam gets a counterpart on the other side; connectivity
 * carves those pairs together so a path that crosses a boundary is open on
 * both screens.
 */

import { PANEL_H, PANEL_W, type WorldParams, tileHeight, tileWidth } from '../config.js';
import { Biome, Tile, carveTo, isResourceNode } from '../tiles.js';

/** True on the first or last row/column of any panel, including the map rim. */
export function onPanelEdge(x: number, y: number): boolean {
  const tx = x % PANEL_W;
  const ty = y % PANEL_H;
  return tx === 0 || tx === PANEL_W - 1 || ty === 0 || ty === PANEL_H - 1;
}

/** The one-tile frame around the overworld. There is no panel beyond it. */
export function isWorldRim(x: number, y: number, w: number, h: number): boolean {
  return x === 0 || y === 0 || x === w - 1 || y === h - 1;
}

/** Overworld scenery that blocks movement and must be visible to explain it. */
export function isSeamBlocker(tile: number): boolean {
  return (
    tile === Tile.Tree ||
    tile === Tile.Shrub ||
    tile === Tile.Rock ||
    tile === Tile.Cliff ||
    tile === Tile.Water
  );
}

/**
 * Tiles across a panel boundary from `i`. A corner sits on two seams and
 * returns both neighbours.
 */
export function seamPartnerIndices(i: number, w: number, h: number): number[] {
  const x = i % w;
  const y = (i / w) | 0;
  const out: number[] = [];
  const tx = x % PANEL_W;
  const ty = y % PANEL_H;
  if (tx === 0 && x > 0) out.push(i - 1);
  if (tx === PANEL_W - 1 && x + 1 < w) out.push(i + 1);
  if (ty === 0 && y > 0) out.push(i - w);
  if (ty === PANEL_H - 1 && y + 1 < h) out.push(i + w);
  return out;
}

/**
 * If one side of a seam is scenery-blocking, the other side becomes blocking
 * too, in a tile that belongs to its own biome. Openings are left open.
 */
export function sealPanelSeams(
  tiles: Uint8Array,
  biome: Uint8Array,
  elev: Uint8Array,
  params: WorldParams,
): void {
  const w = tileWidth(params);
  const h = tileHeight(params);

  // A counterpart on one seam is a new blocker on the perpendicular seam at
  // panel corners, so one pass is not a fixed point. Spread is local to the
  // 2x2 at each corner; a handful of rounds is enough.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let px = 1; px < params.panelsX; px++) {
      const xR = px * PANEL_W;
      const xL = xR - 1;
      for (let y = 0; y < h; y++) {
        if (matchPair(tiles, biome, elev, y * w + xL, y * w + xR)) changed = true;
      }
    }
    for (let py = 1; py < params.panelsY; py++) {
      const yB = py * PANEL_H;
      const yT = yB - 1;
      for (let x = 0; x < w; x++) {
        if (matchPair(tiles, biome, elev, yT * w + x, yB * w + x)) changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * A solid frame of scenery so walking south, east, north or west until the
 * map stops is a wall you can see, not an invisible bounce.
 *
 * Biome picks the tile: trees in forest, rock in the lowlands and scrub,
 * cliff in the mountains. Connectivity is told not to carve these.
 */
export function wallWorldRim(
  tiles: Uint8Array,
  biome: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): void {
  const paint = (x: number, y: number): void => {
    const i = y * w + x;
    tiles[i] = rimTile(biome[i] as Biome, elev[i]);
  };
  for (let x = 0; x < w; x++) {
    paint(x, 0);
    paint(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    paint(0, y);
    paint(w - 1, y);
  }
}

function rimTile(biome: Biome, elev: number): Tile {
  switch (biome) {
    case Biome.Valley:
      return Tile.Rock;
    case Biome.Forest:
      return Tile.Tree;
    case Biome.Scrub:
      return Tile.Rock;
    case Biome.Mountain:
      return elev > 240 ? Tile.Cliff : Tile.Rock;
  }
}

/**
 * After connectivity has carved, any leftover one-sided blocker is an
 * invisible wall. Prefer the opening: carve the blocker rather than close
 * the path that just got cut.
 */
export function openSeamMismatches(
  tiles: Uint8Array,
  biome: Uint8Array,
  params: WorldParams,
): number {
  const w = tileWidth(params);
  const h = tileHeight(params);
  let carved = 0;

  const relax = (a: number, b: number): boolean => {
    const aBlock = isSeamBlocker(tiles[a]);
    const bBlock = isSeamBlocker(tiles[b]);
    if (aBlock === bBlock) return false;
    if (aBlock && !isWorldRim(a % w, (a / w) | 0, w, h)) {
      tiles[a] = carveTo(biome[a] as Biome);
      carved++;
    }
    if (bBlock && !isWorldRim(b % w, (b / w) | 0, w, h)) {
      tiles[b] = carveTo(biome[b] as Biome);
      carved++;
    }
    return true;
  };

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let px = 1; px < params.panelsX; px++) {
      const xR = px * PANEL_W;
      const xL = xR - 1;
      for (let y = 0; y < h; y++) {
        if (relax(y * w + xL, y * w + xR)) changed = true;
      }
    }
    for (let py = 1; py < params.panelsY; py++) {
      const yB = py * PANEL_H;
      const yT = yB - 1;
      for (let x = 0; x < w; x++) {
        if (relax(yT * w + x, yB * w + x)) changed = true;
      }
    }
    if (!changed) break;
  }
  return carved;
}

function matchPair(
  tiles: Uint8Array,
  biome: Uint8Array,
  elev: Uint8Array,
  a: number,
  b: number,
): boolean {
  const aBlock = isSeamBlocker(tiles[a]);
  const bBlock = isSeamBlocker(tiles[b]);
  if (aBlock === bBlock) return false;
  if (aBlock) return placeCounterpart(tiles, biome, elev, b, tiles[a]);
  return placeCounterpart(tiles, biome, elev, a, tiles[b]);
}

function placeCounterpart(
  tiles: Uint8Array,
  biome: Uint8Array,
  elev: Uint8Array,
  i: number,
  source: number,
): boolean {
  // Resources are kept off edges; never bury a node to match a tree.
  if (isResourceNode(tiles[i])) return false;
  const next = counterpartTile(biome[i] as Biome, elev[i], source);
  if (tiles[i] === next) return false;
  tiles[i] = next;
  return true;
}

function counterpartTile(biome: Biome, elev: number, source: number): Tile {
  if (source === Tile.Water || source === Tile.Cliff) return source;
  switch (biome) {
    case Biome.Valley:
      return Tile.Shrub;
    case Biome.Forest:
      return Tile.Tree;
    case Biome.Scrub:
      return Tile.Rock;
    case Biome.Mountain:
      return elev > 240 ? Tile.Cliff : Tile.Rock;
  }
}
