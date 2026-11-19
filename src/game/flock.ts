/**
 * Husbandry: leading the flock to the ark on a rope.
 *
 * Walking into a creature no longer puts it aboard. Fiber twists a rope at
 * Noah's tent; the rope leads a *string* of animals, and every one on it
 * slows you down. Two are quick; six are a crawl toward a rising waterline.
 * Bring the string to the ark and they all walk aboard together.
 *
 * You can tie the string anywhere and come back for it — a paddock is just
 * high ground you chose — but tied animals cannot climb, so the flood takes
 * a string left low. The decision is how many to lead at once, which is a
 * real trade, and a full flock is a few trips rather than twenty.
 *
 * Followers trace the path the player actually walked, a breadcrumb trail
 * in a fixed ring buffer, so they never need pathfinding and never walk
 * through a wall the player didn't. Nothing here allocates per step.
 */

import {
  ANIMAL_DEFS,
  ANIMAL_H,
  ANIMAL_W,
  type Animal,
  AnimalDir,
  AnimalStatus,
  flockScoreOf,
} from '../core/animals.js';
import { TILE_PX } from '../core/config.js';
import { PLAYER_TILES_PER_SEC } from '../core/resources.js';
import { Resource, Tile } from '../core/tiles.js';
import { depthAt, RESOURCE_LABEL, say, tileUnder } from './queries.js';
import { type Action, type GameState, PLAYER_H, PLAYER_W } from './types.js';

/** Fiber twisted into one rope, at the tent. Bought once per run. */
export const ROPE_COST = 4;

/** Animals one rope can lead. */
export const MAX_STRING = 6;

/** Speed lost per animal on the rope, and the floor it bottoms out at. */
const SLOW_PER_ANIMAL = 0.09;
const SLOWEST = 0.45;

/** A breadcrumb is dropped every this many pixels the player walks. */
const CRUMB_PX = 2;
/** Crumbs between one animal and the next: about a tile of rope. */
const CRUMBS_PER_GAP = 7;
/** Ring size. Holds the whole string with room to spare. */
export const TRAIL_LEN = 64;

/** Followers catch up at up to this multiple of walking speed. */
const CATCH_UP = 3;
const CATCH_UP_PX = PLAYER_TILES_PER_SEC * TILE_PX * CATCH_UP;

/** Within this many tiles of the ark's site, the string walks aboard. */
const BOARD_RADIUS = 2;

/** Water a led animal cannot survive. Depth 1 it wades beside you. */
const LED_DROWN_DEPTH = 2;

/** Walking speed multiplier for the string the player is leading. */
export function stringSpeedScale(count: number): number {
  return Math.max(SLOWEST, 1 - SLOW_PER_ANIMAL * count);
}

/** Fresh, empty trail state for a new run. */
export function emptyTrail(): Float32Array {
  return new Float32Array(TRAIL_LEN * 2);
}

function animalById(state: GameState, id: number): Animal | null {
  for (const a of state.world.animals) if (a.id === id) return a;
  return null;
}

function playerCentreX(state: GameState): number {
  return state.player.x + PLAYER_W / 2;
}

function playerCentreY(state: GameState): number {
  return state.player.y + PLAYER_H / 2;
}

/** Every crumb at the player's feet: used when the trail starts or jumps. */
export function resetTrail(state: GameState): void {
  const x = playerCentreX(state);
  const y = playerCentreY(state);
  for (let i = 0; i < TRAIL_LEN; i++) {
    state.trail[i * 2] = x;
    state.trail[i * 2 + 1] = y;
  }
  state.trailHead = 0;
}

function dropCrumb(state: GameState): void {
  const x = playerCentreX(state);
  const y = playerCentreY(state);
  const hx = state.trail[state.trailHead * 2];
  const hy = state.trail[state.trailHead * 2 + 1];
  const dx = x - hx;
  const dy = y - hy;
  if (dx * dx + dy * dy < CRUMB_PX * CRUMB_PX) return;
  // A jump of more than a few tiles is a teleport, not a walk: start again
  // rather than drag the string across whatever lay between.
  if (dx * dx + dy * dy > (TILE_PX * 3) ** 2) {
    resetTrail(state);
    return;
  }
  state.trailHead = (state.trailHead + 1) % TRAIL_LEN;
  state.trail[state.trailHead * 2] = x;
  state.trail[state.trailHead * 2 + 1] = y;
}

