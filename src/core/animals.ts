/**
 * Noah's flock: ten biblical kinds, two of each, wandering their biomes.
 *
 * Collecting them is a high-score, not a win condition — the ark still launches
 * on timber and pitch. The water does not wait for stragglers.
 */

import { TILE_PX } from './config.js';
import type { TileMap } from './tilemap.js';
import { Biome, Tile, isWalkable } from './tiles.js';
import { type Homestead, HomesteadState, type Point, type TileRect } from './world.js';
import { mulberry32, stageRng, type Rng } from './rng.js';

export const enum AnimalKind {
  Sheep = 0,
  Goat = 1,
  Lion = 2,
  Bear = 3,
  Snake = 4,
  Dove = 5,
  Donkey = 6,
  Camel = 7,
  Ox = 8,
  Raven = 9,
}

export const ANIMAL_COUNT = 10;
export const ANIMALS_PER_KIND = 2;
export const FLOCK_TOTAL = ANIMAL_COUNT * ANIMALS_PER_KIND;

export const enum AnimalStatus {
  Wild = 0,
  Boarded = 1,
  Drowned = 2,
  /** On Noah's rope, following him in a string. */
  Led = 3,
  /** Tied where he left it. Still drowns if the water reaches it. */
  Tethered = 4,
}

/** Same numbering as the player facing enum, so rendering can share a switch. */
export const enum AnimalDir {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}

export const ANIMAL_W = 10;
export const ANIMAL_H = 8;

export interface AnimalDef {
  kind: AnimalKind;
  name: string;
  plural: string;
  biome: Biome;
  /** Tiles per second while wandering. */
  speed: number;
  /** How readily they bolt when the player draws near, 0..1. */
  skittish: number;
  /** Keeps away from people. The rest are kept by them, or live alongside. */
  wild: boolean;
  fill: string;
  shade: string;
  accent: string;
}

/**
 * Ten kinds the Torah actually names. Biome is the landscape that reads as
 * their home, not a spreadsheet split — valley pasture, forest wood, scrub
 * wilderness, high mountain.
 */
export const ANIMAL_DEFS: readonly AnimalDef[] = [
  {
    kind: AnimalKind.Sheep,
    name: 'sheep',
    plural: 'sheep',
    biome: Biome.Valley,
    speed: 1.4,
    skittish: 0.55,
    wild: false,
    fill: '#e8e0d0',
    shade: '#b0a090',
    accent: '#2a2420',
  },
  {
    kind: AnimalKind.Goat,
    name: 'goat',
    plural: 'goats',
    biome: Biome.Mountain,
    speed: 1.7,
    skittish: 0.45,
    wild: false,
    fill: '#c8b090',
    shade: '#8a7050',
    accent: '#3a3028',
  },
  {
    kind: AnimalKind.Lion,
    name: 'lion',
    plural: 'lions',
    biome: Biome.Scrub,
    speed: 1.5,
    skittish: 0.15,
    wild: true,
    fill: '#d4a03a',
    shade: '#a07020',
    accent: '#5a3a10',
  },
  {
    kind: AnimalKind.Bear,
    name: 'bear',
    plural: 'bears',
    biome: Biome.Forest,
    speed: 1.15,
    skittish: 0.2,
    wild: true,
    fill: '#6a4030',
    shade: '#3a2218',
    accent: '#1a100c',
  },
  {
    kind: AnimalKind.Snake,
    name: 'serpent',
    plural: 'serpents',
    biome: Biome.Scrub,
    speed: 1.1,
    skittish: 0.35,
    wild: true,
    fill: '#3a8a4a',
    shade: '#1e5a28',
    accent: '#c8c84a',
  },
  {
    kind: AnimalKind.Dove,
    name: 'dove',
    plural: 'doves',
    biome: Biome.Valley,
    speed: 2.2,
    skittish: 0.85,
    wild: false,
    fill: '#f2eee6',
    shade: '#c0b8aa',
    accent: '#7a6a50',
  },
  {
    kind: AnimalKind.Donkey,
    name: 'donkey',
    plural: 'donkeys',
    biome: Biome.Forest,
    speed: 1.35,
    skittish: 0.4,
    wild: false,
    fill: '#8a8478',
    shade: '#5a564c',
    accent: '#2a2824',
  },
  {
    kind: AnimalKind.Camel,
    name: 'camel',
    plural: 'camels',
    biome: Biome.Scrub,
    speed: 1.25,
    skittish: 0.3,
    wild: false,
    fill: '#c4a06a',
    shade: '#8a6a40',
    accent: '#4a3820',
  },
  {
    kind: AnimalKind.Ox,
    name: 'ox',
    plural: 'oxen',
    biome: Biome.Valley,
    speed: 1.05,
    skittish: 0.25,
    wild: false,
    fill: '#4a3020',
    shade: '#2a1a10',
    accent: '#e0d0b0',
  },
  {
    kind: AnimalKind.Raven,
    name: 'raven',
    plural: 'ravens',
    biome: Biome.Mountain,
    speed: 2.35,
    skittish: 0.8,
    wild: true,
    fill: '#1a1a20',
    shade: '#0a0a10',
    accent: '#4a4a58',
  },
];

