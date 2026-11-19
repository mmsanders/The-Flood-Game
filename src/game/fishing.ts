/**
 * Fishing, and the Sounding Line's word on the water. Wave 8.4 and 8.3.
 *
 * The Rod dredges only what is right in front of it, only from the skiff (or
 * ankle-deep, in galoshes), and only as deep as its reach. The fishing rod
 * is the recovery tool for everything else: from the shore, wading, or
 * afloat, cast up to two tiles out and bring up a sunken resource from any
 * depth. A cast takes time and brings up one; the Rod is still how you
 * gather. The line brings up only what the Rod knows, so the shrine ladder
 * still gates pitch.
 *
 * Bought from the fisherman mending nets at the slipway.
 */

import { ITEM_COST, ItemKind } from '../core/items.js';
import { canRodHarvest } from '../core/resources.js';
import { carveTo, type Biome, resourceOf, RESOURCE_NAMES, Tile } from '../core/tiles.js';
import { type Person, PersonRole } from '../core/world.js';
import { activeMap, depthAt, dirX, dirY, RESOURCE_LABEL, say, tileUnder } from './queries.js';
import type { Action, GameState, StepInput } from './types.js';

/** Seconds a line is in the water before it comes up. */
export const CAST_TIME = 1.4;
/** How far out a cast reaches, in tiles. */
export const CAST_REACH = 2;

/** Input fed to movement while Noah stands with a line in the water. */
export const STILL: StepInput = { moveX: 0, moveY: 0, attackPressed: false, interactPressed: false };

/** The first sunken resource up to two tiles straight ahead, if any. */
export function castTarget(state: GameState): { tx: number; ty: number } | null {
  const map = activeMap(state);
  const { tx, ty } = tileUnder(state);
  const dx = dirX(state.player.dir);
  const dy = dirY(state.player.dir);
  for (let n = 1; n <= CAST_REACH; n++) {
    const x = tx + dx * n;
    const y = ty + dy * n;
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return null;
    if (resourceOf(map.tiles[y * map.w + x]) === null) continue;
    if (depthAt(state, x, y) <= 0) continue;
    return { tx: x, ty: y };
  }
  return null;
}

/** E with the fishing rod, facing something on the bottom. */
export function fishAction(state: GameState): Action | null {
  if (!state.hasFishingRod || state.castT > 0) return null;
  if (state.location.kind !== 'overworld' && state.location.kind !== 'dungeon') return null;
  const target = castTarget(state);
  if (!target) return null;
  const map = activeMap(state);
  const tile = map.tiles[target.ty * map.w + target.tx] as Tile;
  const res = resourceOf(tile)!;
  const knows = canRodHarvest(state.rodTier, res);
  const depth = depthAt(state, target.tx, target.ty);
  return {
    prompt: {
      tile,
      label: knows
        ? `Cast for the ${RESOURCE_NAMES[res]} — depth ${Math.min(4, depth)}`
        : `${RESOURCE_NAMES[res]} below. The Rod does not yet know it.`,
      affordable: knows,
    },
    run: (s) => {
      if (!knows) {
        say(s, `The line won't bring up what the Rod does not know.`);
        return true;
      }
      s.castX = target.tx;
      s.castY = target.ty;
      s.castT = CAST_TIME;
      say(s, 'You cast the line…');
      return true;
    },
  };
}

/** Each step: is the line ready to come up? */
export function tickCast(state: GameState, dt: number): void {
  if (state.castT <= 0) return;
  state.castT -= dt;
  if (state.castT > 0) return;
  state.castT = 0;
  const map = activeMap(state);
  const { castX: x, castY: y } = state;
  state.castX = -1;
  state.castY = -1;
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return;
  const i = y * map.w + x;
  const res = resourceOf(map.tiles[i]);
  if (res === null) {
    say(state, 'The line comes up empty.');
    return;
  }
  map.tiles[i] = carveTo(map.biome[i] as Biome);
  state.mapRevision++;
  state.carried[res] += 1;
  state.harvested += 1;
  say(state, `Reeled in 1 ${RESOURCE_LABEL[res]} from the deep.`);
}

// -- the fisherman ---------------------------------------------------------------

export function isFisherman(p: Person): boolean {
  return p.role === PersonRole.Fisherman;
}

export function fishingRodPrice(): string {
  return ITEM_COST[ItemKind.FishingRod].map((c) => `${c.amount} ${RESOURCE_LABEL[c.resource]}`).join(', ');
}

export function canAffordRod(state: GameState): boolean {
  return ITEM_COST[ItemKind.FishingRod].every((c) => state.carried[c.resource] >= c.amount);
}

export function buyFishingRod(state: GameState): void {
  if (state.hasFishingRod) return;
  if (!canAffordRod(state)) {
    say(state, `"${fishingRodPrice()}, and she's yours. Good ash."`);
    return;
  }
  for (const c of ITEM_COST[ItemKind.FishingRod]) state.carried[c.resource] -= c.amount;
  state.hasFishingRod = true;
  say(state, 'A fishing rod. Cast from the shore, wading, or the boat — two tiles out, any depth.');
}

// -- the Sounding Line, on foot ------------------------------------------------------

const CROSSING = ['', '', 'skiff water', 'a pitched skiff, no less', 'nothing but the ark'];

/**
 * Facing water with the Sounding Line: how deep, and what it takes to cross.
 * A hint only, like the dredge hint — E passes through.
 */
export function soundingHint(state: GameState): Action | null {
  if (!state.hasSoundingLine) return null;
  if (state.location.kind !== 'overworld' && state.location.kind !== 'dungeon') return null;
  const map = activeMap(state);
  const { tx, ty } = tileUnder(state);
  const fx = tx + dirX(state.player.dir);
  const fy = ty + dirY(state.player.dir);
  if (fx < 0 || fy < 0 || fx >= map.w || fy >= map.h) return null;
  const depth = Math.min(4, depthAt(state, fx, fy));
  if (depth <= 0) return null;
  const crossing = depth === 1 ? (state.hasGaloshes ? 'wade it' : 'galoshes would do') : CROSSING[depth];
  const tile = map.tiles[fy * map.w + fx] as Tile;
  const res = resourceOf(tile);
  return {
    prompt: {
      tile: res === null ? Tile.Water : tile,
      label: `Sounding line: depth ${depth} — ${crossing}${res === null ? '' : `; ${RESOURCE_NAMES[res]} below`}`,
      affordable: true,
    },
  };
}
