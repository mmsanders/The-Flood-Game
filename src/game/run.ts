/**
 * The run itself: delivering to the ark, the flood's toll on the player,
 * damage and drowning, the flock, and how the run ends.
 */

import {
  ANIMAL_DEFS,
  animalDef,
  animalOverlaps,
  AnimalStatus,
  type FlockScore,
  flockScoreOf,
  stepAnimals,
} from '../core/animals.js';
import { TILE_PX } from '../core/config.js';
import { ARK_RECIPE } from '../core/resources.js';
import { Resource, RESOURCE_COUNT } from '../core/tiles.js';
import { depthAt, say, waterLevel } from './queries.js';
import { type GameState, PLAYER_H, PLAYER_W } from './types.js';

const INVULN_TIME = 1.2;
const DROWN_INTERVAL = 2.0;

export function deliverToArk(state: GameState): void {
  let moved = 0;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const need = ARK_RECIPE[r as Resource] - state.delivered[r];
    const give = Math.min(need, state.carried[r]);
    if (give > 0) {
      state.delivered[r] += give;
      state.carried[r] -= give;
      moved += give;
    }
  }
  if (moved > 0) say(state, `Delivered ${moved} to the ark.`);
}

export function applyFlood(state: GameState, dt: number): void {
  const p = state.player;
  if (state.inBoat) {
    p.drownTimer = 0;
    return;
  }
  const tx = Math.floor((p.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((p.y + PLAYER_H / 2) / TILE_PX);
  const depth = depthAt(state, tx, ty);

  if (depth <= 0 || (state.hasGaloshes && depth === 1)) {
    p.drownTimer = 0;
    return;
  }

  p.drownTimer += dt;
  if (p.drownTimer >= DROWN_INTERVAL) {
    p.drownTimer -= DROWN_INTERVAL;
    damage(state, 1);
  }
}

export function damage(state: GameState, amount: number): void {
  const p = state.player;
  if (p.invuln > 0) return;
  p.hearts = Math.max(0, p.hearts - amount);
  p.invuln = INVULN_TIME;
}

export function checkEndConditions(state: GameState): void {
  if (state.player.hearts <= 0) {
    state.phase = 'drowned';
    return;
  }

  let complete = true;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    if (state.delivered[r] < ARK_RECIPE[r as Resource]) {
      complete = false;
      break;
    }
  }
  if (complete) state.phase = 'won';
}

/** Fraction of the ark built, from what's been delivered. */
export function arkProgress(state: GameState): number {
  let have = 0;
  let need = 0;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const req = ARK_RECIPE[r as Resource];
    have += Math.min(state.delivered[r], req);
    need += req;
  }
  return need > 0 ? have / need : 0;
}

export function flockScore(state: GameState): FlockScore {
  return flockScoreOf(state.world.animals);
}

export function tickFlock(state: GameState, dt: number): void {
  const map = state.world;
  const player =
    state.location.kind === 'overworld'
      ? { x: state.player.x + PLAYER_W / 2, y: state.player.y + PLAYER_H / 2 }
      : null;

  const { drowned } = stepAnimals(map.animals, map, waterLevel(state), dt, player);
  if (state.messageTimer <= 0) {
    if (drowned.length === 1) {
      const def = animalDef(drowned[0].kind);
      say(state, `The waters took a ${def.name}.`);
    } else if (drowned.length > 1) {
      say(state, `The waters took ${drowned.length} of the flock.`);
    }
  }

  if (state.location.kind !== 'overworld') return;
  const p = state.player;
  for (const a of map.animals) {
    if (!animalOverlaps(a, p.x, p.y, PLAYER_W, PLAYER_H)) continue;
    a.status = AnimalStatus.Boarded;
    const score = flockScoreOf(map.animals);
    const def = ANIMAL_DEFS[a.kind];
    const have = score.boarded[a.kind];
    if (have >= 2) say(state, `A pair of ${def.plural}. Two of every kind.`);
    else say(state, `A ${def.name} comes aboard. (${have}/2)`);
    break;
  }
}