export interface Animal {
  id: number;
  kind: AnimalKind;
  /** Top-left of the sprite, in world pixels. */
  x: number;
  y: number;
  /**
   * Position at the start of the current simulation step.
   *
   * The renderer draws between this and `x`/`y` so motion is smooth on a
   * display refreshing faster than the fixed 60Hz simulation.
   */
  prevX: number;
  prevY: number;
  dir: AnimalDir;
  status: AnimalStatus;
  /** Seconds until the next heading choice. */
  cooldown: number;
  /** How many heading choices this creature has made (drives deterministic RNG). */
  steps: number;
  anim: number;
  /**
   * Where it lives, if anywhere: a paddock or pasture, in tiles. A kept
   * animal wanders only inside it — through a gap in a fallen fence, a
   * tile at most.
   */
  home: TileRect | null;
  /** The homestead whose farmer owns it, or -1: free to lead away. */
  owner: number;
}

/**
 * The domestic kind each biome's farms keep, one of the pair per farm.
 * Sheep live in the town pasture; doves live alongside everyone.
 */
export const FARM_KIND: Record<Biome, AnimalKind> = {
  [Biome.Valley]: AnimalKind.Ox,
  [Biome.Forest]: AnimalKind.Donkey,
  [Biome.Scrub]: AnimalKind.Camel,
  [Biome.Mountain]: AnimalKind.Goat,
};

/** Wild kinds are never placed nearer than this to where people live, in tiles. */
export const WILD_SHY = 16;
/** ...and turn away when they wander within this. */
const WILD_TURN = 10;

export interface FlockScore {
  rescued: number;
  pairs: number;
  drowned: number;
  wild: number;
  /** On the rope or tied up somewhere: caught, but not yet aboard. */
  inHand: number;
  /** 0..2 boarded per kind, indexed by AnimalKind. */
  boarded: number[];
}

export function animalDef(kind: AnimalKind): AnimalDef {
  return ANIMAL_DEFS[kind];
}

export function emptyBoarded(): number[] {
  return new Array<number>(ANIMAL_COUNT).fill(0);
}

export function flockScoreOf(animals: readonly Animal[]): FlockScore {
  const boarded = emptyBoarded();
  let rescued = 0;
  let drowned = 0;
  let wild = 0;
  let inHand = 0;
  for (const a of animals) {
    if (a.status === AnimalStatus.Boarded) {
      boarded[a.kind]++;
      rescued++;
    } else if (a.status === AnimalStatus.Drowned) {
      drowned++;
    } else if (a.status === AnimalStatus.Wild) {
      wild++;
    } else {
      inHand++;
    }
  }
  let pairs = 0;
  for (let k = 0; k < ANIMAL_COUNT; k++) {
    if (boarded[k] >= ANIMALS_PER_KIND) pairs++;
  }
  return { rescued, pairs, drowned, wild, inHand, boarded };
}

/** Pairs first, then bodies. A complete flock is 10 pairs / 20 boarded. */
export function flockRank(score: FlockScore): number {
  return score.pairs * 100 + score.rescued;
}

export function isBetterFlock(next: FlockScore, best: FlockScore | null): boolean {
  if (!best) return next.rescued > 0 || next.pairs > 0;
  return flockRank(next) > flockRank(best);
}

/**
 * Place two of each kind on walkable ground in their home biome, away from
 * spawn and other reserved tiles. Falls back to any walkable tile in-biome,
 * then any walkable tile, rather than silently shipping a short flock.
 */
