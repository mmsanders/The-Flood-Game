/**
 * Wave 6: the endless sand. A gate in the far south wall, a screen that loops
 * every way but back, the stranger's eight-step path, and the oasis.
 */

import { describe, expect, it } from 'vitest';
import { PANEL_H, PANEL_W } from '../src/core/config.js';
import { COMPASS_DX, COMPASS_DY, Compass, DESERT_CODE_LEN } from '../src/core/desert.js';
import { drownDayForElev } from '../src/core/flood.js';
import { InteriorKind } from '../src/core/interior.js';
import { Tile, isWalkable } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { SAND_LINE } from '../src/game/desert.js';
import { type GameState, actionPrompt, activeMap, step } from '../src/game/state.js';
import { IDLE, PRESS_E, SMALL, STEP, newGame, placeAt } from './support/scenario.js';

function inputFor(c: Compass) {
  return { moveX: COMPASS_DX[c], moveY: COMPASS_DY[c], attackPressed: false };
}

/** Walk one way until a screen slide starts (or the location changes), then wait it out. */
function walk(s: GameState, c: Compass): void {
  const from = s.location.kind;
  for (let t = 0; t < 8 && s.camera.scroll === 0 && s.location.kind === from; t += STEP) {
    step(s, inputFor(c), STEP);
  }
  for (let t = 0; t < 2 && s.camera.scroll > 0; t += STEP) step(s, IDLE, STEP);
}

/** A fresh game standing on the gate, facing the sand. */
function atGate(): GameState {
  const s = newGame();
  const d = s.world.desert;
  if (!d) throw new Error('no desert');
  const wall = d.gate.side === 1 ? s.world.w - 1 : 0;
  placeAt(s, wall, d.gate.y0 + 1);
  return s;
}

function outward(s: GameState): Compass {
  return s.world.desert?.gate.side === 1 ? Compass.East : Compass.West;
}

function enter(s: GameState): void {
  walk(s, outward(s));
}

describe('desert: the gate', () => {
  const seeds = [1, 2, 3, 7, 4242, 20260830];

  it('opens a sandy gap in the far south wall of every world', () => {
    for (const seed of seeds) {
      const world = generateWorld(seed, SMALL);
      const d = world.desert;
      expect(d, `seed ${seed}`).not.toBeNull();
      if (!d) continue;
      const wall = d.gate.side === 1 ? world.w - 1 : 0;
      expect(d.gate.y0).toBeGreaterThanOrEqual(world.h - PANEL_H * 2);
      for (let y = d.gate.y0; y <= d.gate.y1; y++) {
        expect(world.tiles[y * world.w + wall]).toBe(Tile.Sand);
        expect(isWalkable(world.tiles[y * world.w + wall - d.gate.side])).toBe(true);
        // The gate floods with the ground behind it, not with the wall.
        expect(world.elev[y * world.w + wall]).toBe(world.elev[y * world.w + wall - d.gate.side]);
      }
      expect(world.stats.connected, `seed ${seed}`).toBe(true);
    }
  });

  it('is an early secret: the gate drowns within days of the rain', () => {
    for (const seed of seeds) {
      const world = generateWorld(seed, SMALL);
      const d = world.desert;
      if (!d) continue;
      const wall = d.gate.side === 1 ? world.w - 1 : 0;
      expect(drownDayForElev(world.elev[d.gate.y1 * world.w + wall])).toBeLessThan(16);
    }
  });

  it('gives an eight-step path that never says "back"', () => {
    for (const seed of seeds) {
      const d = generateWorld(seed, SMALL).desert;
      if (!d) continue;
      expect(d.gate.code).toHaveLength(DESERT_CODE_LEN);
      expect(d.gate.code).not.toContain(d.gate.back);
    }
  });

  it('lets you walk off the edge only through the gate', () => {
    const s = newGame();
    const d = s.world.desert!;
    const wall = d.gate.side === 1 ? s.world.w - 1 : 0;
    // Six rows above the gate the wall is rock; even standing beside it you stay put.
    placeAt(s, wall - d.gate.side, d.gate.y0 - 6);
    walk(s, outward(s));
    expect(s.location.kind).toBe('overworld');

    const g = atGate();
    enter(g);
    expect(g.location.kind).toBe('desert');
    expect(g.message).toBe(SAND_LINE);
  });

  it('is shut once the flood reaches it', () => {
    const s = atGate();
    s.elapsed = s.world.params.secondsPerDay * 30;
    enter(s);
    expect(s.location.kind).toBe('overworld');
  });
});

