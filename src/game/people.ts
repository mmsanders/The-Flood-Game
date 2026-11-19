/**
 * The people, as the player meets them: wandering their streets and yards,
 * talking when spoken to, moving uphill as the water nears, and the farmer
 * who will sell you his animal. Wave 7.
 *
 * Nobody here can come aboard (Genesis 7:23). What they can do is watch:
 * mock the boat in the dry days, grow uneasy in the rain, and ask, near the
 * end, for the one thing Noah cannot give.
 *
 * Only people on the screen Noah is looking at move, which keeps the frame
 * budget flat however many there are; the rest wait where they stand. They
 * flee when no one is watching: a town empties between one visit and the
 * next.
 */

import { ANIMAL_DEFS, AnimalKind, AnimalStatus, FARM_KIND } from '../core/animals.js';
import { PANEL_H, PANEL_W, TILE_PX } from '../core/config.js';
import { PERSON_H, PERSON_W } from '../core/people.js';
import { RAIN_DAY } from '../core/flood.js';
import { Resource, Tile, isWalkable } from '../core/tiles.js';
import {
  type Person,
  PersonRole,
  PersonStatus,
  type Place,
} from '../core/world.js';
import { currentDay, depthAt, RESOURCE_LABEL, say } from './queries.js';
import { type Action, Dir, type GameState, PLAYER_H, PLAYER_W } from './types.js';

/** Leave this long before the water reaches the middle of home, in days. */
const LEAVE_AHEAD = 0.6;
/** A refuge must stay dry at least this many days longer. */
const REFUGE_MARGIN = 2;
/** How far from their spot people wander, in tiles. */
const WANDER = 3;
const WALK_TILES_PER_SEC = 0.9;
const FLEE_TILES_PER_SEC = 2.2;
/** How near Noah must stand to talk, in pixels between hitboxes. */
const TALK_REACH = 6;

const DIR_X = [0, 0, -1, 1];
const DIR_Y = [1, -1, 0, 0];

/**
 * What a farmer asks for one of his animals. Never pitch: pitch is for the
 * hull. Priced by how much work the beast saves a farm.
 */
export const ANIMAL_PRICE: Partial<Record<AnimalKind, readonly [Resource, number][]>> = {
  [AnimalKind.Ox]: [
    [Resource.Wood, 4],
    [Resource.Stone, 2],
  ],
  [AnimalKind.Donkey]: [
    [Resource.Wood, 3],
    [Resource.Fiber, 2],
  ],
  [AnimalKind.Camel]: [
    [Resource.Stone, 3],
    [Resource.Fiber, 3],
  ],
  [AnimalKind.Goat]: [
    [Resource.Stone, 2],
    [Resource.Fiber, 2],
  ],
};

/** One simulation step for everyone. */
export function stepPeople(state: GameState, dt: number): void {
  const { people, places } = state.world;
  if (!people || people.length === 0) return;
  const day = currentDay(state);
  const outside = state.location.kind === 'overworld';

  for (const p of people) {
    if (p.status === PersonStatus.Gone) continue;
    p.prevX = p.x;
    p.prevY = p.y;
    const seen = outside && onScreen(state, p);

    if (p.status === PersonStatus.Here && threatened(state, p, places[p.place], day)) {
      releaseAnimals(state, p);
      if (seen) p.status = PersonStatus.Leaving;
      else relocate(state, p, day);
      continue;
    }
    if (p.status === PersonStatus.Leaving) {
      if (!seen) relocate(state, p, day);
      else flee(state, p, dt);
      continue;
    }
    if (seen) wander(state, p, dt);
  }
}

function onScreen(state: GameState, p: Person): boolean {
  const tx = Math.floor((p.x + PERSON_W / 2) / TILE_PX);
  const ty = Math.floor((p.y + PERSON_H / 2) / TILE_PX);
  return Math.floor(tx / PANEL_W) === state.camera.panelX && Math.floor(ty / PANEL_H) === state.camera.panelY;
}