export function spawnAnimals(
  seed: number,
  tiles: Uint8Array,
  biome: Uint8Array,
  w: number,
  reserved: Set<number>,
  spawn: Point,
  pastures: readonly number[] = [],
  homesteads: readonly Homestead[] = [],
  settled: readonly Point[] = [],
): Animal[] {
  const rng = stageRng(seed, 'animals');
  const byBiome: number[][] = [[], [], [], []];
  for (let i = 0; i < tiles.length; i++) {
    if (!isWalkable(tiles[i])) continue;
    if (reserved.has(i)) continue;
    byBiome[biome[i]].push(i);
  }

  const pastureTiles = pastures.filter((i) => isWalkable(tiles[i]) && !reserved.has(i));

  const taken = new Set<number>(reserved);
  const animals: Animal[] = [];
  let id = 0;
  const pastureRect = rectOf(pastureTiles, w);
  // Wild things live away from people: filter their ground once.
  const shy = (cells: number[]) =>
    cells.filter((i) => farFromAll(i % w, (i / w) | 0, settled, WILD_SHY));

  for (let k = 0; k < ANIMAL_COUNT; k++) {
    const def = ANIMAL_DEFS[k];
    const ground = def.wild ? shy(byBiome[def.biome]) : byBiome[def.biome];
    const homeGround = ground.length > 0 ? ground : byBiome[def.biome];
    const isSheep = def.kind === AnimalKind.Sheep && pastureTiles.length > 0;
    const prefer = isSheep ? pastureTiles : homeGround;
    const farms = homesteads.filter((f) => FARM_KIND[f.biome] === def.kind);
    for (let n = 0; n < ANIMALS_PER_KIND; n++) {
      // A farm animal: in its paddock, one of the pair at each farm.
      const farm = farms.length > 0 ? farms[n % farms.length] : null;
      let spot = farm ? paddockSpot(farm, tiles, taken, w) : -1;
      let home: TileRect | null = null;
      let owner = -1;
      if (spot >= 0 && farm) {
        const slack = farm.state === HomesteadState.FallenFence ? 1 : 0;
        home = {
          x0: farm.paddock.x0 - slack,
          y0: farm.paddock.y0 - slack,
          x1: farm.paddock.x1 + slack,
          y1: farm.paddock.y1 + slack,
        };
        owner = farm.state === HomesteadState.LivedIn ? farm.id : -1;
      } else {
        spot =
          pickSpot(rng, prefer, taken, w, spawn, isSheep ? 3 : 14) ??
          pickSpot(rng, homeGround, taken, w, spawn, 14) ??
          pickSpot(rng, homeGround, taken, w, spawn, 6) ??
          pickSpot(rng, flatten(byBiome), taken, w, spawn, 4) ??
          firstFree(tiles, taken);
        if (isSheep && pastureRect) home = pastureRect;
      }
      if (spot < 0) continue;
      taken.add(spot);
      const tx = spot % w;
      const ty = (spot / w) | 0;
      animals.push({
        id: id++,
        kind: def.kind,
        x: tx * TILE_PX + (TILE_PX - ANIMAL_W) / 2,
        y: ty * TILE_PX + (TILE_PX - ANIMAL_H) / 2,
        prevX: tx * TILE_PX + (TILE_PX - ANIMAL_W) / 2,
        prevY: ty * TILE_PX + (TILE_PX - ANIMAL_H) / 2,
        dir: (Math.floor(rng() * 4) as AnimalDir) || AnimalDir.Down,
        status: AnimalStatus.Wild,
        cooldown: 0.4 + rng() * 1.2,
        steps: 0,
        anim: rng() * 4,
        home,
        owner,
      });
    }
  }

  return animals;
}

/** A free, walkable tile inside a farm's paddock, or -1. */
function paddockSpot(farm: Homestead, tiles: Uint8Array, taken: Set<number>, w: number): number {
  const { x0, y0, x1, y1 } = farm.paddock;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!taken.has(i) && isWalkable(tiles[i])) return i;
    }
  }
  return -1;
}

