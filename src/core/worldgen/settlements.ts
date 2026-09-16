/**
 * Settlements: the tent city, the logging town, the stone city, and a few
 * mountain hamlets. Placed on buildable ground near water, which is where
 * people actually settle — and that alone makes their locations feel reasoned.
 *
 * Shrines sit relative to town (a real bearing, on a footpath). Valley
 * livestock get a fenced pasture. The slipway is a carpenter's yard in town.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { randInt, stageRng, type Rng } from '../rng.js';
import { Biome, Tile } from '../tiles.js';
import {
  SettlementKind,
  type Point,
  type Settlement,
} from '../world.js';
import { UNPLANNED, overwrite, stamp } from './plan.js';
import { isWorldRim, onPanelEdge } from './seams.js';

export interface SettlementPass {
  settlements: Settlement[];
  pastures: number[];
}

export function placeSettlements(
  seed: number,
  params: WorldParams,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
): SettlementPass {
  const w = tileWidth(params);
  const h = tileHeight(params);
  const rng = stageRng(seed, 'settlements');
  const water = waterDistance(plan, w, h);
  const scale = params.panelsX / 12;

  const settlements: Settlement[] = [];
  const pastures: number[] = [];

  const tent = placeTown(
    rng,
    biome,
    plan,
    water,
    w,
    h,
    Biome.Valley,
    SettlementKind.TentCity,
    Math.max(7, Math.round(12 * scale)),
    Math.max(5, Math.round(8 * scale)),
    settlements,
  );
  if (tent) {
    stampPasture(rng, plan, pastures, w, h, tent.x + Math.max(5, tentRx(scale) + 1), tent.y, scale);
    const shrine = stampShrine(
      rng,
      plan,
      elev,
      w,
      h,
      tent.x + Math.max(6, Math.round(10 * scale)),
      tent.y + Math.max(4, Math.round(6 * scale)),
      'tent',
    );
    tent.shrine = shrine;
    stampDockNear(plan, w, h, tent.x, tent.y, 14);
  }

  const mill = placeTown(
    rng,
    biome,
    plan,
    water,
    w,
    h,
    Biome.Forest,
    SettlementKind.LoggingTown,
    Math.max(6, Math.round(11 * scale)),
    Math.max(5, Math.round(7 * scale)),
    settlements,
  );
  if (mill) {
    const shrine = stampShrine(
      rng,
      plan,
      elev,
      w,
      h,
      mill.x + Math.max(7, Math.round(12 * scale)),
      mill.y,
      'grove',
    );
    mill.shrine = shrine;
    stampDockNear(plan, w, h, mill.x, mill.y, 12);
  }

  const city = placeTown(
    rng,
    biome,
    plan,
    water,
    w,
    h,
    Biome.Scrub,
    SettlementKind.City,
    Math.max(8, Math.round(16 * scale)),
    Math.max(6, Math.round(11 * scale)),
    settlements,
  );
  if (city) {
    const shrine = stampShrine(rng, plan, elev, w, h, city.x, city.y - 2, 'cathedral');
    city.shrine = shrine;
    stampDockNear(plan, w, h, city.x, city.y, 16);
  }

  const hamlet = placeHamlets(rng, elev, biome, plan, w, h, scale);
  if (hamlet) settlements.push(hamlet);

  return { settlements, pastures };
}

function tentRx(scale: number): number {
  return Math.max(7, Math.round(12 * scale));
}

function placeTown(
  rng: Rng,
  biome: Uint8Array,
  plan: Uint8Array,
  water: Uint16Array,
  w: number,
  h: number,
  want: Biome,
  kind: SettlementKind,
  rx: number,
  ry: number,
  existing: Settlement[],
): Settlement | null {
  const site = pickSite(rng, biome, plan, water, w, h, want, existing, rx);
  if (site < 0) return null;
  const cx = site % w;
  const cy = (site / w) | 0;
  stampTown(rng, plan, w, h, cx, cy, rx, ry, kind);
  const town: Settlement = {
    kind,
    biome: want,
    x: cx,
    y: cy,
    shrine: null,
  };
  existing.push(town);
  return town;
}

function pickSite(
  rng: Rng,
  biome: Uint8Array,
  plan: Uint8Array,
  water: Uint16Array,
  w: number,
  h: number,
  want: Biome,
  existing: readonly Settlement[],
  radius: number,
): number {
  let best = -1;
  let bestScore = -Infinity;
  const margin = Math.max(6, radius);
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      if (biome[i] !== want) continue;
      if (isWorldRim(x, y, w, h) || onPanelEdge(x, y)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) continue;
      let blocked = false;
      for (const s of existing) {
        const dx = s.x - x;
        const dy = s.y - y;
        if (dx * dx + dy * dy < 24 * 24) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const nearWater = water[i] < 0xffff ? Math.max(0, 36 - water[i]) : 0;
      const score = nearWater * 3 + rng() * 4 - Math.abs(x - w / 2) * 0.04;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}

function stampTown(
  rng: Rng,
  plan: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  kind: SettlementKind,
): void {
  const building =
    kind === SettlementKind.TentCity
      ? Tile.Tent
      : kind === SettlementKind.City
        ? Tile.StoneWall
        : Tile.House;
  const floor = kind === SettlementKind.City ? Tile.Road : Tile.Path;
  const plaza = kind === SettlementKind.City ? Tile.StoneGround : Tile.Dirt;

  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const u = dx / rx;
      const v = dy / ry;
      if (u * u + v * v > 1.05) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 3) continue;
      if (onPanelEdge(x, y)) continue;
      const i = y * w + x;
      if (plan[i] === Tile.Water || plan[i] === Tile.Cliff || plan[i] === Tile.Bridge) continue;

      const edge = u * u + v * v > 0.82;
      if (kind === SettlementKind.City && (dx % 4 === 0 || dy % 4 === 0)) {
        stamp(plan, i, Tile.Road);
        continue;
      }
      if (edge && rng() < 0.35 && kind !== SettlementKind.City) {
        stamp(plan, i, building);
        continue;
      }
      if (!edge && rng() < (kind === SettlementKind.City ? 0.16 : 0.2)) {
        stamp(plan, i, building);
        continue;
      }
      stamp(plan, i, Math.abs(dx) + Math.abs(dy) < 2 ? plaza : floor);
    }
  }
  overwrite(plan, cy * w + cx, Tile.TownDoor);
}

function stampPasture(
  rng: Rng,
  plan: Uint8Array,
  pastures: number[],
  w: number,
  h: number,
  cx: number,
  cy: number,
  scale: number,
): void {
  const rx = Math.max(4, Math.round(6 * scale));
  const ry = Math.max(3, Math.round(4 * scale));
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 3) continue;
      if (onPanelEdge(x, y)) continue;
      const i = y * w + x;
      if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) continue;
      const edge = Math.abs(dx) === rx || Math.abs(dy) === ry;
      const gate = edge && dy === ry && Math.abs(dx) <= 1;
      if (gate) {
        stamp(plan, i, Tile.Path);
        pastures.push(i);
        continue;
      }
      if (edge) {
        stamp(plan, i, Tile.Fence);
        continue;
      }
      if (plan[i] === UNPLANNED || plan[i] === Tile.Path || plan[i] === Tile.Dirt) {
        overwrite(plan, i, Tile.Grass);
        pastures.push(i);
      }
    }
  }
  void rng;
}

/**
 * Shrines stand on the high ground near their town.
 *
 * Not decoration: the Rod harvests nothing but fiber until the valley shrine
 * says otherwise, so that shrine is the first gate in the game — and the
 * valley is, by design, the first ground to go under. Sited on flat valley
 * floor it drowned on a median of day 6, taking the whole Rod ladder and the
 * run with it, before a player could realistically afford its price.
 *
 * Searching the neighbourhood for the highest walkable ground fixes that
 * without moving a single town, and it is what people actually do with
 * temples.
 */
