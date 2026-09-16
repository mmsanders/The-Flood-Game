import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, withParams } from '../src/core/config.js';
import { drownDayForElev } from '../src/core/flood.js';
import {
  ARK_RECIPE,
  arrivalTimes,
  buildProgress,
  checkSolvable,
  recipeMet,
  requiredFor,
} from '../src/core/resources.js';
import { Biome, RESOURCE_COUNT, Resource } from '../src/core/tiles.js';
import { generateValidWorld, generateWorld } from '../src/core/worldgen/index.js';
import { PoiKind } from '../src/core/world.js';

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
  // `generateValidWorld` is what the game calls: a world that fails the
  // supply check is re-rolled rather than handed to the player. Asserting on
  // a single raw attempt tests a world nobody would ever be given — and the
  // retry loop is the mechanism, so the guarantee belongs to it.
  it.each(SEEDS)('seed %i yields a winnable world', (seed) => {
    const { world, attempts } = generateValidWorld(seed, SHIPPING);
    expect(world.stats.solvable, world.stats.problems.join('; ')).toBe(true);
    // If a seed routinely needs most of its budget, the generator is limping.
    expect(attempts, `seed ${seed} needed ${attempts} attempts`).toBeLessThan(5);
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
    // headroom here is what stands in for a player's backtracking. Measured
    // against what a run really spends — the hull *and* the Rod ladder — not
    // against the hull alone.
    const world = generateWorld(20260830, DEFAULT_PARAMS);
    for (let r = 0; r < RESOURCE_COUNT; r++) {
      const ratio = world.stats.reachableResources[r] / requiredFor(r as Resource);
      expect(ratio, `resource ${r} supply ratio`).toBeGreaterThan(2.5);
    }
  });
});

function totalRequired(): number {
  let n = 0;
  for (let r = 0; r < RESOURCE_COUNT; r++) n += ARK_RECIPE[r as Resource];
  return n;
}

describe('resources: the Rod ladder', () => {
  it('reports the day each shrine drowns and the day it can be reached', () => {
    const world = generateWorld(20260830, DEFAULT_PARAMS);
    expect(world.stats.problems).not.toContainEqual(
      expect.stringContaining('Rod ladder'),
    );
  });

  it('rejects a world whose valley shrine drowns before you could afford it', () => {
    // The Rod takes nothing but fiber until a shrine says otherwise, so a
    // lower shrine that goes under early ends the run silently — and reaching
    // it was never the constraint, since the map is half a day wide. Sink one
    // and check the generator notices.
    const world = generateWorld(20260830, DEFAULT_PARAMS);
    const shrine = world.pois.find((p) => p.kind === PoiKind.Shrine && p.biome === Biome.Valley);
    expect(shrine).toBeDefined();
    if (!shrine) return;

    const i = shrine.y * world.w + shrine.x;
    world.elev[i] = 0; // underwater almost as soon as the rain starts

    const report = checkSolvable(
      world.tiles,
      world.elev,
      world.w,
      world.h,
      world.spawn,
      DEFAULT_PARAMS,
      world.pois.filter((p) => p.kind === PoiKind.Shrine),
    );
    expect(report.solvable).toBe(false);
    expect(report.problems.join('; ')).toContain('Rod ladder');
  });

  it('does not fail a world over the mountain shrine, which is optional', () => {
    const world = generateWorld(20260830, DEFAULT_PARAMS);
    const shrine = world.pois.find(
      (p) => p.kind === PoiKind.Shrine && p.biome === Biome.Mountain,
    );
    if (!shrine) return;

    world.elev[shrine.y * world.w + shrine.x] = 0;
    const report = checkSolvable(
      world.tiles,
      world.elev,
      world.w,
      world.h,
      world.spawn,
      DEFAULT_PARAMS,
      world.pois.filter((p) => p.kind === PoiKind.Shrine),
    );
    // It only buds the harvest: a run without it is poorer, not stuck.
    expect(report.problems.join('; ')).not.toContain('Rod ladder');
    expect(report.ladder.length).toBeGreaterThan(0);
  });
});