function tileOf(p: Person): { tx: number; ty: number } {
  return {
    tx: Math.floor((p.x + PERSON_W / 2) / TILE_PX),
    ty: Math.floor((p.y + PERSON_H / 2) / TILE_PX),
  };
}

function threatened(state: GameState, p: Person, home: Place, day: number): boolean {
  if (day >= home.drownsOn - LEAVE_AHEAD) return true;
  if (state.location.kind !== 'overworld') return false;
  const { tx, ty } = tileOf(p);
  return depthAt(state, tx, ty) > 0;
}

/** A farmer who leaves his farm leaves his animals to whoever comes. */
function releaseAnimals(state: GameState, p: Person): void {
  if (p.role !== PersonRole.Farmer || p.place !== p.origin) return;
  const farm = state.world.places[p.origin]?.homestead ?? -1;
  if (farm < 0) return;
  for (const a of state.world.animals) if (a.owner === farm) a.owner = -1;
}

/** Off to the nearest place that will stay dry a while, or nowhere. */
function relocate(state: GameState, p: Person, day: number): void {
  const { places, w } = state.world;
  const from = places[p.place];
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < places.length; k++) {
    const q = places[k];
    if (k === p.place || q.spots.length === 0) continue;
    if (q.drownsOn < day + REFUGE_MARGIN || q.drownsOn <= from.drownsOn) continue;
    const d = (q.x - from.x) ** 2 + (q.y - from.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (best < 0) {
    p.status = PersonStatus.Gone;
    return;
  }
  const refuge = places[best];
  p.place = best;
  p.anchor = refuge.spots[(p.id * 7 + best) % refuge.spots.length];
  p.x = (p.anchor % w) * TILE_PX + (TILE_PX - PERSON_W) / 2;
  p.y = ((p.anchor / w) | 0) * TILE_PX + (TILE_PX - PERSON_H) / 2;
  p.prevX = p.x;
  p.prevY = p.y;
  p.status = PersonStatus.Here;
}

function canStand(state: GameState, x: number, y: number): boolean {
  const map = state.world;
  const tx = Math.floor((x + PERSON_W / 2) / TILE_PX);
  const ty = Math.floor((y + PERSON_H - 2) / TILE_PX);
  if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1) return false;
  const tile = map.tiles[ty * map.w + tx];
  if (!isWalkable(tile)) return false;
  if (tile === Tile.TownDoor || tile === Tile.TavernDoor || tile === Tile.DungeonEntrance || tile === Tile.ArkSite) return false;
  return depthAt(state, tx, ty) === 0;
}

function wander(state: GameState, p: Person, dt: number): void {
  p.cooldown -= dt;
  if (p.cooldown <= 0) {
    const roll = hash01(p.id, p.steps++);
    p.cooldown = 0.8 + roll * 2.2;
    // Half the time, stand and talk among themselves.
    p.dir = roll < 0.5 ? -1 : Math.floor(hash01(p.id, p.steps + 99) * 4);
    // Strayed too far from their spot: head back.
    const w = state.world.w;
    const ax = (p.anchor % w) * TILE_PX;
    const ay = ((p.anchor / w) | 0) * TILE_PX;
    if (Math.abs(ax - p.x) > WANDER * TILE_PX || Math.abs(ay - p.y) > WANDER * TILE_PX) {
      p.dir = Math.abs(ax - p.x) > Math.abs(ay - p.y) ? (ax < p.x ? Dir.Left : Dir.Right) : ay < p.y ? Dir.Up : Dir.Down;
    }
  }
  if (p.dir < 0) return;
  step(state, p, WALK_TILES_PER_SEC * TILE_PX * dt);
}

/** Uphill means north on this map: walk that way, sidestepping what's in the road. */
function flee(state: GameState, p: Person, dt: number): void {
  const { tx, ty } = tileOf(p);
  if (depthAt(state, tx, ty) >= 2) {
    p.status = PersonStatus.Gone;
    return;
  }
  const dist = FLEE_TILES_PER_SEC * TILE_PX * dt;
  p.dir = Dir.Up;
  if (step(state, p, dist)) return;
  p.dir = hash01(p.id, p.steps++) < 0.5 ? Dir.Left : Dir.Right;
  step(state, p, dist);
}