/**
 * One step of the flock: catch what you walk into, move the string along
 * the trail, drown what the water reaches, and board what reaches the ark.
 */
export function stepHusbandry(state: GameState, dt: number): void {
  if (state.string.length === 0) {
    if (state.location.kind === 'overworld') catchByTouch(state);
    return;
  }

  // Below ground, indoors, or afloat, the string cannot follow: it waits
  // where it stands, tied, until you come back for it.
  if (state.location.kind !== 'overworld' || state.inBoat) {
    tetherString(state);
    say(
      state,
      state.inBoat ? 'The flock will not board a skiff. Tied on the shore.' : 'The flock waits outside, tied.',
    );
    return;
  }

  dropCrumb(state);
  followTrail(state, dt);
  drownLed(state);
  if (nearArk(state)) boardString(state);
  else catchByTouch(state);
}

function followTrail(state: GameState, dt: number): void {
  const reach = CATCH_UP_PX * dt;
  for (let k = 0; k < state.string.length; k++) {
    const a = animalById(state, state.string[k]);
    if (!a) continue;
    const back = Math.min(TRAIL_LEN - 1, (k + 1) * CRUMBS_PER_GAP);
    const c = (state.trailHead - back + TRAIL_LEN) % TRAIL_LEN;
    const tx = state.trail[c * 2] - ANIMAL_W / 2;
    const ty = state.trail[c * 2 + 1] - ANIMAL_H / 2;
    a.prevX = a.x;
    a.prevY = a.y;
    const dx = tx - a.x;
    const dy = ty - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01) {
      const move = Math.min(dist, reach);
      a.x += (dx / dist) * move;
      a.y += (dy / dist) * move;
      a.dir =
        Math.abs(dx) >= Math.abs(dy)
          ? dx < 0
            ? AnimalDir.Left
            : AnimalDir.Right
          : dy < 0
            ? AnimalDir.Up
            : AnimalDir.Down;
      a.anim += dt;
    }
  }
}

function drownLed(state: GameState): void {
  for (let k = state.string.length - 1; k >= 0; k--) {
    const a = animalById(state, state.string[k]);
    if (!a) continue;
    const tx = Math.floor((a.x + ANIMAL_W / 2) / TILE_PX);
    const ty = Math.floor((a.y + ANIMAL_H / 2) / TILE_PX);
    if (depthAt(state, tx, ty) < LED_DROWN_DEPTH) continue;
    a.status = AnimalStatus.Drowned;
    state.string.splice(k, 1);
    say(state, `The rope went slack. The waters took a ${ANIMAL_DEFS[a.kind].name}.`);
  }
}

function nearArk(state: GameState): boolean {
  const { ark } = state.world;
  const { tx, ty } = tileUnder(state);
  return Math.abs(tx - ark.x) <= BOARD_RADIUS && Math.abs(ty - ark.y) <= BOARD_RADIUS;
}

function boardString(state: GameState): void {
  let count = 0;
  let last: Animal | null = null;
  for (const id of state.string) {
    const a = animalById(state, id);
    if (!a) continue;
    a.status = AnimalStatus.Boarded;
    a.prevX = a.x;
    a.prevY = a.y;
    count++;
    last = a;
  }
  state.string.length = 0;
  if (!last) return;

  const score = flockScoreOf(state.world.animals);
  if (count === 1) {
    const def = ANIMAL_DEFS[last.kind];
    const have = score.boarded[last.kind];
    say(
      state,
      have >= 2 ? `A pair of ${def.plural}. Two of every kind.` : `A ${def.name} walks aboard. (${have}/2)`,
    );
  } else {
    say(state, `${count} walk up the ramp and aboard. ${score.pairs} pair${score.pairs === 1 ? '' : 's'} so far.`);
  }
}

