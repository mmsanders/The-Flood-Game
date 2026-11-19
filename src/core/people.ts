/**
 * The people who live here, and the places they live. Wave 7.
 *
 * Each town, hamlet and lived-in farm is a `Place` with a handful of tiles
 * people stand on and the day the water will reach it. People belong to a
 * place; when theirs is about to drown they move to the nearest place still
 * dry (`src/game/people.ts`), so over a run the south empties and the north
 * fills with refugees.
 *
 * Built last in worldgen, from the final tiles, so every standing spot is
 * genuinely walkable.
 */

import { TILE_PX } from './config.js';
import { drownDayForElev } from './flood.js';
import { stageRng, type Rng } from './rng.js';
import { Tile, isWalkable } from './tiles.js';
import {
  type Homestead,
  HomesteadState,
  type Person,
  PersonRole,
  PersonStatus,
  type Place,
  type Settlement,
  SettlementKind,
  type Site,
  SiteKind,
} from './world.js';

/** How many clothing palettes the renderer knows. */
export const PERSON_LOOKS = 8;

export const PERSON_W = 8;
export const PERSON_H = 12;

const PLACE_NAME: Record<SettlementKind, string> = {
  [SettlementKind.TentCity]: 'the tent city',
  [SettlementKind.LoggingTown]: 'the mill town',
  [SettlementKind.City]: 'the city',
  [SettlementKind.Hamlet]: 'the high hamlet',
};

const PLACE_RADIUS: Record<SettlementKind, number> = {
  [SettlementKind.TentCity]: 7,
  [SettlementKind.LoggingTown]: 7,
  [SettlementKind.City]: 9,
  [SettlementKind.Hamlet]: 4,
};

const TOWNSFOLK: Record<SettlementKind, number> = {
  [SettlementKind.TentCity]: 4,
  [SettlementKind.LoggingTown]: 4,
  [SettlementKind.City]: 6,
  [SettlementKind.Hamlet]: 2,
};

const MAX_SPOTS = 24;

/** Ground people may stand on: walkable, and not a doorway or anything you use. */
function standable(tile: number): boolean {
  if (!isWalkable(tile)) return false;
  switch (tile) {
    case Tile.TownDoor:
    case Tile.TavernDoor:
    case Tile.AxeLeft:
    case Tile.PickaxeLeft:
    case Tile.DungeonEntrance:
    case Tile.BoatYard:
    case Tile.Shrine:
    case Tile.ArkSite:
    case Tile.CampTent:
    case Tile.HeartContainer:
    case Tile.Steps:
    case Tile.Bridge:
      return false;
    default:
      return true;
  }
}

export function placePeople(
  seed: number,
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  settlements: readonly Settlement[],
  homesteads: readonly Homestead[],
  sites: readonly Site[] = [],
  slipway: { x: number; y: number } | null = null,
): { places: Place[]; people: Person[] } {
  const rng = stageRng(seed, 'people');
  const places: Place[] = [];
  const people: Person[] = [];

  const settle = (x: number, y: number, radius: number, name: string, homestead: number, crowd: number, role: PersonRole) => {
    const spots = spotsNear(rng, tiles, w, h, x, y, radius);
    if (spots.length === 0) return;
    const sorted = spots.map((i) => elev[i]).sort((a, b) => a - b);
    const place: Place = {
      x,
      y,
      name,
      homestead,
      spots,
      drownsOn: drownDayForElev(sorted[sorted.length >> 1]),
    };
    const id = places.length;
    places.push(place);
    for (let n = 0; n < crowd; n++) people.push(newPerson(rng, people.length, role, id, spots[n % spots.length], w));
  };

  for (const s of settlements) {
    settle(s.x, s.y, PLACE_RADIUS[s.kind], PLACE_NAME[s.kind], -1, TOWNSFOLK[s.kind], PersonRole.Townsfolk);
  }
  for (const f of homesteads) {
    // Abandoned and fallen-fence farms are still somewhere to run to; a
    // lived-in one has its farmer in the yard.
    const crowd = f.state === HomesteadState.LivedIn ? 1 : 0;
    settle(f.yard.x, f.yard.y, 2, f.name, f.id, crowd, PersonRole.Farmer);
  }
  // The fisherman, mending nets by the slipway (Wave 8).
  if (slipway) settle(slipway.x, slipway.y, 3, 'the slipway', -1, 1, PersonRole.Fisherman);
  for (const site of sites) {
    // The trades that someone works: the potter, the vintner, the burners.
    if (!site.keeper) continue;
    const crowd = site.kind === SiteKind.Charcoal ? 2 : 1;
    settle(site.keeper.x, site.keeper.y, 2, site.name, -1, crowd, PersonRole.Townsfolk);
  }
  return { places, people };
}

function spotsNear(rng: Rng, tiles: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let y = Math.max(1, cy - r); y <= Math.min(h - 2, cy + r); y++) {
    for (let x = Math.max(1, cx - r); x <= Math.min(w - 2, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * w + x;
      if (standable(tiles[i])) out.push(i);
    }
  }
  // Nearest the middle first, so a farmer stands at his own door.
  out.sort((a, b) => dist2(a, w, cx, cy) - dist2(b, w, cx, cy) || a - b);
  const keep = out.slice(0, MAX_SPOTS);
  // Shuffle all but the first, so townsfolk don't queue in a line.
  for (let i = keep.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(rng() * i);
    [keep[i], keep[j]] = [keep[j], keep[i]];
  }
  return keep;
}

function dist2(i: number, w: number, cx: number, cy: number): number {
  return ((i % w) - cx) ** 2 + (((i / w) | 0) - cy) ** 2;
}

export function newPerson(rng: Rng, id: number, role: PersonRole, place: number, anchor: number, w: number): Person {
  const x = (anchor % w) * TILE_PX + (TILE_PX - PERSON_W) / 2;
  const y = ((anchor / w) | 0) * TILE_PX + (TILE_PX - PERSON_H) / 2;
  return {
    id,
    role,
    look: Math.floor(rng() * PERSON_LOOKS),
    place,
    origin: place,
    anchor,
    x,
    y,
    prevX: x,
    prevY: y,
    dir: 0,
    status: PersonStatus.Here,
    cooldown: 0.3 + rng() * 2,
    steps: 0,
    anim: rng() * 4,
  };
}
