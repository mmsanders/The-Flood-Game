import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, withParams } from '../src/core/config.js';
import { drownDayForElev } from '../src/core/flood.js';
import {
  ARK_RECIPE,
  arrivalTimes,
  buildProgress,
  checkSolvable,
  recipeMet,
} from '../src/core/resources.js';
import { RESOURCE_COUNT, Resource } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const SEEDS = Array.from({ length: 20 }, (_, i) => i * 4517 + 3);

/**
 * Solvability is only meaningful at the shipping dimensions: the ark recipe is
 * a fixed cost, so a quarter-size test map genuinely cannot supply it. These
 * run against DEFAULT_PARAMS (~60ms per world) rather than the small map used
 * for the structural suites.
 */
const SHIPPING = DEFAULT_PARAMS;

describe('resources: the ark recipe', () => {
  it('is unmet with nothing and met with exactly enough', () => {
    expect(recipeMet([0, 0, 0, 0])).toBe(false);
    const exact = [
      ARK_RECIPE[Resource.Fiber],
      ARK_RECIPE[Resource.Wood],
      ARK_RECIPE[Resource.Stone],
      ARK_RECIPE[Resource.Pitch],
    ];
    expect(recipeMet(exact)).toBe(true);
    exact[Resource.Pitch]--;
    expect(recipeMet(exact)).toBe(false);
  });

  it('reports progress from nothing to complete', () => {
    expect(buildProgress([0, 0, 0, 0])).toBe(0);
    expect(
      buildProgress([
        ARK_RECIPE[Resource.Fiber],
        ARK_RECIPE[Resource.Wood],
        ARK_RECIPE[Resource.Stone],
        ARK_RECIPE[Resource.Pitch],
      ]),
    ).toBe(1);
  });

  it('does not let a surplus of one resource inflate progress', () => {
    const hoard = [999, 0, 0, 0];
    const fair = ARK_RECIPE[Resource.Fiber] / totalRequired();
    expect(buildProgress(hoard)).toBeCloseTo(fair, 5);
  });
});

describe('resources: solvability', () => {
  it.each(SEEDS)('seed %i generates a winnable world', (seed) => {
    const world = generateWorld(seed, SHIPPING);
    expect(world.stats.solvable, world.stats.problems.join('; ')).toBe(true);
  });

  it('finds every resource kind present on the map', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const world = generateWorld(seed, SHIPPING);
      for (let r = 0; r < RESOURCE_COUNT; r++) {
        expect(world.stats.resourceNodes[r], `resource ${r} absent on seed ${seed}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('never reports more reachable nodes than exist', () => {
    const world = generateWorld(4242, SHIPPING);
    const report = checkSolvable(
      world.tiles,
      world.elev,
      world.w,
      world.h,
      world.spawn,
      SHIPPING,
    );
    for (let r = 0; r < RESOURCE_COUNT; r++) {
      expect(report.reachable[r]).toBeLessThanOrEqual(report.total[r]);
    }
  });

  it('rejects a world whose resources all drown before the player arrives', () => {
    const world = generateWorld(4242, SMALL);
    // A punishing day length: the flood outruns the player almost immediately.
    const hostile = withParams({ ...SMALL, secondsPerDay: 0.05 });
    const report = checkSolvable(
      world.tiles,
      world.elev,
      world.w,
      world.h,
      world.spawn,
      hostile,
    );
    expect(report.solvable).toBe(false);
    expect(report.problems.length).toBeGreaterThan(0);
  });
});

describe('resources: time-expanded reachability', () => {
  it('reaches the spawn tile at time zero', () => {
    const world = generateWorld(31, SMALL);
    const arrival = arrivalTimes(
      world.tiles,
      world.elev,
      world.w,
      world.h,
      world.spawn,
      SMALL,
    );
    expect(arrival[world.spawn.y * world.w + world.spawn.x]).toBe(0);
  });

  it('takes longer to reach ground further from spawn', () => {
    const world = generateWorld(31, SMALL);
    const arrival = arrivalTimes(
      world.tiles,
      world.elev,
      world.w,
      world.h,
      world.spawn,
      SMALL,
    );
    const arkTime = arrival[world.ark.y * world.w + world.ark.x];
    expect(arkTime).toBeGreaterThan(0);
    expect(arkTime).toBeLessThan(40);
  });

  it('never lets the player arrive somewhere already underwater', () => {
    const world = generateWorld(77, SMALL);
    const arrival = arrivalTimes(
      world.tiles,
      world.elev,
      world.w,
      world.h,
      world.spawn,
      SMALL,
    );
    for (let i = 0; i < arrival.length; i++) {
      if (arrival[i] === Infinity) continue;
      const drown = drownDayForElev(world.elev[i]);
      expect(drown, `tile ${i} reached after it drowned`).toBeGreaterThan(arrival[i]);
    }
  });
});

describe('resources: the full-size map', () => {
  it('generates a connected, winnable world at the shipping dimensions', () => {
    const world = generateWorld(20260830, DEFAULT_PARAMS);
    expect(world.stats.connected).toBe(true);
    expect(world.stats.solvable, world.stats.problems.join('; ')).toBe(true);
  });

  it('keeps enough supply headroom that a real run has slack', () => {
    // The check measures availability, not an optimal route, so comfortable
    // headroom here is what stands in for a player's backtracking.
    const world = generateWorld(20260830, DEFAULT_PARAMS);
    for (let r = 0; r < RESOURCE_COUNT; r++) {
      const ratio = world.stats.reachableResources[r] / ARK_RECIPE[r as Resource];
      expect(ratio, `resource ${r} supply ratio`).toBeGreaterThan(2.5);
    }
  });
});

function totalRequired(): number {
  let n = 0;
  for (let r = 0; r < RESOURCE_COUNT; r++) n += ARK_RECIPE[r as Resource];
  return n;
}