/** Walking into a wild or tied animal puts it on the rope, if there is one. */
function catchByTouch(state: GameState): void {
  if (state.inBoat) return;
  const p = state.player;
  for (const a of state.world.animals) {
    if (a.status !== AnimalStatus.Wild && a.status !== AnimalStatus.Tethered) continue;
    if (!touches(a, p.x, p.y)) {
      if (a.status === AnimalStatus.Tethered) a.cooldown = 0;
      continue;
    }
    // A tied animal is picked up by walking back into it, not by standing
    // where you tied it: it waits until you have stepped clear once.
    if (a.status === AnimalStatus.Tethered && a.cooldown > 0) continue;
    const def = ANIMAL_DEFS[a.kind];

    // Somebody's ox is not yours to lead off. Ask at the house.
    if (a.owner >= 0) {
      if (state.messageTimer <= 0) {
        const farm = state.world.homesteads[a.owner];
        say(state, `That's the farmer's ${def.name}${farm ? `, at ${farm.name}` : ''}. Ask at the house.`);
      }
      return;
    }

    if (!state.hasRope) {
      if (state.messageTimer <= 0) {
        say(state, `A ${def.name}. Twist a rope at your tent to lead it (${ROPE_COST} fiber).`);
      }
      return;
    }
    if (state.string.length >= MAX_STRING) {
      if (state.messageTimer <= 0) say(state, 'The rope is full. Take them to the ark.');
      return;
    }

    if (state.string.length === 0) resetTrail(state);
    a.status = AnimalStatus.Led;
    state.string.push(a.id);
    say(state, `A ${def.name} on the rope. (${state.string.length} led)`);
    return;
  }
}

function touches(a: Animal, px: number, py: number): boolean {
  return a.x < px + PLAYER_W && a.x + ANIMAL_W > px && a.y < py + PLAYER_H && a.y + ANIMAL_H > py;
}

/** Tie every animal on the rope where it stands. */
export function tetherString(state: GameState): void {
  for (const id of state.string) {
    const a = animalById(state, id);
    if (!a) continue;
    a.status = AnimalStatus.Tethered;
    a.prevX = a.x;
    a.prevY = a.y;
    // Tied wandering-cooldown doubles as "still touching since tied".
    a.cooldown = 1;
  }
  state.string.length = 0;
}

/** E with a string in hand: tie it here and come back for it. */
export function tetherAction(state: GameState): Action | null {
  if (state.string.length === 0 || state.location.kind !== 'overworld' || state.inBoat) {
    return null;
  }
  const n = state.string.length;
  return {
    prompt: {
      tile: Tile.Grass,
      label: `Tie the string here (${n} animal${n === 1 ? '' : 's'})`,
      affordable: true,
    },
    run: tieHere,
  };
}

function tieHere(state: GameState): boolean {
  const n = state.string.length;
  tetherString(state);
  say(state, `${n === 1 ? 'Tied' : `${n} tied`}. Mind the water — they cannot climb.`);
  return true;
}

/** The tent's counter: twist the rope. */
export function ropePrompt(state: GameState): { label: string; affordable: boolean } | null {
  if (state.hasRope) return null;
  const held = state.carried[Resource.Fiber];
  return {
    label: `Twist a rope — ${ROPE_COST} ${RESOURCE_LABEL[Resource.Fiber]} (you have ${held})`,
    affordable: held >= ROPE_COST,
  };
}

export function twistRope(state: GameState): void {
  if (state.hasRope) return;
  const held = state.carried[Resource.Fiber];
  if (held < ROPE_COST) {
    say(state, `Not enough fiber — ${ROPE_COST} needed, you have ${held}.`);
    return;
  }
  state.carried[Resource.Fiber] -= ROPE_COST;
  state.hasRope = true;
  say(state, `A rope, for leading the flock. Up to ${MAX_STRING} at a time.`);
}
