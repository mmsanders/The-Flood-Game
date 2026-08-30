import { describe, expect, it } from 'vitest';
import { FLOOD_DAYS, withParams } from '../src/core/config.js';
import {
  FLOOD_GRACE_DAYS,
  drownDayForElev,
  isPassable,
  isSubmerged,
  waterLevelAtDay,
  waterLevelAtSeconds,
} from '../src/core/flood.js';
import { generateWorld } from '../src/core/worldgen/index.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const SEEDS = Array.from({ length: 16 }, (_, i) => i * 6151 + 17);

describe('flood', () => {
  it('starts dry and ends fully submerged', () => {
    const world = generateWorld(4242, SMALL);

    const atStart = countSubmerged(world, waterLevelAtDay(0));
    expect(atStart).toBe(0);

    const atEnd = countSubmerged(world, waterLevelAtDay(FLOOD_DAYS));
    expect(atEnd).toBe(world.w * world.h);
  });

  it('rises monotonically and never un-floods a tile', () => {
    const world = generateWorld(99, SMALL);
    let previous = -1;

    for (let day = 0; day <= FLOOD_DAYS; day += 0.5) {
      const level = waterLevelAtDay(day);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }

    // Any tile submerged at day d stays submerged at every later day.
    let prevCount = -1;
    for (let day = 0; day <= FLOOD_DAYS; day++) {
      const count = countSubmerged(world, waterLevelAtDay(day));
      expect(count).toBeGreaterThanOrEqual(prevCount);
      prevCount = count;
    }
  });

  it('clamps outside the forty days', () => {
    expect(waterLevelAtDay(-5)).toBe(0);
    expect(waterLevelAtDay(FLOOD_DAYS + 10)).toBe(waterLevelAtDay(FLOOD_DAYS));
  });

  it('holds the water back through the grace period', () => {
    // "After some short initial time, water will start filling the world."
    expect(waterLevelAtDay(0)).toBe(0);
    expect(waterLevelAtDay(FLOOD_GRACE_DAYS - 0.01)).toBe(0);
    expect(waterLevelAtDay(FLOOD_GRACE_DAYS + 0.5)).toBeGreaterThan(0);
  });

  it('leaves no ground drowning before the grace period ends', () => {
    const world = generateWorld(4242, SMALL);
    for (const e of world.elev) {
      expect(drownDayForElev(e)).toBeGreaterThanOrEqual(FLOOD_GRACE_DAYS);
    }
  });

  it('gives the player room to breathe at spawn', () => {
    // A player who starts on ground that drowns almost immediately has lost
    // before they understood the rules. Every seed must beat that bar.
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      const spawnDrown = drownDayForElev(
        world.elev[world.spawn.y * world.w + world.spawn.x],
      );
      expect(spawnDrown, `seed ${seed} drowns spawn on day ${spawnDrown}`).toBeGreaterThan(6);
    }
  });

  it('drowns the south before the north', () => {
    const world = generateWorld(1234, SMALL);
    const rowDrownMean = (y: number): number => {
      let sum = 0;
      for (let x = 0; x < world.w; x++) sum += drownDayForElev(world.elev[y * world.w + x]);
      return sum / world.w;
    };
    expect(rowDrownMean(0)).toBeGreaterThan(rowDrownMean(world.h - 1) + 8);
  });

  it('drowns roughly one map row per day', () => {
    const world = generateWorld(1234, SMALL);
    // Mean drown day across the map should land near the middle of the run,
    // which is what "one row per day" amounts to over a linear ramp.
    let sum = 0;
    for (const e of world.elev) sum += drownDayForElev(e);
    const mean = sum / world.elev.length;
    expect(mean).toBeGreaterThan(FLOOD_DAYS * 0.3);
    expect(mean).toBeLessThan(FLOOD_DAYS * 0.7);
  });

  it('converts elapsed seconds into water height', () => {
    const perDay = 90;
    expect(waterLevelAtSeconds(0, perDay)).toBe(0);
    expect(waterLevelAtSeconds(perDay * FLOOD_DAYS, perDay)).toBe(waterLevelAtDay(FLOOD_DAYS));
    expect(waterLevelAtSeconds(perDay * 20, perDay)).toBeCloseTo(waterLevelAtDay(20));
  });

  it('makes submerged ground impassable even where terrain is walkable', () => {
    const world = generateWorld(31, SMALL);
    const { x, y } = world.spawn;
    expect(isPassable(world, x, y, waterLevelAtDay(0))).toBe(true);
    expect(isPassable(world, x, y, waterLevelAtDay(FLOOD_DAYS))).toBe(false);
  });

  it('treats out-of-bounds as impassable', () => {
    const world = generateWorld(31, SMALL);
    expect(isPassable(world, -1, 0, 0)).toBe(false);
    expect(isPassable(world, 0, world.h, 0)).toBe(false);
  });

  it('drowns the spawn before the ark site', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const world = generateWorld(seed, SMALL);
      const spawnDrown = drownDayForElev(world.elev[world.spawn.y * world.w + world.spawn.x]);
      const arkDrown = drownDayForElev(world.elev[world.ark.y * world.w + world.ark.x]);
      expect(arkDrown).toBeGreaterThan(spawnDrown);
    }
  });
});

function countSubmerged(
  world: ReturnType<typeof generateWorld>,
  level: number,
): number {
  let n = 0;
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) if (isSubmerged(world, x, y, level)) n++;
  }
  return n;
}