function step(state: GameState, p: Person, dist: number): boolean {
  const nx = p.x + DIR_X[p.dir] * dist;
  const ny = p.y + DIR_Y[p.dir] * dist;
  p.anim += dist / TILE_PX;
  if (!canStand(state, nx, ny)) {
    p.cooldown = 0;
    return false;
  }
  p.x = nx;
  p.y = ny;
  return true;
}

function hash01(a: number, b: number): number {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// -- talking ---------------------------------------------------------------

/** Who is close enough in front of Noah to talk to, if anyone. */
export function personInReach(state: GameState): Person | null {
  if (state.location.kind !== 'overworld' || state.inBoat) return null;
  const pl = state.player;
  const x0 = pl.x - TALK_REACH;
  const y0 = pl.y - TALK_REACH;
  const x1 = pl.x + PLAYER_W + TALK_REACH;
  const y1 = pl.y + PLAYER_H + TALK_REACH;
  let best: Person | null = null;
  let bestD = Infinity;
  for (const p of state.world.people ?? []) {
    if (p.status === PersonStatus.Gone) continue;
    if (p.x > x1 || p.x + PERSON_W < x0 || p.y > y1 || p.y + PERSON_H < y0) continue;
    const d = (p.x - pl.x) ** 2 + (p.y - pl.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** E beside someone: buy from a farmer, or hear what they have to say. */
export function talkAction(state: GameState): Action | null {
  const p = personInReach(state);
  if (!p) return null;
  const sale = forSale(state, p);
  if (sale) {
    const def = ANIMAL_DEFS[sale.kind];
    return {
      prompt: { tile: Tile.House, label: `Buy the ${def.name} — ${priceLabel(sale.kind)}`, affordable: canAfford(state, sale.kind) },
      run: (s) => {
        buyAnimal(s, p);
        return true;
      },
    };
  }
  return {
    prompt: { tile: Tile.House, label: 'Talk', affordable: true },
    run: (s) => {
      say(s, lineFor(s, p));
      return true;
    },
  };
}

/** The animal this farmer would sell, if he is home and still has one penned. */
export function forSale(state: GameState, p: Person) {
  if (p.role !== PersonRole.Farmer || p.place !== p.origin) return null;
  const farm = state.world.places[p.origin]?.homestead ?? -1;
  if (farm < 0) return null;
  for (const a of state.world.animals) {
    if (a.owner === farm && a.status === AnimalStatus.Wild && ANIMAL_PRICE[a.kind]) return a;
  }
  return null;
}

function priceLabel(kind: AnimalKind): string {
  return (ANIMAL_PRICE[kind] ?? []).map(([r, n]) => `${n} ${RESOURCE_LABEL[r]}`).join(', ');
}

function canAfford(state: GameState, kind: AnimalKind): boolean {
  return (ANIMAL_PRICE[kind] ?? []).every(([r, n]) => state.carried[r] >= n);
}

export function buyAnimal(state: GameState, p: Person): void {
  const a = forSale(state, p);
  if (!a) return;
  const def = ANIMAL_DEFS[a.kind];
  if (!canAfford(state, a.kind)) {
    say(state, `"${capital(priceLabel(a.kind))}, and the ${def.name} is yours."`);
    return;
  }
  for (const [r, n] of ANIMAL_PRICE[a.kind] ?? []) state.carried[r] -= n;
  a.owner = -1;
  say(
    state,
    state.hasRope
      ? `"Take good care of the ${def.name}." It's yours — lead it off.`
      : `"The ${def.name}'s yours. You'll want a rope."`,
  );
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Has this farmer anything left to say about his animal? */
export function ownerOf(state: GameState, farm: number): Person | null {
  for (const p of state.world.people ?? []) {
    if (p.role === PersonRole.Farmer && p.place === p.origin && state.world.places[p.origin]?.homestead === farm) {
      return p;
    }
  }
  return null;
}

// -- the end card ------------------------------------------------------------

/**
 * Who the run left behind, by name, for the end card (ROADMAP 7.6). The
 * people always: nobody else was ever coming aboard. And any farm's animal
 * that never made it up the ramp, because that one you could have saved.
 */
export function leftBehind(state: GameState): string {
  const { world } = state;
  const names: string[] = [];

  // The farm animal first: the one the player could have brought.
  for (const a of world.animals) {
    if (!a.home || a.status === AnimalStatus.Boarded) continue;
    const farm = (world.homesteads ?? []).find(
      (f) => a.home && f.paddock.x0 >= a.home.x0 && f.paddock.x0 <= a.home.x0 + 1 && f.paddock.y0 >= a.home.y0 && f.paddock.y0 <= a.home.y0 + 1,
    );
    if (!farm) continue;
    names.push(`the ${ANIMAL_DEFS[a.kind].name} at ${farm.name}`);
    break;
  }
  // Then the largest town's people, by where they came from.
  const towns = (world.places ?? []).filter((p) => p.homestead < 0);
  let biggest: Place | null = null;
  let most = 0;
  for (const place of towns) {
    const n = (world.people ?? []).filter((p) => world.places[p.origin] === place).length;
    if (n > most) {
      most = n;
      biggest = place;
    }
  }
  if (biggest) names.unshift(`the people of ${biggest.name}`);
  return names.join('; ');
}

// -- what they say -----------------------------------------------------------

const MOCKING = [
  'A boat? Up here? Noah, it has never once rained.',
  'My boy asks why the old man builds a ship in a field.',
  "When the water comes, we'll all be sure to knock.",
  'Gopher wood, is it? Lovely for a cattle shed.',
  'You preach well, I grant you. Do you want to buy a goat?',
  'The well is full, the barley is high. What flood?',
];
const UNEASY = [
  'It has not stopped since the morning. Is this... usual?',
  'The low fields are under. My father says it will pass.',
  'You were saying something, before. About water.',
  'The river is in the street. The children think it is a game.',
  'I dreamed of your boat last night.',
];
const PLEADING = [
  'There is room on that boat, isn\'t there? Just for the children?',
  'Please. I can carry wood. I can work.',
  'We should have listened. Will you not open the door?',
  'Where do we go when the hills are gone, Noah?',
  'Take my daughter. I will stay. Please.',
];
const REFUGEE = [
  'We came up from {from}. The water had the houses by morning.',
  'We left {from} with what we could carry.',
  '{from} is gone. We are going higher.',
];
const FARMER_GONE = ['Sold the {kind}. Hope it serves you.', 'Mind the {kind}. It knows the way home.'];

function lineFor(state: GameState, p: Person): string {
  const day = currentDay(state);
  const pick = (pool: readonly string[]) => pool[Math.floor(hash01(p.id, Math.floor(day * 4)) * pool.length)];
  const { places } = state.world;

  if (p.place !== p.origin && hash01(p.id, 31) < 0.7) {
    return quote(pick(REFUGEE).replace('{from}', places[p.origin]?.name ?? 'the valley'));
  }
  if (p.role === PersonRole.Farmer && p.place === p.origin) {
    const farm = state.world.homesteads[places[p.origin]?.homestead ?? -1];
    const kind = farm ? ANIMAL_DEFS[FARM_KIND[farm.biome]].name : 'beast';
    // forSale() has already offered the trade if there is one: this is
    // what he says once there isn't.
    return quote(pick(FARMER_GONE).replace('{kind}', kind));
  }
  if (day < RAIN_DAY) return quote(pick(MOCKING));
  if (day < 20) return quote(pick(UNEASY));
  return quote(pick(PLEADING));
}

function quote(s: string): string {
  return `"${s}"`;
}
