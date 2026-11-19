/**
 * Wave 5: husbandry. The flock is led to the ark on a rope, not boarded by
 * touch — a string of animals that slows you, follows your path, can be tied
 * and left, and drowns if you leave it low.
 */

import { describe, expect, it } from 'vitest';
import { ANIMAL_H, ANIMAL_W, type Animal, AnimalStatus } from '../src/core/animals.js';
import { TILE_PX } from '../src/core/config.js';
import { Resource } from '../src/core/tiles.js';
import {
  MAX_STRING,
  PLAYER_H,
  ROPE_COST,
  actionPrompt,
  flockScore,
  step,
  stringSpeedScale,
  type GameState,
} from '../src/game/state.js';
import { twistRope } from '../src/game/flock.js';
import { IDLE, PRESS_E, STEP, clearArea, newGame, placeAt, stage } from './support/scenario.js';

function run(state: GameState, seconds: number, input = IDLE): void {
  for (let t = 0; t < seconds; t += STEP) step(state, input, STEP);
}

/** Put an animal's centre on a tile. */
function putAnimal(a: Animal, tx: number, ty: number): void {
  a.x = tx * TILE_PX + (TILE_PX - ANIMAL_W) / 2;
  a.y = ty * TILE_PX + (TILE_PX - ANIMAL_H) / 2;
  a.prevX = a.x;
  a.prevY = a.y;
}

/** A staged game with a rope and `n` wild animals parked out of the way. */
function withRope(n = 0): { s: GameState; at: { x: number; y: number }; herd: Animal[] } {
  const s = newGame();
  const at = stage(s);
  s.hasRope = true;
  const herd = s.world.animals.slice(0, n);
  // Everything else far from the stage, so nothing wanders into the test.
  for (const a of s.world.animals) {
    if (herd.includes(a)) continue;
    a.status = AnimalStatus.Drowned;
  }
  return { s, at, herd };
}

/** Walk the player onto each animal in turn, catching it. */
function catchAll(s: GameState, at: { x: number; y: number }, herd: Animal[]): void {
  for (const a of herd) {
    putAnimal(a, at.x, at.y);
    step(s, IDLE, STEP);
  }
}

describe('husbandry: the rope', () => {
  it('is twisted from fiber, once', () => {
    const s = newGame();
    s.carried[Resource.Fiber] = ROPE_COST + 1;
    twistRope(s);
    expect(s.hasRope).toBe(true);
    expect(s.carried[Resource.Fiber]).toBe(1);
    twistRope(s);
    expect(s.carried[Resource.Fiber]).toBe(1);
  });

  it('is needed before anything can be led', () => {
    const { s, at, herd } = withRope(1);
    s.hasRope = false;
    putAnimal(herd[0], at.x, at.y);
    step(s, IDLE, STEP);
    expect(herd[0].status).toBe(AnimalStatus.Wild);
    expect(s.string).toEqual([]);
  });

  it('puts a creature you walk into on the rope', () => {
    const { s, at, herd } = withRope(1);
    catchAll(s, at, herd);
    expect(herd[0].status).toBe(AnimalStatus.Led);
    expect(s.string).toEqual([herd[0].id]);
    expect(flockScore(s).inHand).toBe(1);
    expect(flockScore(s).rescued).toBe(0);
  });

  it('leads at most a full string', () => {
    const { s, at, herd } = withRope(MAX_STRING + 1);
    catchAll(s, at, herd.slice(0, MAX_STRING));
    s.messageTimer = 0;
    catchAll(s, at, herd.slice(MAX_STRING));
    expect(s.string.length).toBe(MAX_STRING);
    expect(herd[MAX_STRING].status).toBe(AnimalStatus.Wild);
    expect(s.message).toMatch(/full/);
  });
});