function rectOf(cells: readonly number[], w: number): TileRect | null {
  if (cells.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of cells) {
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function farFromAll(x: number, y: number, points: readonly Point[], min: number): boolean {
  for (const p of points) if ((p.x - x) ** 2 + (p.y - y) ** 2 < min * min) return false;
  return true;
}

function flatten(groups: number[][]): number[] {
  const out: number[] = [];
  for (const g of groups) out.push(...g);
  return out;
}

function pickSpot(
  rng: Rng,
  candidates: readonly number[],
  taken: Set<number>,
  w: number,
  spawn: Point,
  minDist: number,
): number | null {
  if (candidates.length === 0) return null;
  const min2 = minDist * minDist;
  const start = Math.floor(rng() * candidates.length);
  for (let n = 0; n < candidates.length; n++) {
    const i = candidates[(start + n) % candidates.length];
    if (taken.has(i)) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const dx = x - spawn.x;
    const dy = y - spawn.y;
    if (dx * dx + dy * dy < min2) continue;
    if (!farFromTaken(x, y, taken, w, 5)) continue;
    return i;
  }
  for (let n = 0; n < candidates.length; n++) {
    const i = candidates[(start + n) % candidates.length];
    if (!taken.has(i)) return i;
  }
  return null;
}

function farFromTaken(x: number, y: number, taken: Set<number>, w: number, minDist: number): boolean {
  const min2 = minDist * minDist;
  for (const t of taken) {
    const dx = (t % w) - x;
    const dy = ((t / w) | 0) - y;
    if (dx * dx + dy * dy < min2) return false;
  }
  return true;
}

function firstFree(tiles: Uint8Array, taken: Set<number>): number {
  for (let i = 0; i < tiles.length; i++) {
    if (taken.has(i)) continue;
    if (isWalkable(tiles[i])) return i;
  }
  return -1;
}

const DIR_X = [0, 0, -1, 1];
const DIR_Y = [1, -1, 0, 0];

export interface AnimalStepEvent {
  drowned: Animal[];
}

/**
 * Wander, flee, drown. Deterministic given (animal state, map, dt) — heading
 * picks hash off (id, steps) so a seed plus a 60Hz clock reproduces.
 */
export function stepAnimals(
  animals: Animal[],
  map: TileMap,
  waterLevel: number,
  dt: number,
  player: { x: number; y: number } | null,
  settled: readonly Point[] = [],
): AnimalStepEvent {
  const drowned: Animal[] = [];
  const level = waterLevel;

  for (const a of animals) {
    if (a.status === AnimalStatus.Tethered) {
      // Tied up, it cannot climb away from the water. That is the risk of
      // leaving a string on low ground.
      a.prevX = a.x;
      a.prevY = a.y;
      a.anim += dt;
      if (isUnderAt(map, a.x + ANIMAL_W / 2, a.y + ANIMAL_H / 2, level)) {
        a.status = AnimalStatus.Drowned;
        drowned.push(a);
      }
      continue;
    }
    if (a.status !== AnimalStatus.Wild) continue;

    a.prevX = a.x;
    a.prevY = a.y;

    const cx = a.x + ANIMAL_W / 2;
    const cy = a.y + ANIMAL_H / 2;
    const tx = Math.floor(cx / TILE_PX);
    const ty = Math.floor(cy / TILE_PX);
    if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h) {
      const i = ty * map.w + tx;
      if (map.floods && map.elev[i] < level) {
        a.status = AnimalStatus.Drowned;
        drowned.push(a);
        continue;
      }
    }

    a.anim += dt;
    a.cooldown -= dt;

    const def = ANIMAL_DEFS[a.kind];
    if (a.cooldown <= 0) {
      a.cooldown = 0.5 + hash01(a.id, a.steps) * 1.6;
      a.dir = chooseHeading(a, def, player, map, level, settled);
      a.steps++;
    }

    const speed = def.speed * TILE_PX * dt;
    const nx = a.x + DIR_X[a.dir] * speed;
    const ny = a.y + DIR_Y[a.dir] * speed;
    if (animalCanOccupy(map, nx, ny, level, homeFence(a))) {
      a.x = nx;
      a.y = ny;
    } else {
      a.cooldown = 0;
    }
  }

  return { drowned };
}

function isUnderAt(map: TileMap, px: number, py: number, level: number): boolean {
  if (!map.floods) return false;
  const tx = Math.floor(px / TILE_PX);
  const ty = Math.floor(py / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  return map.elev[ty * map.w + tx] < level;
}

function chooseHeading(
  a: Animal,
  def: AnimalDef,
  player: { x: number; y: number } | null,
  map: TileMap,
  level: number,
  settled: readonly Point[],
): AnimalDir {
  // Wild things turn away from wherever people live.
  if (def.wild) {
    const cx = (a.x + ANIMAL_W / 2) / TILE_PX;
    const cy = (a.y + ANIMAL_H / 2) / TILE_PX;
    for (const p of settled) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dx * dx + dy * dy >= WILD_TURN * WILD_TURN) continue;
      const away = axisDir(-dx, -dy);
      if (headingIsClear(map, a, away, level)) return away;
      break;
    }
  }
  if (player) {
    const dx = player.x - (a.x + ANIMAL_W / 2);
    const dy = player.y - (a.y + ANIMAL_H / 2);
    const dist2 = dx * dx + dy * dy;
    const panic = 28 + def.skittish * 36;
    if (dist2 < panic * panic && hash01(a.id, a.steps ^ 17) < def.skittish + 0.25) {
      const away = axisDir(-dx, -dy);
      if (headingIsClear(map, a, away, level)) return away;
    }
  }

  // Out of its paddock (a fallen fence, a fresh spawn): head home.
  if (a.home && !insideHome(a, a.home)) {
    const hx = ((a.home.x0 + a.home.x1 + 1) / 2) * TILE_PX - (a.x + ANIMAL_W / 2);
    const hy = ((a.home.y0 + a.home.y1 + 1) / 2) * TILE_PX - (a.y + ANIMAL_H / 2);
    return axisDir(hx, hy);
  }

  const roll = hash01(a.id, a.steps + 3);
  const dir = Math.floor(roll * 4) as AnimalDir;
  if (headingIsClear(map, a, dir, level)) return dir;
  for (let k = 1; k < 4; k++) {
    const alt = ((dir + k) % 4) as AnimalDir;
    if (headingIsClear(map, a, alt, level)) return alt;
  }
  return dir;
}

