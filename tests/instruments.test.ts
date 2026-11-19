/**
 * Wave 8: instruments that earn their place. The Lodestone's eight-way
 * needle, the Sounding Line's word on the water, the fishing rod, and the
 * Rod dredging ankle-deep water in galoshes.
 */

import { describe, expect, it } from 'vitest';
import { FLOOD_RISE_PER_DAY, FLOOD_GRACE_DAYS } from '../src/core/flood.js';
import { Resource, Tile } from '../src/core/tiles.js';
import { PersonRole } from '../src/core/world.js';
import { CAST_TIME, castTarget } from '../src/game/fishing.js';
import { mapPosition } from '../src/game/fullmap.js';
import { Dir, type GameState, OCTANT_NAME, actionPrompt, lodestoneOctant, step } from '../src/game/state.js';
import { rumours } from '../src/game/town.js';
import { IDLE, PRESS_E, STEP, newGame, placeAt, setTile, stage } from './support/scenario.js';

const SWING = { moveX: 0, moveY: 0, attackPressed: true };

/** A level for the water so that elevation `e` sits `depth` deep. */
function floodTo(s: GameState, depth: number): void {
  // Water at 10 + depth risers above ground at elevation 10.
  const level = 10 + depth * FLOOD_RISE_PER_DAY - FLOOD_RISE_PER_DAY / 2;
  s.elapsed = s.world.params.secondsPerDay * (FLOOD_GRACE_DAYS + level / FLOOD_RISE_PER_DAY);
}

/** Staged on dry ground, facing east at a strip of low land to flood. */
function atShore(): { s: GameState; at: { x: number; y: number } } {
  const s = newGame();
  const at = stage(s);
  for (let dx = 1; dx <= 3; dx++) s.world.elev[at.y * s.world.w + at.x + dx] = 10;
  s.player.dir = Dir.Right;
  return { s, at };
}

describe('the Lodestone needle', () => {
  it('points eight ways to the ark, with no distance', () => {
    const s = newGame();
    s.hasLodestone = true;
    const { ark } = s.world;
    const cases: [number, number, string][] = [
      [0, 10, 'north'],
      [-10, 10, 'north-east'],
      [-10, 0, 'east'],
      [-10, -10, 'south-east'],
      [0, -10, 'south'],
      [10, -10, 'south-west'],
      [10, 0, 'west'],
      [10, 10, 'north-west'],
    ];
    for (const [dx, dy, name] of cases) {
      placeAt(s, ark.x + dx, ark.y + dy);
      expect(OCTANT_NAME[lodestoneOctant(s)!], `${dx},${dy}`).toBe(name);
    }
    // Same way, further off: same needle.
    placeAt(s, ark.x, ark.y + 40);
    expect(OCTANT_NAME[lodestoneOctant(s)!]).toBe('north');
  });

  it('is silent without the stone', () => {
    expect(lodestoneOctant(newGame())).toBeNull();
  });
});

describe('the full-screen map', () => {
  it('puts Noah at his own door when he is indoors', () => {
    const s = newGame();
    const room = s.world.interiors[0];
    s.location = { kind: 'interior', dungeonId: -1, interiorId: room.id, returnTo: room.overworldEntrance };
    expect(mapPosition(s)).toEqual(room.overworldEntrance);
  });
});

describe('the Sounding Line on foot', () => {
  it('reads depth and what it takes to cross, from the shore', () => {
    const { s } = atShore();
    s.hasSoundingLine = true;
    floodTo(s, 2);
    expect(actionPrompt(s)?.label).toMatch(/^Sounding line: depth 2 — skiff water/);
    floodTo(s, 1);
    expect(actionPrompt(s)?.label).toMatch(/depth 1 — galoshes would do/);
    s.hasGaloshes = true;
    expect(actionPrompt(s)?.label).toMatch(/depth 1 — wade it/);
  });

  it('names what lies on the bottom', () => {
    const { s, at } = atShore();
    s.hasSoundingLine = true;
    setTile(s, at.x + 1, at.y, Tile.Flax);
    s.world.elev[at.y * s.world.w + at.x + 1] = 10;
    floodTo(s, 3);
    expect(actionPrompt(s)?.label).toMatch(/; \w+ below$/);
  });

  it('says nothing without the line', () => {
    const { s } = atShore();
    floodTo(s, 2);
    expect(actionPrompt(s)?.label ?? '').not.toMatch(/Sounding/);
  });
});

