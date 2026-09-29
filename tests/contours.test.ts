import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PANEL_H, PANEL_W, withParams } from '../src/core/config.js';
import { stageRng } from '../src/core/rng.js';
import { Tile, isWalkable, tileName } from '../src/core/tiles.js';
import { PoiKind, SettlementKind, type World } from '../src/core/world.js';
import {
  MIN_CONTOUR_RUN,
  contourThresholds,
  cutContours,
  markContours,
} from '../src/core/worldgen/contours.js';
import { generateElevation } from '../src/core/worldgen/elevation.js';
import { carveLandforms } from '../src/core/worldgen/landforms.js';
import { generateValidWorld, generateWorld } from '../src/core/worldgen/index.js';
import { labelRegions } from '../src/core/worldgen/connectivity.js';
import { UNPLANNED, freshPlan } from '../src/core/worldgen/plan.js';
import { townFootprint } from '../src/core/worldgen/settlements.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const SEEDS = [1, 2, 3, 7, 4242, 9001, 13, 7932, 15851, 23770, 31689, 39608];

/** Kept contour runs, read back off the finished world's elevation. */
function contourRuns(world: World, params = SMALL): number[][] {
  return markContours(world.elev, world.w, world.h, contourThresholds(params)).runs;
}

/**
 * What the contour pass itself stamped, replaying worldgen up to that stage
 * (as scripts/diag-regions.ts does): Cliff for ledge, Steps for its stairs,
 * UNPLANNED everywhere it left alone. Ground a landform had already claimed,
 * such as a plateau and its rim, is not the contour's to close.
 */
function contourStamps(seed: number, params = SMALL): Uint8Array {
  const w = params.panelsX * PANEL_W;
  const h = params.panelsY * PANEL_H;
  const { elev, biome } = generateElevation(seed, params);
  const plan = freshPlan(w * h);
  carveLandforms(seed, params, elev, biome, plan);
  const before = plan.slice();
  cutContours(stageRng(seed, 'contours'), elev, plan, w, h, params);
  const out = new Uint8Array(w * h).fill(UNPLANNED);
  for (let i = 0; i < plan.length; i++) if (before[i] === UNPLANNED) out[i] = plan[i];
  return out;
}

/**
 * Tiles where something is allowed to break a ledge on purpose: the ark panel
 * (levelled after contours are cut, so its marks no longer line up), the
 * south beach, and the mouths of dungeons and shrines.
 */
function exempt(world: World): Uint8Array {
  const out = new Uint8Array(world.w * world.h);
  const mark = (x: number, y: number, r: number): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < world.w && ny < world.h) out[ny * world.w + nx] = 1;
      }
    }
  };
  const ax = Math.floor(world.ark.x / PANEL_W) * PANEL_W;
  const ay = Math.floor(world.ark.y / PANEL_H) * PANEL_H;
  for (let y = ay - 2; y < ay + PANEL_H + 2; y++) {
    for (let x = ax - 2; x < ax + PANEL_W + 2; x++) mark(x, y, 0);
  }
  for (let y = world.h - 4; y < world.h; y++) for (let x = 0; x < world.w; x++) mark(x, y, 0);
  for (const poi of world.pois) mark(poi.x, poi.y, 1);
  for (const s of world.settlements) if (s.shrine) mark(s.shrine.x, s.shrine.y, 1);
  mark(world.spawn.x, world.spawn.y, 1);
  return out;
}

describe('contours: thresholds', () => {
  it('splits each biome band once at the default', () => {
    expect(DEFAULT_PARAMS.contoursPerBand).toBe(1);
    expect(contourThresholds(DEFAULT_PARAMS)).toEqual([36, 102, 158, 219]);
  });

  it('adds lines as contoursPerBand grows, and none at zero', () => {
    expect(contourThresholds(withParams({ contoursPerBand: 0 }))).toEqual([]);
    const two = contourThresholds(withParams({ contoursPerBand: 2 }));
    expect(two).toHaveLength(8);
    for (let i = 1; i < two.length; i++) expect(two[i]).toBeGreaterThan(two[i - 1]);
    // Every threshold sits strictly inside a band, never on a seam.
    const edges = DEFAULT_PARAMS.biomeBands.map((b) => Math.round(b * 255));
    for (const t of two) expect(edges).not.toContain(t);
  });
});

