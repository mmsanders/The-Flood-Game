/**
 * Wave 5: the rain begins. A dry prologue, one announcement, a steeper ramp
 * to the same day 40 — and the flood reaching underground.
 */

import { describe, expect, it } from 'vitest';
import { FLOOD_DAYS } from '../src/core/config.js';
import {
  DUNGEON_SHALLOW_ROWS,
  RAIN_DAY,
  drownDayForElev,
  dungeonDepthAt,
  dungeonFloodRows,
  isRaining,
  waterLevelAtDay,
} from '../src/core/flood.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { BANNER_TIME, RAIN_TITLE, gloomAt, step } from '../src/game/state.js';
import { IDLE, SMALL, STEP, newGame } from './support/scenario.js';

describe('the prologue', () => {
  it('holds the water at zero until the rain begins', () => {
    for (let day = 0; day < RAIN_DAY; day += 0.25) expect(waterLevelAtDay(day)).toBe(0);
    expect(waterLevelAtDay(RAIN_DAY + 0.1)).toBeGreaterThan(0);
    expect(isRaining(RAIN_DAY - 0.01)).toBe(false);
    expect(isRaining(RAIN_DAY)).toBe(true);
  });

  it('still finishes the job on day forty', () => {
    expect(waterLevelAtDay(FLOOD_DAYS)).toBe(256);
  });

  it('never drowns ground earlier than the old two-day grace did', () => {
    // The ramp is steeper, but it starts later: every tile goes under on the
    // same day or later, so every world the old validation passed still is.
    const oldDrown = (e: number) => 2 + (e / 256) * (FLOOD_DAYS - 2);
    for (let e = 0; e <= 255; e += 5) {
      expect(drownDayForElev(e)).toBeGreaterThanOrEqual(oldDrown(e) - 1e-9);
    }
  });

  it('announces the rain exactly once, when it starts', () => {
    const s = newGame();
    s.elapsed = s.world.params.secondsPerDay * (RAIN_DAY - 0.001);
    step(s, IDLE, STEP);
    expect(s.rainBegun).toBe(false);
    expect(s.banner).toBeNull();

    s.elapsed = s.world.params.secondsPerDay * RAIN_DAY;
    step(s, IDLE, STEP);
    expect(s.rainBegun).toBe(true);
    expect(s.banner?.title).toBe(RAIN_TITLE);

    for (let t = 0; t < BANNER_TIME + 1; t += STEP) step(s, IDLE, STEP);
    expect(s.banner).toBeNull();
    expect(s.rainBegun).toBe(true);
  });

  it('cools the light only after the rain begins', () => {
    expect(gloomAt(0)).toBe(0);
    expect(gloomAt(RAIN_DAY - 0.01)).toBe(0);
    expect(gloomAt(RAIN_DAY + 0.1)).toBeGreaterThan(0);
    expect(gloomAt(RAIN_DAY + 1)).toBe(1);
  });
});

describe('the flood underground', () => {
  const H = 44;

  it('is dry through the prologue', () => {
    expect(dungeonFloodRows(RAIN_DAY - 0.01, 20, H)).toBe(0);
  });

  it('rises steadily and is full the day the mouth drowns', () => {
    let prev = 0;
    for (let day = RAIN_DAY; day <= 20; day += 0.5) {
      const rows = dungeonFloodRows(day, 20, H);
      expect(rows).toBeGreaterThanOrEqual(prev);
      prev = rows;
    }
    expect(dungeonFloodRows(20, 20, H)).toBe(H);
    expect(dungeonFloodRows(30, 20, H)).toBe(H);
  });

  it('fills from the bottom row, with a wadeable band at the waterline', () => {
    const rows = 10;
    expect(dungeonDepthAt(H - 1, H, rows)).toBe(2);
    expect(dungeonDepthAt(H - rows, H, rows)).toBe(1);
    expect(dungeonDepthAt(H - rows + DUNGEON_SHALLOW_ROWS - 1, H, rows)).toBe(1);
    expect(dungeonDepthAt(H - rows - 1, H, rows)).toBe(0);
    expect(dungeonDepthAt(0, H, rows)).toBe(0);
  });

  it('builds every cave in the world as 4x4 rooms with the stairs on top', () => {
    for (const seed of [1, 2, 7, 4242]) {
      const world = generateWorld(seed, SMALL);
      for (const d of world.dungeons) {
        expect(d.roomsX).toBe(4);
        expect(d.roomsY).toBe(4);
        expect(d.rooms.find((r) => r.kind === 'entrance')?.ry).toBe(0);
        expect(d.chestLocked).toBe(false);
      }
    }
  });
});
