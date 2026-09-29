/**
 * Replay determinism.
 *
 * Three scripted sessions — wandering and harvesting, sailing a flooding
 * lowland, and working a cave — each thousands of fixed-rate steps long, with
 * a hash of the whole run state taken every 250 steps.
 *
 * The hashes were captured on the code before `state.ts` was split into
 * modules, and committed as snapshots. The split is a pure move, so every
 * checkpoint must match: if a function lands on a different branch, runs in a
 * different order, or loses a side effect, some later checkpoint diverges.
 */

import { describe, expect, it } from 'vitest';
import { Resource } from '../src/core/tiles.js';
import { mulberry32 } from '../src/core/rng.js';
import type { GameState, StepInput } from '../src/game/state.js';
import { depthAt, isBoatableTile, step } from '../src/game/state.js';
import { isWalkable } from '../src/core/tiles.js';
import { STEP, newGame, placeAt } from './support/scenario.js';

const CHECKPOINT = 250;

/** FNV-1a over a string: small, stable, and dependency-free. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function bytes(a: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) {
    h ^= a[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * The run state, canonically. Every field of GameState except the world is
 * serialised as-is (typed arrays by content hash); the world contributes the
 * parts play can mutate — terrain, rooms, and the flock.
 */
function snapshotHash(state: GameState): string {
  const { world, ...rest } = state;
  const replacer = (_k: string, v: unknown) => (v instanceof Uint8Array ? bytes(v) : v);
  const parts = [
    JSON.stringify(rest, replacer),
    bytes(world.tiles),
    world.dungeons.map((d) => bytes(d.tiles)).join('.'),
    world.interiors.map((r) => bytes(r.tiles)).join('.'),
    JSON.stringify(world.animals.map((a) => [a.x, a.y, a.status, a.dir, a.steps, a.cooldown])),
    world.pois.length,
  ];
  return fnv(parts.join('|'));
}

/**
 * A reproducible input tape: hold a direction for a stretch, swing and press
 * E now and then. Seeded, so the same tape plays back identically forever.
 */
function tape(seed: number, steps: number): StepInput[] {
  const rng = mulberry32(seed);
  const out: StepInput[] = [];
  const dirs = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  let held = dirs[0];
  for (let n = 0; n < steps; n++) {
    const newStretch = n % 24 === 0;
    if (newStretch) held = dirs[Math.floor(rng() * dirs.length)];
    out.push({
      moveX: held[0],
      moveY: held[1],
      attackPressed: newStretch ? rng() < 0.45 : rng() < 0.02,
      interactPressed: newStretch ? rng() < 0.3 : rng() < 0.01,
    });
  }
  return out;
}

function play(state: GameState, inputs: StepInput[]): string[] {
  const checkpoints: string[] = [];
  for (let n = 0; n < inputs.length; n++) {
    step(state, inputs[n], STEP);
    if ((n + 1) % CHECKPOINT === 0) checkpoints.push(`${n + 1}:${snapshotHash(state)}`);
  }
  checkpoints.push(`end:${state.phase}:${state.location.kind}:${state.message ?? ''}`);
  return checkpoints;
}

/**
 * Dry, walkable ground with sailable water beside it, scanning up from the
 * south — so the sailing tape actually shoves off instead of wandering inland.
 */
function findShore(s: GameState): { x: number; y: number } {
  const { world } = s;
  for (let y = world.h - 3; y > 2; y--) {
    for (let x = 2; x < world.w - 2; x++) {
      if (!isWalkable(world.tiles[y * world.w + x]) || depthAt(s, x, y) > 0) continue;
      if (isBoatableTile(s, x + 1, y) || isBoatableTile(s, x, y - 1)) return { x, y };
    }
  }
  throw new Error('no shoreline in the replay world');
}

describe('replay determinism', () => {
  it('wandering and harvesting from spawn', () => {
    const s = newGame(4242);
    s.rodTier = 2;
    expect(play(s, tape(1, 5000))).toMatchSnapshot();
  });

  it('sailing a flooding lowland', () => {
    const s = newGame(9001);
    s.hasBoat = true;
    s.haulingBoat = true;
    s.hasDove = true;
    s.carried.fill(40);
    s.elapsed = s.world.params.secondsPerDay * 9;
    const shore = findShore(s);
    placeAt(s, shore.x, shore.y);
    expect(play(s, tape(2, 4000))).toMatchSnapshot();
  });

  it('working a cave with a crowned Rod', () => {
    const s = newGame(777);
    const cave = s.world.dungeons[0];
    s.location = { kind: 'dungeon', dungeonId: 0, interiorId: -1, returnTo: cave.overworldEntrance };
    placeAt(s, cave.stairs.x, cave.stairs.y - 2);
    s.rodTier = 4;
    s.carried[Resource.Wood] = 20;
    expect(play(s, tape(3, 3000))).toMatchSnapshot();
  });

  it('is deterministic run to run', () => {
    const a = newGame(4242);
    const b = newGame(4242);
    const t = tape(7, 1500);
    expect(play(a, t)).toEqual(play(b, t));
  });
});
