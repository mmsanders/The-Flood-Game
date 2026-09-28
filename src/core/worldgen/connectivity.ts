/**
 * Connectivity repair.
 *
 * A procedurally generated overworld that quietly walls off a quarter of its
 * panels is the most common way this kind of game ships broken, so this is an
 * explicit repair pass with a hard invariant behind it: after `ensureConnected`,
 * every walkable tile is reachable from every other, and every panel contains
 * walkable ground.
 */

import { PANEL_H, PANEL_W, type WorldParams, tileHeight, tileWidth } from '../config.js';
import { Biome, Tile, carveOpening, isResourceNode, isWalkable } from '../tiles.js';
import { isWorldRim, openSeamMismatches, seamPartnerIndices } from './seams.js';

/** Cost to cut a path through a tile. 0 means it is already walkable. */
const MAX_COST = 5;

function enterCost(tile: number): number {
  if (isWalkable(tile)) return 0;
  if (isResourceNode(tile)) return 2; // carving destroys a node; prefer to route around
  switch (tile) {
    case Tile.Tree:
    case Tile.Shrub:
    case Tile.Rock:
      return 1;
    case Tile.Fence:
    case Tile.Tent:
    case Tile.House:
    case Tile.StoneWall:
      return 2;
    case Tile.Water:
      return 3; // a causeway across a pond, or a ford across the river
    case Tile.Cliff:
      return MAX_COST; // a mountain pass: expensive, but never impossible
    case Tile.Gorge:
      return 20; // use a planned bridge; do not punch extra fords
    default:
      return 1;
  }
}

export interface ConnectivityResult {
  /** Regions found before repair. 1 means the map was already connected. */
  regionsBefore: number;
  tilesCarved: number;
  /** Verified after repair by re-labelling. */
  connected: boolean;
}

export function ensureConnected(
  tiles: Uint8Array,
  biome: Uint8Array,
  params: WorldParams,
): ConnectivityResult {
  const w = tileWidth(params);
  const h = tileHeight(params);

  let tilesCarved = openBlockedPanels(tiles, biome, params, w, h);

  const { labels, sizes } = labelRegions(tiles, w, h);
  const regionsBefore = sizes.length;

  if (regionsBefore <= 1) {
    return { regionsBefore, tilesCarved, connected: true };
  }

  // Largest region is the mainland; everything else gets cut through to it.
  let main = 0;
  for (let r = 1; r < sizes.length; r++) {
    if (sizes[r] > sizes[main]) main = r;
  }

  const { dist, prev } = dijkstraFromRegion(tiles, labels, main, w, h);

  // Cheapest entry point per stranded region.
  const bestTile = new Int32Array(sizes.length).fill(-1);
  const bestDist = new Float64Array(sizes.length).fill(Infinity);

  for (let i = 0; i < labels.length; i++) {
    const r = labels[i];
    if (r < 0 || r === main) continue;
    if (dist[i] < bestDist[r]) {
      bestDist[r] = dist[i];
      bestTile[r] = i;
    }
  }

  // Walk each stranded region back along its cheapest route, carving as we go.
  for (let r = 0; r < sizes.length; r++) {
    if (r === main || bestTile[r] < 0) continue;
    let cur = bestTile[r];
    let guard = w * h;
    while (cur >= 0 && labels[cur] !== main && guard-- > 0) {
      tilesCarved += carveWithSeams(tiles, biome, cur, w, h);
      cur = prev[cur];
    }
  }

  tilesCarved += openSeamMismatches(tiles, biome, params);

  const after = labelRegions(tiles, w, h);
  return { regionsBefore, tilesCarved, connected: after.sizes.length <= 1 };
}

/**
 * Carve a tile and any panel-seam partners. A path that crosses a boundary
 * has to be open on the screen you are leaving *and* the one you are entering.
 */
function carveWithSeams(
  tiles: Uint8Array,
  biome: Uint8Array,
  i: number,
  w: number,
  h: number,
): number {
  let carved = 0;
  const nodes = [i, ...seamPartnerIndices(i, w, h)];
  for (const j of nodes) {
    if (isWorldRim(j % w, (j / w) | 0, w, h)) continue;
    if (!isWalkable(tiles[j])) {
      tiles[j] = carveOpening(tiles[j], biome[j] as Biome);
      carved++;
    }
  }
  return carved;
}