function axisDir(dx: number, dy: number): AnimalDir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? AnimalDir.Left : AnimalDir.Right;
  return dy < 0 ? AnimalDir.Up : AnimalDir.Down;
}

function headingIsClear(map: TileMap, a: Animal, dir: AnimalDir, level: number): boolean {
  const look = TILE_PX * 0.8;
  return animalCanOccupy(map, a.x + DIR_X[dir] * look, a.y + DIR_Y[dir] * look, level, homeFence(a));
}

/** The home bounds to hold an animal to — once it is inside them. */
function homeFence(a: Animal): TileRect | null {
  return a.home && insideHome(a, a.home) ? a.home : null;
}

function insideHome(a: Animal, home: TileRect): boolean {
  const tx = Math.floor((a.x + ANIMAL_W / 2) / TILE_PX);
  const ty = Math.floor((a.y + ANIMAL_H / 2) / TILE_PX);
  return tx >= home.x0 && tx <= home.x1 && ty >= home.y0 && ty <= home.y1;
}

function animalCanOccupy(
  map: TileMap,
  x: number,
  y: number,
  level: number,
  home: TileRect | null = null,
): boolean {
  if (home) {
    // A kept animal's centre never leaves home.
    const tx = Math.floor((x + ANIMAL_W / 2) / TILE_PX);
    const ty = Math.floor((y + ANIMAL_H / 2) / TILE_PX);
    if (tx < home.x0 || tx > home.x1 || ty < home.y0 || ty > home.y1) return false;
  }
  const corners: [number, number][] = [
    [x, y],
    [x + ANIMAL_W - 1, y],
    [x, y + ANIMAL_H - 1],
    [x + ANIMAL_W - 1, y + ANIMAL_H - 1],
  ];
  for (const [cx, cy] of corners) {
    const tx = Math.floor(cx / TILE_PX);
    const ty = Math.floor(cy / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    const i = ty * map.w + tx;
    if (!isWalkable(map.tiles[i])) return false;
    if (map.tiles[i] === Tile.ArkSite || map.tiles[i] === Tile.DungeonEntrance) return false;
    if (map.tiles[i] === Tile.BoatYard || map.tiles[i] === Tile.Shrine) return false;
    if (map.floods && map.elev[i] < level) return false;
  }
  return true;
}

export function animalOverlaps(
  a: Animal,
  px: number,
  py: number,
  pw: number,
  ph: number,
): boolean {
  if (a.status !== AnimalStatus.Wild) return false;
  return a.x < px + pw && a.x + ANIMAL_W > px && a.y < py + ph && a.y + ANIMAL_H > py;
}

function hash01(a: number, b: number): number {
  // Same family as rng.ts — no Math.random, so tests stay deterministic.
  const rng = mulberry32(((a * 0x9e3779b9) ^ (b * 0x85ebca6b) ^ 0x165667b1) >>> 0);
  return rng();
}
