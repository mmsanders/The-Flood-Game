import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PANEL_H, PANEL_W, withParams } from '../src/core/config.js';
import { BIOME_COUNT, Biome, Tile, isResourceNode, isWalkable } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { labelRegions } from '../src/core/worldgen/connectivity.js';
import { isSeamBlocker, onPanelEdge } from '../src/core/worldgen/seams.js';
import { PoiKind, SettlementKind, getPanel } from '../src/core/world.js';

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

  it('puts the ark and the spawn in the north, ark on higher ground', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const world = generateWorld(seed, SMALL);
      expect(world.ark.y).toBeLessThan(world.h / 3);
      expect(world.spawn.y).toBeLessThan(world.h * 0.25);

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

  it('places one rod shrine per biome', () => {
    const world = generateWorld(8080, SMALL);
    const shrines = world.pois.filter((p) => p.kind === PoiKind.Shrine);
    expect(shrines.length).toBe(BIOME_COUNT);
    expect(new Set(shrines.map((s) => s.biome)).size).toBe(BIOME_COUNT);
    for (const s of shrines) {
      expect(world.tiles[s.y * world.w + s.x]).toBe(Tile.Shrine);
    }
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

describe('worldgen: panel seams', () => {
  it.each(SEEDS)('seed %i keeps resource nodes off panel edges', (seed) => {
    const world = generateWorld(seed, SMALL);
    let nodes = 0;
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const tile = world.tiles[y * world.w + x];
        if (!isResourceNode(tile)) continue;
        nodes++;
        expect(onPanelEdge(x, y), `node ${tile} on edge ${x},${y} seed ${seed}`).toBe(false);
      }
    }
    expect(nodes, `seed ${seed} placed no resources at all`).toBeGreaterThan(0);
  });

  it.each(SEEDS)('seed %i mirrors scenery blockers across every panel seam', (seed) => {
    const world = generateWorld(seed, SMALL);
    const { w, h, params, tiles } = world;

    for (let px = 1; px < params.panelsX; px++) {
      const xR = px * PANEL_W;
      const xL = xR - 1;
      for (let y = 0; y < h; y++) {
        const a = tiles[y * w + xL];
        const b = tiles[y * w + xR];
        expect(isSeamBlocker(a), `v-seam ${xL}|${xR},${y} seed ${seed}`).toBe(isSeamBlocker(b));
      }
    }

    for (let py = 1; py < params.panelsY; py++) {
      const yB = py * PANEL_H;
      const yT = yB - 1;
      for (let x = 0; x < w; x++) {
        const a = tiles[yT * w + x];
        const b = tiles[yB * w + x];
        expect(isSeamBlocker(a), `h-seam ${x},${yT}|${yB} seed ${seed}`).toBe(isSeamBlocker(b));
      }
    }
  });

  it.each(SEEDS)('seed %i walls the world rim so the map edge is visible', (seed) => {
    const world = generateWorld(seed, SMALL);
    const { w, h, tiles, spawn, ark } = world;

    for (let x = 0; x < w; x++) {
      expect(isWalkable(tiles[x]), `north rim ${x} seed ${seed}`).toBe(false);
      expect(tiles[(h - 1) * w + x], `south sea ${x} seed ${seed}`).toBe(Tile.Water);
    }
    for (let x = 1; x < w - 1; x++) {
      const beach = tiles[(h - 2) * w + x];
      expect(
        beach === Tile.Sand || beach === Tile.Water || beach === Tile.Bridge,
        `beach ${x} seed ${seed}`,
      ).toBe(true);
    }
    for (let y = 0; y < h; y++) {
      expect(isWalkable(tiles[y * w]), `west rim ${y} seed ${seed}`).toBe(false);
      expect(isWalkable(tiles[y * w + w - 1]), `east rim ${y} seed ${seed}`).toBe(false);
    }

    expect(spawn.x).toBeGreaterThan(0);
    expect(spawn.x).toBeLessThan(w - 1);
    expect(spawn.y).toBeGreaterThan(0);
    expect(spawn.y).toBeLessThan(h - 1);
    expect(isWalkable(tiles[spawn.y * w + spawn.x])).toBe(true);
    expect(isWalkable(tiles[ark.y * w + ark.x])).toBe(true);
  });
});

describe('worldgen: landforms', () => {
  it.each(SEEDS.slice(0, 8))('seed %i carves a north-south river', (seed) => {
    const world = generateWorld(seed, SMALL);
    let minY = world.h;
    let maxY = 0;
    let water = 0;
    for (let y = 1; y < world.h - 1; y++) {
      for (let x = 1; x < world.w - 1; x++) {
        if (world.tiles[y * world.w + x] !== Tile.Water) continue;
        water++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    expect(water, `seed ${seed} has no river`).toBeGreaterThan(40);
    expect(maxY - minY, `seed ${seed} river is a puddle`).toBeGreaterThan(world.h * 0.45);
  });

  it.each(SEEDS.slice(0, 8))('seed %i keeps standing water in every biome', (seed) => {
    const world = generateWorld(seed, SMALL);
    const wet = [false, false, false, false];
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i] === Tile.Water) wet[world.biome[i]] = true;
    }
    for (let b = 0; b < BIOME_COUNT; b++) {
      expect(wet[b], `seed ${seed} biome ${b} has no water`).toBe(true);
    }
  });

  it.each(SEEDS.slice(0, 8))('seed %i cuts stairs through the escarpments', (seed) => {
    const world = generateWorld(seed, SMALL);
    let steps = 0;
    let nextToCliff = 0;
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i] !== Tile.Steps) continue;
      steps++;
      const x = i % world.w;
      const y = (i / world.w) | 0;
      const n4 = [i - 1, i + 1, i - world.w, i + world.w];
      for (const j of n4) {
        if (j < 0 || j >= world.tiles.length) continue;
        const jx = j % world.w;
        const jy = (j / world.w) | 0;
        if (Math.abs(jx - x) + Math.abs(jy - y) !== 1) continue;
        if (world.tiles[j] === Tile.Cliff) nextToCliff++;
      }
    }
    expect(steps, `seed ${seed} has no stairs`).toBeGreaterThan(0);
    expect(nextToCliff, `seed ${seed} stairs sit in a field`).toBeGreaterThan(0);
  });
});

