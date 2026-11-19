/**
 * The town's own business: the tavern's rumours and its fire, and the
 * signpost on the square. Wave 7.
 *
 * Roads carry most of the clues in this game (ROADMAP 1.4). The tavern is
 * for the ones a road can't say: which farmer will sell, whose farm stands
 * empty, where somebody left an axe. Every rumour is built from the world as
 * it is right now, so none of them is ever a lie — though the water may have
 * made one stale by the time you get there.
 */

import { ANIMAL_DEFS, AnimalStatus, FARM_KIND } from '../core/animals.js';
import { type Interior, InteriorKind } from '../core/interior.js';
import { Resource, Tile } from '../core/tiles.js';
import { HomesteadState, PersonRole, type Point, SiteKind } from '../core/world.js';
import { forSale, ownerOf } from './people.js';
import { currentDay, facingTile, RESOURCE_LABEL, say } from './queries.js';
import { RAIN_DAY } from '../core/flood.js';
import type { Action, GameState, ObstaclePrompt } from './types.js';

/** Fiber for a heart, by the tavern fire. Cheap: it's a bed, not a miracle. */
export const REST_COST = 2;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** "north-east, a fair walk": eight-way, y down, with a sense of distance. */
export function bearing(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = Math.atan2(dx, -dy);
  const k = (Math.round(a / (Math.PI / 4)) + 8) % 8;
  const d = Math.hypot(dx, dy);
  const far = d < 24 ? 'not far' : d < 80 ? 'a fair walk' : 'a long way';
  return `${COMPASS[k]}, ${far}`;
}

/** Everything worth whispering about, from the world as it stands. */
export function rumours(state: GameState, here: Point): string[] {
  const { world } = state;
  const out: string[] = [];

  for (const site of world.sites ?? []) {
    if (!site.tool) continue;
    const t = world.tiles[site.tool.y * world.w + site.tool.x];
    if (t === Tile.AxeLeft) {
      out.push(`A woodcutter left his axe at ${site.name}. ${cap(bearing(here, site))}.`);
    } else if (t === Tile.PickaxeLeft) {
      out.push(`There's a pickaxe lying at ${site.name} — ${bearing(here, site)}.`);
    }
  }
  for (const f of world.homesteads ?? []) {
    const kind = ANIMAL_DEFS[FARM_KIND[f.biome]];
    const farmer = ownerOf(state, f.id);
    if (f.state === HomesteadState.LivedIn && farmer && forSale(state, farmer)) {
      out.push(`The farmer at ${f.name} might sell you his ${kind.name}. ${cap(bearing(here, f))}.`);
      continue;
    }
    const left = world.animals.some((a) => a.status === AnimalStatus.Wild && a.owner < 0 && a.home && a.kind === kind.kind && near(a, f));
    if (left && f.state !== HomesteadState.LivedIn) {
      out.push(`Nobody's been at ${f.name} since spring. There's still a ${kind.name} in the pen.`);
    }
  }
  if (!state.hermitHeartClaimed) {
    out.push('The hermit up the mountain would give a heart for a sheep. One of yours, off the boat.');
  }
  const fisher = (world.people ?? []).find((p) => p.role === PersonRole.Fisherman && p.place === p.origin && p.status !== 2);
  if (fisher && !state.hasFishingRod) {
    out.push(`Old fisherman at the slipway sells rods. Pulls things up from the deep with 'em. ${cap(bearing(here, world.boatYard))}.`);
  }
  if (world.desert) out.push("There's a sunburnt fellow at the carpenter's. Talks about the far sand.");
  if (world.sites?.some((s) => s.kind === SiteKind.Vineyard)) {
    out.push(currentDay(state) < RAIN_DAY ? 'Good vintage this year, they say.' : 'They say the low road is under already.');
  }
  return out;
}

function near(a: { x: number; y: number }, f: Point): boolean {
  return Math.abs(a.x / 16 - f.x) < 10 && Math.abs(a.y / 16 - f.y) < 8;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// -- the tavern ----------------------------------------------------------------

export function tavernCounterPrompt(): ObstaclePrompt {
  return { tile: Tile.TavernDoor, label: 'Ask the keeper what he has heard', affordable: true };
}

export function askKeeper(state: GameState, room: Interior): void {
  const list = rumours(state, room.overworldEntrance);
  if (list.length === 0) {
    say(state, '"Quiet lately. Too quiet, with the weather."');
    return;
  }
  const line = list[state.rumoursHeard % list.length];
  state.rumoursHeard++;
  say(state, `"${line}"`);
}

export function hearthPrompt(state: GameState): ObstaclePrompt {
  const p = state.player;
  if (p.hearts >= p.maxHearts) return { tile: Tile.Kiln, label: 'Warm yourself by the fire', affordable: true };
  return {
    tile: Tile.Kiln,
    label: `Rest by the fire — ${REST_COST} ${RESOURCE_LABEL[Resource.Fiber]} for a heart`,
    affordable: state.carried[Resource.Fiber] >= REST_COST,
  };
}

export function restByFire(state: GameState): void {
  const p = state.player;
  if (p.hearts >= p.maxHearts) {
    say(state, 'The fire is warm. Outside, it is raining on everyone else.');
    return;
  }
  if (state.carried[Resource.Fiber] < REST_COST) {
    say(state, `"A bed's ${REST_COST} fiber, friend."`);
    return;
  }
  state.carried[Resource.Fiber] -= REST_COST;
  p.hearts++;
  say(state, 'You sleep an hour by the fire. A heart restored.');
}

export function isTavern(room: Interior | null): boolean {
  return room !== null && room.kind === InteriorKind.Tavern;
}

// -- the signpost --------------------------------------------------------------

/** Facing a fingerpost on the square: read where the roads go. */
export function signAction(state: GameState): Action | null {
  if (state.location.kind !== 'overworld' || state.inBoat) return null;
  const { map, tx, ty } = facingTile(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return null;
  if (map.tiles[ty * map.w + tx] !== Tile.Signpost) return null;
  return {
    prompt: { tile: Tile.Signpost, label: 'Read the signpost', affordable: true },
    run: (s) => {
      say(s, signText(s, { x: tx, y: ty }));
      return true;
    },
  };
}

export function signText(state: GameState, at: Point): string {
  const places = (state.world.places ?? [])
    .filter((p) => p.homestead < 0 && Math.hypot(p.x - at.x, p.y - at.y) > 14)
    .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))
    .slice(0, 2);
  if (places.length === 0) return 'The sign has been rubbed blank by weather.';
  return places.map((p) => `${cap(p.name)}: ${compassOnly(at, p)}`).join(' · ');
}

function compassOnly(from: Point, to: Point): string {
  return bearing(from, to).split(',')[0];
}
