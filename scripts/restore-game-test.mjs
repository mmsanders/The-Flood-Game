#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const partDir = join(root, 'tests/.game-test-b64');
const out = join(root, 'tests/game.test.ts');
const parts = readdirSync(partDir).filter((f) => f.endsWith('.b64')).sort();
if (parts.length === 0) {
  console.error('No game.test.ts b64 parts found');
  process.exit(1);
}
const chunks = parts.map((f) => Buffer.from(readFileSync(join(partDir, f), 'utf8').trim(), 'base64'));
const buf = Buffer.concat(chunks);
writeFileSync(out, buf);
console.log('restored tests/game.test.ts', buf.length, 'bytes from', parts.length, 'b64 parts');

// Wave 3 places Noah's tent as Tile.CampTent; accept it beside spawn.
const worldgenPath = join(root, 'tests/worldgen.test.ts');
if (existsSync(worldgenPath)) {
  let t = readFileSync(worldgenPath, 'utf8');
  if (!t.includes('Tile.CampTent')) {
    const old =
      '          if (world.tiles[ny * world.w + nx] === Tile.Tent) tent = true;\n' +
      '        }\n' +
      '      }\n' +
      '      expect(tent, `seed ${seed} spawn has no tent`).toBe(true);\n' +
      '      expect(world.tiles[y * world.w + x]).not.toBe(Tile.Tent)';
    const neu =
      '          const tile = world.tiles[ny * world.w + nx];\n' +
      '          if (tile === Tile.Tent || tile === Tile.CampTent) tent = true;\n' +
      '        }\n' +
      '      }\n' +
      '      expect(tent, `seed ${seed} spawn has no tent`).toBe(true);\n' +
      '      expect(world.tiles[y * world.w + x]).not.toBe(Tile.Tent);\n' +
      '      expect(world.tiles[y * world.w + x]).not.toBe(Tile.CampTent)';
    if (!t.includes(old)) {
      console.error('tests/worldgen.test.ts tent pattern not found; cannot patch');
      process.exit(1);
    }
    writeFileSync(worldgenPath, t.replace(old, neu));
    console.log('patched tests/worldgen.test.ts for CampTent');
  } else {
    console.log('tests/worldgen.test.ts already accepts CampTent');
  }
}
