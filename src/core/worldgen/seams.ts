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
import { Biome, Tile, carveOpening, carveTo, isCarvable, isResourceNode } from '../tiles.js';

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
    tile === Tile.Water ||
    tile === Tile.Fence ||
    tile === Tile.Tent ||
    tile === Tile.House ||
    tile === Tile.StoneWall
  );
}

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

export function sealPanelSeams(
  tiles: Uint8Array,
  biome: Uint8Array,
  elev: Uint8Array,
  params: WorldParams,
): void {
  const w = tileWidth(params);
  const h = tileHeight(params);

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

export function wallWorldRim(
  tiles: Uint8Array,
  biome: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): void {
  const paint = (x: number, y: number, tile?: Tile): void => {
    const i = y * w + x;
    tiles[i] = tile ?? rimTile(biome[i] as Biome, elev[i]);
  };
  for (let x = 0; x < w; x++) {
    paint(x, 0);
    paint(x, h - 1, Tile.Water);
  }
  for (let y = 1; y < h - 1; y++) {
    paint(0, y);
    paint(w - 1, y);
  }
  paintSouthBeach(tiles, w, h);
}

export function paintSouthBeach(tiles: Uint8Array, w: number, h: number): void {
  if (h < 3) return;
  for (let x = 1; x < w - 1; x++) {
    const i = (h - 2) * w + x;
    const north = tiles[(h - 3) * w + x];
    if (north === Tile.Water) tiles[i] = Tile.Water;
    else if (north === Tile.Bridge) tiles[i] = Tile.Bridge;
    else tiles[i] = Tile.Sand;
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
      tiles[a] = carveOpening(tiles[a], biome[a] as Biome);
      carved++;
    }
    if (bBlock && !isWorldRim(b % w, (b / w) | 0, w, h)) {
      tiles[b] = carveOpening(tiles[b], biome[b] as Biome);
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
  if (isResourceNode(tiles[i]) || isPlannedKeep(tiles[i])) return false;
  const next = counterpartTile(biome[i] as Biome, elev[i], source);
  if (tiles[i] === next) return false;
  tiles[i] = next;
  return true;
}

function isPlannedKeep(tile: number): boolean {
  return (
    tile === Tile.Path ||
    tile === Tile.Road ||
    tile === Tile.Steps ||
    tile === Tile.Bridge ||
    tile === Tile.ArkSite ||
    tile === Tile.DungeonEntrance ||
    tile === Tile.HeartContainer ||
    tile === Tile.TownDoor ||
    tile === Tile.BoatYard ||
    tile === Tile.CampTent ||
    tile === Tile.Shrine
  );
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

/**
 * Open the ground immediately around every stair, including east and west
 * so biome-seam stairs can be approached sideways.
 */
export function clearStairApproaches(
  tiles: Uint8Array,
  biome: Uint8Array,
  w: number,
  h: number,
): number {
  let opened = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.Steps) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const neighbors = [
      [x, y - 1],
      [x, y + 1],
      [x - 1, y],
      [x + 1, y],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isWorldRim(nx, ny, w, h)) continue;
      const j = ny * w + nx;
      if (!isScatter(tiles[j])) continue;

      const group = seamGroup(tiles, w, h, j);
      if (!group) continue;
      for (const k of group) {
        tiles[k] = carveTo(biome[k] as Biome);
        opened++;
      }
    }
  }
  return opened;
}

function seamGroup(
  tiles: Uint8Array,
  w: number,
  h: number,
  start: number,
): number[] | null {
  const group: number[] = [start];
  for (let n = 0; n < group.length; n++) {
    if (!isScatter(tiles[group[n]])) return null;
    for (const k of seamPartnerIndices(group[n], w, h)) {
      if (!group.includes(k)) group.push(k);
    }
  }
  return group;
}

function isScatter(tile: number): boolean {
  return isCarvable(tile) || isResourceNode(tile);
}
