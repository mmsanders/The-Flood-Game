#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const partDir = join(root, 'tests/.game-test-b64-full');
const out = join(root, 'tests/game.test.ts');
const parts = readdirSync(partDir).filter((f) => f.endsWith('.b64chunk')).sort();
if (parts.length === 0) {
  console.error('No game.test.ts b64 chunks found');
  process.exit(1);
}
const b64 = parts.map((f) => readFileSync(join(partDir, f), 'utf8').trim()).join('');
const buf = Buffer.from(b64, 'base64');
writeFileSync(out, buf);
console.log('restored tests/game.test.ts', buf.length, 'bytes from', parts.length, 'b64 chunks');