describe('husbandry: leading a string', () => {
  it('slows you for every animal on it, down to a floor', () => {
    expect(stringSpeedScale(0)).toBe(1);
    expect(stringSpeedScale(2)).toBeGreaterThan(stringSpeedScale(6));
    expect(stringSpeedScale(6)).toBeLessThan(0.6);
    expect(stringSpeedScale(50)).toBeGreaterThan(0.4);
  });

  it('walks you measurably slower with a string than without', () => {
    const right = { moveX: 1, moveY: 0, attackPressed: false };
    const free = withRope(0);
    clearArea(free.s, free.at.x + 4, free.at.y, 5);
    const x0 = free.s.player.x;
    run(free.s, 0.5, right);
    const freeDist = free.s.player.x - x0;

    const led = withRope(4);
    clearArea(led.s, led.at.x + 4, led.at.y, 5);
    catchAll(led.s, led.at, led.herd);
    const x1 = led.s.player.x;
    run(led.s, 0.5, right);
    const ledDist = led.s.player.x - x1;

    expect(ledDist).toBeLessThan(freeDist * 0.8);
    expect(ledDist).toBeGreaterThan(0);
  });

  it('follows behind you, in order, along the path you walked', () => {
    const { s, at, herd } = withRope(3);
    clearArea(s, at.x + 4, at.y, 5);
    catchAll(s, at, herd);
    run(s, 2.5, { moveX: 1, moveY: 0, attackPressed: false });

    const px = s.player.x;
    let prev = px;
    for (const a of herd) {
      expect(a.x).toBeLessThan(prev);
      expect(Math.abs(a.y + ANIMAL_H / 2 - (s.player.y + PLAYER_H / 2))).toBeLessThan(4);
      prev = a.x;
    }
    // A string, not a crowd: about a tile of rope between each.
    expect(px - herd[2].x).toBeGreaterThan(TILE_PX * 2);
    expect(px - herd[2].x).toBeLessThan(TILE_PX * 6);
  });

  it('walks the whole string aboard at the ark', () => {
    const { s, herd } = withRope(2);
    const { ark } = s.world;
    clearArea(s, ark.x, ark.y + 4, 2);
    placeAt(s, ark.x, ark.y + 4);
    catchAll(s, { x: ark.x, y: ark.y + 4 }, herd);
    expect(s.string.length).toBe(2);

    placeAt(s, ark.x, ark.y + 1);
    step(s, IDLE, STEP);

    for (const a of herd) expect(a.status).toBe(AnimalStatus.Boarded);
    expect(s.string).toEqual([]);
    expect(flockScore(s).rescued).toBe(2);
  });
});

describe('husbandry: tying the string', () => {
  it('ties it with E, where it stands, and it stays put', () => {
    const { s, at, herd } = withRope(2);
    catchAll(s, at, herd);
    expect(actionPrompt(s)?.label).toMatch(/Tie the string/);

    step(s, PRESS_E, STEP);
    for (const a of herd) expect(a.status).toBe(AnimalStatus.Tethered);
    expect(s.string).toEqual([]);

    const before = herd.map((a) => [a.x, a.y]);
    run(s, 3);
    expect(herd.map((a) => [a.x, a.y])).toEqual(before);
  });

  it('picks a tied animal back up when you walk into it', () => {
    const { s, at, herd } = withRope(1);
    catchAll(s, at, herd);
    step(s, PRESS_E, STEP);
    expect(herd[0].status).toBe(AnimalStatus.Tethered);

    placeAt(s, at.x + 3, at.y);
    step(s, IDLE, STEP);
    putAnimal(herd[0], at.x + 3, at.y);
    step(s, IDLE, STEP);
    expect(herd[0].status).toBe(AnimalStatus.Led);
  });

  it('drowns a tied animal when the water reaches it', () => {
    const { s, at, herd } = withRope(1);
    catchAll(s, at, herd);
    step(s, PRESS_E, STEP);
    const t = { x: Math.floor((herd[0].x + ANIMAL_W / 2) / TILE_PX), y: Math.floor((herd[0].y + ANIMAL_H / 2) / TILE_PX) };
    s.world.elev[t.y * s.world.w + t.x] = 0;
    placeAt(s, at.x + 4, at.y);
    s.elapsed = s.world.params.secondsPerDay * 20;
    run(s, 0.1);
    expect(herd[0].status).toBe(AnimalStatus.Drowned);
  });

  it('ties the string by itself when you go below ground', () => {
    const { s, at, herd } = withRope(2);
    catchAll(s, at, herd);
    const cave = s.world.dungeons[0];
    s.location = { kind: 'dungeon', dungeonId: 0, interiorId: -1, returnTo: cave.overworldEntrance };
    placeAt(s, cave.stairs.x, cave.stairs.y + 2);
    step(s, IDLE, STEP);
    for (const a of herd) expect(a.status).toBe(AnimalStatus.Tethered);
    expect(s.string).toEqual([]);
  });
});

describe('husbandry: the flood and the rope', () => {
  it('loses a led animal the water closes over', () => {
    const { s, at, herd } = withRope(1);
    catchAll(s, at, herd);
    const a = herd[0];
    // Pull it a tile east and drown that tile deep: over its head, not yours.
    putAnimal(a, at.x + 1, at.y);
    s.world.elev[at.y * s.world.w + at.x + 1] = 0;
    s.elapsed = s.world.params.secondsPerDay * 20;
    step(s, IDLE, STEP);
    expect(a.status).toBe(AnimalStatus.Drowned);
    expect(s.string).toEqual([]);
  });
});