function stampShrine(
  rng: Rng,
  plan: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  style: 'tent' | 'grove' | 'cathedral' | 'cairn',
): Point | null {
  const high = highestNear(plan, elev, w, h, clamp(x, 4, w - 5), clamp(y, 4, h - 5));
  x = high.x;
  y = high.y;
  if (onPanelEdge(x, y)) {
    x += 1;
    y += 1;
  }
  const i = y * w + x;
  if (isWorldRim(x, y, w, h)) return null;
  overwrite(plan, i, Tile.Shrine);

  const ring = style === 'cathedral' ? Tile.StoneWall : style === 'grove' ? Tile.Tree : style === 'cairn' ? Tile.Rock : Tile.Tent;
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (onPanelEdge(nx, ny) || isWorldRim(nx, ny, w, h)) continue;
    if (style === 'grove' && rng() < 0.25) continue;
    stamp(plan, ny * w + nx, ring);
  }
  // Always leave a walkable approach so a road can reach the door.
  const south = (y + 1) * w + x;
  if (y + 1 < h - 2 && !isWorldRim(x, y + 1, w, h) && !onPanelEdge(x, y + 1)) {
    overwrite(plan, south, style === 'cathedral' ? Tile.Road : Tile.Path);
  }
  if (style === 'tent') stamp(plan, y * w + x - 1, Tile.Path);
  return { x, y };
}

