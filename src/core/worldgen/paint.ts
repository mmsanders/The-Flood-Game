/**
 * Painting tiles over the elevation/biome fields.
 *
 * Deliberately simple and repetitive: fields of one repeating sprite, Zelda 1
 * style. Variety comes from biome boundaries, landforms and settlements, not
 * from a large tile vocabulary. Planned cells (river, town, road, shrine)
 * are left alone — this pass only fills what nothing else claimed.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { fbm2d, valueNoise2d } from '../noise.js';
import { deriveSeed, mulberry32 } from '../rng.js';
import { BIOME_RESOURCE_TILE, Biome, Tile } from '../tiles.js';
import { UNPLANNED } from './plan.js';
import { onPanelEdge, sealPanelSeams, wallWorldRim } from './seams.js';

export interface PaintInput {
  seed: number;
  params: WorldParams;
  elev: Uint8Array;
  biome: Uint8Array;
  plan?: Uint8Array;
}

export function paintTiles(input: PaintInput): Uint8Array {
  const { seed, params, elev, biome, plan } = input;
  const w = tileWidth(params);
  const h = tileHeight(params);

  const tiles = new Uint8Array(w * h);

  const groundSeed = deriveSeed(seed, 'paint:ground');
  const scatterSeed = deriveSeed(seed, 'paint:scatter');
  const clusterSeed = deriveSeed(seed, 'paint:cluster');
  const rng = mulberry32(deriveSeed(seed, 'paint:rng'));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (plan && plan[i] !== UNPLANNED) {
        tiles[i] = plan[i];
        continue;
      }
      const b = biome[i] as Biome;
      const e = elev[i];

      const ground = valueNoise2d(groundSeed, x / 7, y / 7);
      tiles[i] = groundTile(b, e, ground);

      const scatter = valueNoise2d(scatterSeed, x / 3.5, y / 3.5);
      const density = params.scatterDensity[b];
      if (scatter > 1 - density * 1.6 && rng() < 0.75) {
        tiles[i] = scatterTile(b, e);
        continue;
      }

      const cluster = fbm2d(clusterSeed + b * 0x51ed, x, y, {
        octaves: 3,
        lacunarity: 2,
        gain: 0.5,
        scale: 26,
      });
      // Slightly tighter patches, thinner scatter between them — playtest
      // found nodes felt ubiquitous near spawn; clustering restores "find a
      // stand" without changing shrine/ark affordability validation.
      const inPatch = cluster > 0.58;
      const p = params.resourceDensity[b] * (inPatch ? 5.0 : 0.08);
      if (rng() < p && !onPanelEdge(x, y)) {
        tiles[i] = BIOME_RESOURCE_TILE[b];
      }
    }
  }

  sealPanelSeams(tiles, biome, elev, params);
  wallWorldRim(tiles, biome, elev, w, h);
  return tiles;
}

function groundTile(b: Biome, elev: number, n: number): Tile {
  switch (b) {
    case Biome.Valley:
      if (n > 0.72) return Tile.Crop;
      if (n > 0.62) return Tile.Dirt;
      if (n < 0.3) return Tile.TallGrass;
      return Tile.Grass;
    case Biome.Forest:
      if (n < 0.32) return Tile.TallGrass;
      if (n > 0.78) return Tile.Dirt;
      return Tile.Grass;
    case Biome.Scrub:
      if (n > 0.66) return Tile.StoneGround;
      if (n < 0.28) return Tile.Sand;
      return Tile.Gravel;
    case Biome.Mountain:
      if (elev > 232) return Tile.Snow;
      if (n > 0.6) return Tile.StoneGround;
      return Tile.Gravel;
  }
}

function scatterTile(b: Biome, elev: number): Tile {
  switch (b) {
    case Biome.Valley:
      return Tile.Shrub;
    case Biome.Forest:
      return Tile.Tree;
    case Biome.Scrub:
      return Tile.Rock;
    case Biome.Mountain:
      return elev > 240 ? Tile.Cliff : Tile.Rock;
  }
}