describe('contours: generation', () => {
  it('cuts the same ledges from the same seed', () => {
    const cut = (): Uint8Array => {
      const { elev } = generateElevation(4242, SMALL);
      const plan = freshPlan(elev.length);
      const w = SMALL.panelsX * PANEL_W;
      const h = SMALL.panelsY * PANEL_H;
      cutContours(stageRng(4242, 'contours'), elev, plan, w, h, SMALL);
      return plan;
    };
    expect(cut()).toEqual(cut());
    expect(generateWorld(4242, SMALL).stats.contours).toEqual(
      generateWorld(4242, SMALL).stats.contours,
    );
  });

  it('keeps only lines long enough to read as terraces', () => {
    const world = generateWorld(4242, SMALL);
    const runs = contourRuns(world);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.length).toBeGreaterThanOrEqual(MIN_CONTOUR_RUN);
    expect(world.stats.contours.lines).toBeGreaterThan(0);
    expect(world.stats.contours.stairs).toBeGreaterThan(0);
  });

  it('closes every ledge: nothing it stamped ends up open ground but a crossing', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      const skip = exempt(world);
      const stamps = contourStamps(seed);
      for (let i = 0; i < stamps.length; i++) {
        const t = world.tiles[i];
        if (stamps[i] !== Tile.Cliff || skip[i] || !isWalkable(t)) continue;
        expect(
          t === Tile.Steps || t === Tile.Bridge || t === Tile.DungeonEntrance,
          `seed ${seed} ledge open at ${i % world.w},${(i / world.w) | 0}: ${tileName(t)}`,
        ).toBe(true);
      }
    }
  });

  it('can climb every planned stair: open ground straight across it', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      const skip = exempt(world);
      const stamps = contourStamps(seed);
      const { w } = world;
      let checked = 0;
      for (let i = 0; i < stamps.length; i++) {
        if (stamps[i] !== Tile.Steps || skip[i]) continue;
        const at = `seed ${seed} stair at ${i % w},${(i / w) | 0}`;
        expect(world.tiles[i], `${at} was built over`).toBe(Tile.Steps);
        const across = (d: number): boolean =>
          isWalkable(world.tiles[i - d]) && isWalkable(world.tiles[i + d]);
        expect(across(1) || across(w), `${at} leads nowhere`).toBe(true);
        checked++;
      }
      expect(checked, `seed ${seed} planned no stairs`).toBeGreaterThan(0);
    }
  });

  it('keeps ledges out of nearly every town', () => {
    // A preference, not a rule: when no site on the town's own terrace is
    // clear, it keeps its ledge rather than moving down a terrace (where its
    // shrine would drown too early) or not being built at all. Unguarded,
    // about half the towns had a ledge through them.
    let towns = 0;
    const ledged: string[] = [];
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      const marks = markContours(world.elev, world.w, world.h, contourThresholds(SMALL)).marks;
      for (const s of world.settlements) {
        if (s.kind === SettlementKind.Hamlet) continue;
        towns++;
        const { rx, ry } = townFootprint(s.kind, SMALL.panelsX / 12);
        let ledge = false;
        for (let dy = -ry; dy <= ry && !ledge; dy++) {
          for (let dx = -rx; dx <= rx && !ledge; dx++) {
            if ((dx / rx) ** 2 + (dy / ry) ** 2 > 1.05) continue;
            const i = (s.y + dy) * world.w + s.x + dx;
            ledge = world.tiles[i] === Tile.Cliff && marks[i] === 1;
          }
        }
        if (ledge) ledged.push(`seed ${seed} town ${s.kind}`);
      }
    }
    expect(towns).toBeGreaterThanOrEqual(SEEDS.length * 3);
    expect(ledged.length, ledged.join(', ')).toBeLessThanOrEqual(towns / 10);
  });
});

describe('contours: at shipping size', () => {
  it('stays connected and winnable', () => {
    for (const seed of SEEDS) {
      const { world, attempts } = generateValidWorld(seed, DEFAULT_PARAMS);
      expect(world.stats.connected, `seed ${seed}`).toBe(true);
      expect(world.stats.solvable, `seed ${seed}: ${world.stats.problems.join('; ')}`).toBe(true);
      expect(attempts, `seed ${seed} needed ${attempts} attempts`).toBeLessThanOrEqual(5);
      expect(labelRegions(world.tiles, world.w, world.h).sizes.length).toBe(1);
      expect(world.pois.some((p) => p.kind === PoiKind.Dungeon)).toBe(true);
    }
  });
});