describe('worldgen: settlements', () => {
  it.each(SEEDS.slice(0, 8))('seed %i founds a tent city, a mill, and a stone city', (seed) => {
    const world = generateWorld(seed, SMALL);
    const kinds = new Set(world.settlements.map((s) => s.kind));
    expect(kinds.has(SettlementKind.TentCity), `seed ${seed} missing tent city`).toBe(true);
    expect(kinds.has(SettlementKind.LoggingTown), `seed ${seed} missing logging town`).toBe(true);
    expect(kinds.has(SettlementKind.City), `seed ${seed} missing city`).toBe(true);
  });

  it('sits each town shrine on a real bearing, close enough to walk', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const world = generateWorld(seed, SMALL);
      for (const s of world.settlements) {
        if (!s.shrine) continue;
        const d = Math.abs(s.x - s.shrine.x) + Math.abs(s.y - s.shrine.y);
        expect(d, `seed ${seed} shrine stranded from ${s.kind}`).toBeLessThan(36);
        expect(world.tiles[s.shrine.y * world.w + s.shrine.x]).toBe(Tile.Shrine);
      }
    }
  });

  it('fences a valley pasture and keeps it walkable', () => {
    const world = generateWorld(4242, SMALL);
    expect(world.pastures.length).toBeGreaterThan(4);
    let fences = 0;
    for (const t of world.tiles) if (t === Tile.Fence) fences++;
    expect(fences).toBeGreaterThanOrEqual(8);
    for (const i of world.pastures) {
      expect(isWalkable(world.tiles[i])).toBe(true);
    }
  });

  it("pitches Noah's tent next to spawn", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const world = generateWorld(seed, SMALL);
      const { x, y } = world.spawn;
      let tent = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
          if (world.tiles[ny * world.w + nx] === Tile.Tent) tent = true;
        }
      }
      expect(tent, `seed ${seed} spawn has no tent`).toBe(true);
      expect(world.tiles[y * world.w + x]).not.toBe(Tile.Tent);
    }
  });

  it('builds the ark on the panel directly north of spawn', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const world = generateWorld(seed, SMALL);
      const spawnPanel = {
        x: Math.floor(world.spawn.x / PANEL_W),
        y: Math.floor(world.spawn.y / PANEL_H),
      };
      const arkPanel = {
        x: Math.floor(world.ark.x / PANEL_W),
        y: Math.floor(world.ark.y / PANEL_H),
      };
      expect(arkPanel, `seed ${seed}`).toEqual({ x: spawnPanel.x, y: spawnPanel.y - 1 });
      // Never the world rim, or the panel would be half frame.
      expect(arkPanel.y).toBeGreaterThanOrEqual(1);
    }
  });

  it('walls the ark platform so the stairs are the only way up', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const world = generateWorld(seed, SMALL);
      const i = world.ark.y * world.w + world.ark.x;
      expect(world.tiles[i]).toBe(Tile.ArkSite);

      // Flood-fill off the ark tile, refusing to walk through a stair. If the
      // platform is properly walled this cannot escape it — which is the
      // actual claim, rather than "there is a Steps tile somewhere nearby".
      const seen = new Set<number>([i]);
      const queue = [i];
      let escaped = false;
      while (queue.length > 0 && !escaped) {
        const cur = queue.pop() as number;
        const cx = cur % world.w;
        const cy = (cur / world.w) | 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
          const n = ny * world.w + nx;
          if (seen.has(n)) continue;
          const tile = world.tiles[n];
          if (tile === Tile.Steps) continue;
          if (!isWalkable(tile)) continue;
          // Leaving the ark's own panel without touching a stair is the bug.
          if (Math.floor(ny / PANEL_H) !== Math.floor(world.ark.y / PANEL_H)) {
            escaped = true;
            break;
          }
          seen.add(n);
          queue.push(n);
        }
      }
      expect(escaped, `seed ${seed}: reached the ark without using the stairs`).toBe(false);

      // And the stairs exist, so it is walled rather than sealed.
      const panelY = Math.floor(world.ark.y / PANEL_H) * PANEL_H;
      const panelX = Math.floor(world.ark.x / PANEL_W) * PANEL_W;
      let steps = 0;
      for (let y = panelY; y < panelY + PANEL_H; y++) {
        for (let x = panelX; x < panelX + PANEL_W; x++) {
          if (world.tiles[y * world.w + x] === Tile.Steps) steps++;
        }
      }
      expect(steps, `seed ${seed} ark panel has no stairs`).toBeGreaterThan(0);
    }
  });
});

describe('worldgen: roads', () => {
  it.each(SEEDS.slice(0, 8))('seed %i lays roads that actually go somewhere', (seed) => {
    const world = generateWorld(seed, SMALL);
    let paths = 0;
    let stone = 0;
    for (const t of world.tiles) {
      if (t === Tile.Path) paths++;
      if (t === Tile.Road) stone++;
    }
    expect(paths + stone, `seed ${seed} has no roads`).toBeGreaterThan(40);
    const city = world.settlements.find((s) => s.kind === SettlementKind.City);
    if (city) {
      expect(stone, `seed ${seed} city has no stone streets`).toBeGreaterThan(0);
    }
  });
});