describe('desert: the endless sand', () => {
  it('loops every way but back onto the same screen', () => {
    const s = atGate();
    enter(s);
    const back = s.world.desert!.gate.back;
    for (const c of [Compass.North, Compass.East, Compass.South, Compass.West]) {
      if (c === back) continue;
      walk(s, c);
      expect(s.location.kind).toBe('desert');
      expect([s.camera.panelX, s.camera.panelY]).toEqual([1, 1]);
      const cx = s.player.x / 16;
      const cy = s.player.y / 16;
      expect(cx).toBeGreaterThanOrEqual(PANEL_W - 1);
      expect(cx).toBeLessThan(PANEL_W * 2);
      expect(cy).toBeGreaterThanOrEqual(PANEL_H - 1);
      expect(cy).toBeLessThan(PANEL_H * 2);
    }
  });

  it('builds the sand from nine identical panels', () => {
    const sand = newGame().world.desert!.sand;
    for (let py = 0; py < 3; py++) {
      for (let px = 0; px < 3; px++) {
        for (let y = 0; y < PANEL_H; y++) {
          for (let x = 0; x < PANEL_W; x++) {
            const a = sand.tiles[(PANEL_H + y) * sand.w + PANEL_W + x];
            expect(sand.tiles[(py * PANEL_H + y) * sand.w + px * PANEL_W + x]).toBe(a);
          }
        }
      }
    }
  });

  it('lets you out the way you came, at the gate', () => {
    const s = atGate();
    const d = s.world.desert!;
    enter(s);
    walk(s, Compass.North);
    walk(s, d.gate.back);
    expect(s.location.kind).toBe('overworld');
    const wall = d.gate.side === 1 ? s.world.w - 1 : 0;
    expect(Math.floor((s.player.x + 5) / 16)).toBe(wall);
  });

  it('starts the count again after a wrong step', () => {
    const s = atGate();
    const { code, back } = s.world.desert!.gate;
    enter(s);
    walk(s, code[0]);
    walk(s, code[1]);
    expect(s.desertSteps).toBeGreaterThanOrEqual(2);
    const wrong = [Compass.North, Compass.East, Compass.South, Compass.West].find(
      (c) => c !== back && c !== code[2] && c !== code[0],
    );
    if (wrong === undefined) return;
    walk(s, wrong);
    expect(s.desertSteps).toBe(0);
  });

  it('walks the stranger\'s path to the oasis and its heart', () => {
    const s = atGate();
    const d = s.world.desert!;
    enter(s);
    for (const c of d.gate.code) walk(s, c);
    expect(s.inOasis).toBe(true);
    expect(activeMap(s)).toBe(d.oasis);

    const hearts = s.player.maxHearts;
    placeAt(s, d.heart.x, d.heart.y);
    step(s, IDLE, STEP);
    expect(s.player.maxHearts).toBe(hearts + 1);

    // Any way out of the oasis is the way home — south, past the pool.
    walk(s, Compass.South);
    expect(s.location.kind).toBe('overworld');
  });
});

describe('desert: the stranger', () => {
  function atStranger(): GameState {
    const s = newGame();
    const room = s.world.interiors.find((r) => r.kind === InteriorKind.Carpenter)!;
    s.location = { kind: 'interior', dungeonId: -1, interiorId: room.id, returnTo: room.overworldEntrance };
    placeAt(s, room.lore!.x, room.lore!.y);
    return s;
  }

  it('sits in the carpenter\'s workshop', () => {
    const s = atStranger();
    expect(actionPrompt(s)?.label).toMatch(/stranger/);
  });

  it('gives the path, letter by letter', () => {
    const s = atStranger();
    step(s, PRESS_E, STEP);
    const letters = s.world.desert!.gate.code.map((c) => 'NESW'[c]).join(', ');
    expect(s.banner?.title).toBe(letters);
  });

  it('has nothing to give once the sand is under the sea', () => {
    const s = atStranger();
    s.elapsed = s.world.params.secondsPerDay * 30;
    step(s, IDLE, STEP);
    s.banner = null;
    step(s, PRESS_E, STEP);
    expect(s.banner).toBeNull();
    expect(s.message).toMatch(/under the sea/);
  });
});