describe('the fishing rod', () => {
  function withNode(depth: number, dist: number): { s: GameState; at: { x: number; y: number } } {
    const { s, at } = atShore();
    s.hasFishingRod = true;
    setTile(s, at.x + dist, at.y, Tile.Flax);
    s.world.elev[at.y * s.world.w + at.x + dist] = 10;
    floodTo(s, depth);
    return { s, at };
  }

  it('casts from the shore, two tiles out, at any depth', () => {
    const { s, at } = withNode(4, 2);
    expect(castTarget(s)).toEqual({ tx: at.x + 2, ty: at.y });
    expect(actionPrompt(s)?.label).toMatch(/^Cast for the/);
    const before = s.carried[Resource.Fiber];
    step(s, PRESS_E, STEP);
    expect(s.castT).toBeGreaterThan(0);

    // Noah holds still while the line is out.
    const x = s.player.x;
    for (let t = 0; t < CAST_TIME / 2; t += STEP) step(s, { moveX: -1, moveY: 0, attackPressed: false }, STEP);
    expect(s.player.x).toBe(x);

    for (let t = 0; t < CAST_TIME; t += STEP) step(s, IDLE, STEP);
    expect(s.carried[Resource.Fiber]).toBe(before + 1);
    expect(s.world.tiles[at.y * s.world.w + at.x + 2]).not.toBe(Tile.Flax);
  });

  it('cannot reach three tiles out', () => {
    const { s } = withNode(3, 3);
    expect(castTarget(s)).toBeNull();
  });

  it('brings up only what the Rod knows', () => {
    const { s, at } = atShore();
    s.hasFishingRod = true;
    setTile(s, at.x + 1, at.y, Tile.PitchSeep);
    s.world.elev[at.y * s.world.w + at.x + 1] = 10;
    floodTo(s, 3);
    expect(actionPrompt(s)?.affordable).toBe(false);
    step(s, PRESS_E, STEP);
    expect(s.castT).toBe(0);
  });

  it('is sold by the fisherman at the slipway', () => {
    const s = newGame();
    const fisher = s.world.people.find((p) => p.role === PersonRole.Fisherman)!;
    expect(fisher).toBeDefined();
    placeAt(s, Math.floor((fisher.x + 4) / 16), Math.floor((fisher.y + 6) / 16));
    expect(actionPrompt(s)?.label).toMatch(/^Buy a fishing rod/);
    s.carried[Resource.Fiber] = 6;
    s.carried[Resource.Wood] = 4;
    step(s, PRESS_E, STEP);
    expect(s.hasFishingRod).toBe(true);
    expect(s.carried[Resource.Fiber]).toBe(0);
    expect(s.carried[Resource.Wood]).toBe(0);
  });

  it('is worth a rumour at the tavern until you have one', () => {
    const s = newGame();
    expect(rumours(s, s.world.spawn).some((r) => r.includes('fisherman'))).toBe(true);
    s.hasFishingRod = true;
    expect(rumours(s, s.world.spawn).some((r) => r.includes('fisherman'))).toBe(false);
  });
});

describe('the Rod in galoshes', () => {
  it('dredges ankle-deep water on foot', () => {
    const { s, at } = atShore();
    setTile(s, at.x + 1, at.y, Tile.Flax);
    s.world.elev[at.y * s.world.w + at.x + 1] = 10;
    floodTo(s, 1);
    const before = s.carried[Resource.Fiber];

    step(s, SWING, STEP);
    for (let t = 0; t < 0.5; t += STEP) step(s, IDLE, STEP);
    expect(s.carried[Resource.Fiber]).toBe(before);

    s.hasGaloshes = true;
    s.messageTimer = 0;
    step(s, SWING, STEP);
    for (let t = 0; t < 0.5; t += STEP) step(s, IDLE, STEP);
    expect(s.carried[Resource.Fiber]).toBeGreaterThan(before);
  });

  it('still cannot reach two deep on foot', () => {
    const { s, at } = atShore();
    s.hasGaloshes = true;
    setTile(s, at.x + 1, at.y, Tile.Flax);
    s.world.elev[at.y * s.world.w + at.x + 1] = 10;
    floodTo(s, 2);
    const before = s.carried[Resource.Fiber];
    step(s, SWING, STEP);
    for (let t = 0; t < 0.5; t += STEP) step(s, IDLE, STEP);
    expect(s.carried[Resource.Fiber]).toBe(before);
  });
});
