#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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