/** Guarantee every panel has ground to stand on before we join regions up. */
function openBlockedPanels(
  tiles: Uint8Array,
  biome: Uint8Array,
  params: WorldParams,
  w: number,
  h: number,
): number {
  let carved = 0;

  for (let py = 0; py < params.panelsY; py++) {
    for (let px = 0; px < params.panelsX; px++) {
      let walkable = 0;
      for (let ty = 0; ty < PANEL_H && walkable < 4; ty++) {
        for (let tx = 0; tx < PANEL_W && walkable < 4; tx++) {
          if (isWalkable(tiles[(py * PANEL_H + ty) * w + (px * PANEL_W + tx)])) walkable++;
        }
      }
      if (walkable >= 4) continue;

      // Clear a small plaza at the panel centre.
      const cx = px * PANEL_W + (PANEL_W >> 1);
      const cy = py * PANEL_H + (PANEL_H >> 1);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (cy + dy) * w + (cx + dx);
          if (i < 0 || i >= tiles.length) continue;
          if (!isWalkable(tiles[i])) {
            carved += carveWithSeams(tiles, biome, i, w, h);
          }
        }
      }
    }
  }

  return carved;
}

export interface RegionLabels {
  /** Region index per tile, or -1 for non-walkable tiles. */
  labels: Int32Array;
  /** Tile count per region. */
  sizes: number[];
}

/** 4-connected flood fill over walkable tiles. */
export function labelRegions(tiles: Uint8Array, w: number, h: number): RegionLabels {
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || !isWalkable(tiles[start])) continue;

    const region = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = region;

    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i / w) | 0;

      if (x > 0 && labels[i - 1] === -1 && isWalkable(tiles[i - 1])) {
        labels[i - 1] = region;
        queue[tail++] = i - 1;
      }
      if (x < w - 1 && labels[i + 1] === -1 && isWalkable(tiles[i + 1])) {
        labels[i + 1] = region;
        queue[tail++] = i + 1;
      }
      if (y > 0 && labels[i - w] === -1 && isWalkable(tiles[i - w])) {
        labels[i - w] = region;
        queue[tail++] = i - w;
      }
      if (y < h - 1 && labels[i + w] === -1 && isWalkable(tiles[i + w])) {
        labels[i + w] = region;
        queue[tail++] = i + w;
      }
    }

    sizes.push(tail);
  }

  return { labels, sizes };
}

/**
 * Multi-source Dijkstra seeded from every mainland tile at once, so a single
 * pass yields the cheapest route from anywhere on the map back to the
 * mainland. Edge costs are small integers, so Dial's bucket queue beats a heap.
 */
function dijkstraFromRegion(
  tiles: Uint8Array,
  labels: Int32Array,
  main: number,
  w: number,
  h: number,
): { dist: Float64Array; prev: Int32Array } {
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);

  const nBuckets = MAX_COST + 1;
  const buckets: number[][] = Array.from({ length: nBuckets }, () => []);

  let seeded = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] === main) {
      dist[i] = 0;
      buckets[0].push(i);
      seeded++;
    }
  }
  if (seeded === 0) return { dist, prev };

  let base = 0;
  let scanned = 0;

  while (scanned <= MAX_COST) {
    const bucket = buckets[base % nBuckets];
    if (bucket.length === 0) {
      base++;
      scanned++;
      continue;
    }
    scanned = 0;

    const i = bucket.pop() as number;
    if (done[i]) continue;
    done[i] = 1;

    const d = dist[i];
    const x = i % w;
    const y = (i / w) | 0;

    if (x > 0) relax(i, i - 1, d);
    if (x < w - 1) relax(i, i + 1, d);
    if (y > 0) relax(i, i - w, d);
    if (y < h - 1) relax(i, i + w, d);
  }

  return { dist, prev };

  function relax(from: number, to: number, d: number): void {
    if (done[to]) return;
    // The world rim is a visible wall, not a corridor. Never route through it.
    if (isWorldRim(to % w, (to / w) | 0, w, h)) return;
    const nd = d + enterCost(tiles[to]);
    if (nd < dist[to]) {
      dist[to] = nd;
      prev[to] = from;
      buckets[nd % nBuckets].push(to);
    }
  }
}