/**
 * The highest buildable tile within `SHRINE_SEARCH` of a point.
 *
 * Elevation is the flood clock, so "highest nearby" is the same as "lasts
 * longest" — a shrine gains days of life for nothing but a local search.
 */
function highestNear(
  plan: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
): Point {
  let best = { x: cx, y: cy };
  let bestElev = -1;
  for (let dy = -SHRINE_SEARCH; dy <= SHRINE_SEARCH; dy++) {
    for (let dx = -SHRINE_SEARCH; dx <= SHRINE_SEARCH; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 4 || y < 4 || x >= w - 4 || y >= h - 5) continue;
      if (isWorldRim(x, y, w, h) || onPanelEdge(x, y)) continue;
      const i = y * w + x;
      const t = plan[i];
      if (t === Tile.Water || t === Tile.Gorge || t === Tile.Cliff || t === Tile.Bridge) continue;
      if (t === Tile.TownDoor || t === Tile.ArkSite || t === Tile.Shrine) continue;
      if (elev[i] > bestElev) {
        bestElev = elev[i];
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * How far a shrine may be moved to find high ground.
 *
 * About a panel: far enough to climb out of a valley floor, near enough that
 * "we worship south-east of town" is still true.
 */
const SHRINE_SEARCH = 9;

function stampDockNear(plan: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number): void {
  let best = -1;
  let bestD = Infinity;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 3) continue;
      if (onPanelEdge(x, y)) continue;
      const i = y * w + x;
      if (plan[i] !== UNPLANNED && plan[i] !== Tile.Path && plan[i] !== Tile.Road && plan[i] !== Tile.Dirt) {
        continue;
      }
      if (!touches(plan, w, h, x, y, Tile.Water)) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  if (best >= 0) overwrite(plan, best, Tile.BoatYard);
}

function placeHamlets(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
  scale: number,
): Settlement | null {
  const count = Math.max(2, Math.round(4 * scale));
  const houses: Point[] = [];
  for (let n = 0; n < count * 6 && houses.length < count; n++) {
    const x = randInt(rng, 6, w - 7);
    const y = randInt(rng, 4, Math.max(6, (h / 3) | 0));
    const i = y * w + x;
    if (biome[i] !== Biome.Mountain) continue;
    if (onPanelEdge(x, y) || isWorldRim(x, y, w, h)) continue;
    if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) continue;
    let far = true;
    for (const p of houses) {
      if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < 12 * 12) far = false;
    }
    if (!far) continue;
    stamp(plan, i, Tile.House);
    // The door faces south and the path runs out from it, so a mountain
    // dwelling is approached rather than bumped into — and the track leaves a
    // gap between the house and whatever road passes by.
    const doorstep = (y + 1) * w + x;
    if (y + 1 < h - 2) stamp(plan, doorstep, Tile.Path);
    houses.push({ x, y });
  }
  if (houses.length === 0) return null;
  const shrine = stampShrine(rng, plan, elev, w, h, houses[0].x + 4, houses[0].y - 3, 'cairn');
  return {
    kind: SettlementKind.Hamlet,
    biome: Biome.Mountain,
    x: houses[0].x,
    y: houses[0].y,
    shrine,
  };
}

function waterDistance(plan: Uint8Array, w: number, h: number): Uint16Array {
  const dist = new Uint16Array(w * h);
  dist.fill(0xffff);
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < plan.length; i++) {
    if (plan[i] !== Tile.Water) continue;
    dist[i] = 0;
    q[tail++] = i;
  }
  while (head < tail) {
    const i = q[head++];
    const x = i % w;
    const y = (i / w) | 0;
    const nd = dist[i] + 1;
    const n4 = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of n4) {
      if (j < 0 || nd >= dist[j]) continue;
      dist[j] = nd;
      q[tail++] = j;
    }
  }
  return dist;
}

function touches(plan: Uint8Array, w: number, h: number, x: number, y: number, tile: number): boolean {
  const n4 = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of n4) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (plan[ny * w + nx] === tile) return true;
  }
  return false;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
