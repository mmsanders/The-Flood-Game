/**
 * Painting tiles over the elevation/biome fields.
 *
 * Deliberately simple and repetitive: fields of one repeating sprite, Zelda 1
 * style. Variety comes from biome boundaries and scatter density, not from a
 * large tile vocabulary.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { fbm2d, valueNoise2d } from '../noise.js';
import { deriveSeed, mulberry32 } from '../rng.js';
import { BIOME_RESOURCE_TILE, Biome, Tile } from '../tiles.js';

export interface PaintInput {
  seed: number;
  params: WorldParams;
  elev: Uint8Array;
  biome: Uint8Array;
}

export function paintTiles(input: PaintInput): Uint8Array {
  const { seed, params, elev, biome } = input;
  const w = tileWidth(params);
  const h = tileHeight(params);

  const tiles = new Uint8Array(w * h);

  const groundSeed = deriveSeed(seed, 'paint:ground');
  const scatterSeed = deriveSeed(seed, 'paint:scatter');
  const clusterSeed = deriveSeed(seed, 'paint:cluster');
  const pondSeed = deriveSeed(seed, 'paint:pond');
  const rng = mulberry32(deriveSeed(seed, 'paint:rng'));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = biome[i] as Biome;
      const e = elev[i];

      // Ground texture varies slowly, so fields read as fields rather than
      // per-tile static.
      const ground = valueNoise2d(groundSeed, x / 7, y / 7);
      tiles[i] = groundTile(b, e, ground);

      // Ponds and creeks in the lowlands. Kept sparse — natural water that
      // cuts the map in half is the fastest way to a broken world.
      if (b === Biome.Valley) {
        const pond = fbm2d(pondSeed, x, y, {
          octaves: 3,
          lacunarity: 2,
          gain: 0.5,
          scale: 18,
        });
        if (pond > 0.74) {
          tiles[i] = Tile.Water;
          continue;
        }
        if (pond > 0.7) {
          tiles[i] = Tile.Reed;
          continue;
        }
      }

      // Blocking scenery.
      const scatter = valueNoise2d(scatterSeed, x / 3.5, y / 3.5);
      const density = params.scatterDensity[b];
      if (scatter > 1 - density * 1.6 && rng() < 0.75) {
        tiles[i] = scatterTile(b, e);
        continue;
      }

      // Resource nodes, clustered rather than sprinkled: a low-frequency field
      // decides where a patch is, then density decides how thick it is. Patches
      // are what make a location worth remembering and worth returning to.
      const cluster = fbm2d(clusterSeed + b * 0x51ed, x, y, {
        octaves: 3,
        lacunarity: 2,
        gain: 0.5,
        scale: 26,
      });
      const inPatch = cluster > 0.58;
      const p = params.resourceDensity[b] * (inPatch ? 4.5 : 0.12);
      if (rng() < p) {
        tiles[i] = BIOME_RESOURCE_TILE[b];
      }
    }
  }

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
      // Snow line near the top of the range.
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
      // Cliffs above the snow line are permanent; lower rock can be carved.
      return elev > 240 ? Tile.Cliff : Tile.Rock;
  }
}
