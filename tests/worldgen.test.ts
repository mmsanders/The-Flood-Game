import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PANEL_H, PANEL_W, withParams } from '../src/core/config.js';
import { BIOME_COUNT, Biome, Tile, isWalkable } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { labelRegions } from '../src/core/worldgen/connectivity.js';
import { getPanel } from '../src/core/world.js';

/** A smaller map keeps the broad sweeps fast without changing the algorithms. */
const SMALL = withParams({ panelsX: 8, panelsY: 20 });

const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 13);

describe('worldgen: determinism', () => {
  it('produces byte-identical worlds from the same seed', () => {
    const a = generateWorld(4242, SMALL);
    const b = generateWorld(4242, SMALL);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.elev).toEqual(b.elev);
    expect(a.biome).toEqual(b.biome);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.ark).toEqual(b.ark);
  });

  it('produces different worlds from different seeds', () => {
    const a = generateWorld(1, SMALL);
    const b = generateWorld(2, SMALL);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it('never calls Math.random during generation', () => {
    const real = Math.random;
    let calls = 0;
    Math.random = () => {
      calls++;
      return real();
    };
    try {
      generateWorld(31337, SMALL);
    } finally {
      Math.random = real;
    }
    expect(calls).toBe(0);
  });
});

describe('worldgen: connectivity', () => {
  it.each(SEEDS)('seed %i yields exactly one walkable region', (seed) => {
    const world = generateWorld(seed, SMALL);
    const { sizes } = labelRegions(world.tiles, world.w, world.h);
    expect(sizes.length).toBe(1);
    expect(world.stats.connected).toBe(true);
  });

  it.each(SEEDS.slice(0, 8))('seed %i leaves every panel enterable', (seed) => {
    const world = generateWorld(seed, SMALL);
    for (let py = 0; py < world.params.panelsY; py++) {
      for (let px = 0; px < world.params.panelsX; px++) {
        const panel = getPanel(world, px, py);
        const walkable = [...panel.tiles].filter(isWalkable).length;
        expect(walkable, `panel ${px},${py} is sealed`).toBeGreaterThan(0);
      }
    }
  });

  it('reaches the ark site and every dungeon from spawn', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const world = generateWorld(seed, SMALL);
      const { labels } = labelRegions(world.tiles, world.w, world.h);
      const spawnRegion = labels[world.spawn.y * world.w + world.spawn.x];
      expect(spawnRegion).toBeGreaterThanOrEqual(0);
      for (const poi of world.pois) {
        expect(
          labels[poi.y * world.w + poi.x],
          `poi kind ${poi.kind} at ${poi.x},${poi.y} unreachable on seed ${seed}`,
        ).toBe(spawnRegion);
      }
    }
  });
});

describe('worldgen: shape of the world', () => {
  it.each(SEEDS.slice(0, 10))('seed %i contains all four biomes', (seed) => {
    const world = generateWorld(seed, SMALL);
    for (let b = 0; b < BIOME_COUNT; b++) {
      expect(world.stats.biomeTiles[b], `biome ${b} missing`).toBeGreaterThan(0);
    }
  });

  it('trends high in the north and low in the south', () => {
    const world = generateWorld(777, SMALL);
    const rowMean = (y: number): number => {
      let sum = 0;
      for (let x = 0; x < world.w; x++) sum += world.elev[y * world.w + x];
      return sum / world.w;
    };
    expect(rowMean(0)).toBeGreaterThan(rowMean(world.h - 1) + 60);
  });

  it('uses the full elevation byte range', () => {
    const world = generateWorld(555, SMALL);
    let min = 255;
    let max = 0;
    for (const e of world.elev) {
      if (e < min) min = e;
      if (e > max) max = e;
    }
    expect(min).toBe(0);
    expect(max).toBe(255);
  });

  it('puts the ark high and north, and the spawn low and south', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const world = generateWorld(seed, SMALL);
      expect(world.ark.y).toBeLessThan(world.h / 3);
      expect(world.spawn.y).toBeGreaterThan(world.h * 0.75);

      const arkElev = world.elev[world.ark.y * world.w + world.ark.x];
      const spawnElev = world.elev[world.spawn.y * world.w + world.spawn.x];
      expect(arkElev).toBeGreaterThan(spawnElev);
    }
  });

  it('places every point of interest on walkable ground', () => {
    const world = generateWorld(2024, SMALL);
    for (const poi of world.pois) {
      expect(isWalkable(world.tiles[poi.y * world.w + poi.x])).toBe(true);
    }
    expect(isWalkable(world.tiles[world.spawn.y * world.w + world.spawn.x])).toBe(true);
  });

  it('places one dungeon per biome', () => {
    const world = generateWorld(8080, SMALL);
    const dungeons = world.pois.filter((p) => p.kind === 1);
    expect(dungeons.length).toBe(BIOME_COUNT * world.params.dungeonsPerBiome);
    expect(new Set(dungeons.map((d) => d.biome)).size).toBe(BIOME_COUNT);
  });

  it('finds the mountain resource only high up and the valley resource only low', () => {
    const world = generateWorld(606, SMALL);
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i] === Tile.PitchSeep) expect(world.biome[i]).toBe(Biome.Mountain);
      if (world.tiles[i] === Tile.Flax) expect(world.biome[i]).toBe(Biome.Valley);
    }
  });

  it('keeps a sane fraction of the map walkable', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const world = generateWorld(seed, SMALL);
      const frac = world.stats.walkableTiles / world.stats.totalTiles;
      expect(frac, `seed ${seed} walkable fraction`).toBeGreaterThan(0.4);
      expect(frac, `seed ${seed} walkable fraction`).toBeLessThan(0.95);
    }
  });
});

describe('worldgen: panels', () => {
  it('slices panels of exactly the Zelda 1 screen size', () => {
    const world = generateWorld(11, SMALL);
    const panel = getPanel(world, 2, 3);
    expect(panel.tiles.length).toBe(PANEL_W * PANEL_H);
    expect(panel.tiles.length).toBe(176);
    expect(panel.elev.length).toBe(176);
  });

  it('slices panel bytes matching the underlying world grid', () => {
    const world = generateWorld(12, SMALL);
    const panel = getPanel(world, 1, 1);
    for (let ty = 0; ty < PANEL_H; ty++) {
      for (let tx = 0; tx < PANEL_W; tx++) {
        const wx = PANEL_W + tx;
        const wy = PANEL_H + ty;
        expect(panel.tiles[ty * PANEL_W + tx]).toBe(world.tiles[wy * world.w + wx]);
      }
    }
  });

  it('covers the default map in the expected number of panels', () => {
    expect(DEFAULT_PARAMS.panelsX * DEFAULT_PARAMS.panelsY).toBe(480);
  });
});
