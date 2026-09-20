#!/usr/bin/env node
/**
 * Assemble Wave 3 large sources from base64 part files.
 * Runs automatically via npm pretest / pretypecheck.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const blobDir = join(root, 'src/game/.wave3-blobs');

function assemble(outRel, partPrefix) {
  const parts = readdirSync(blobDir)
    .filter((f) => f.startsWith(partPrefix) && f.endsWith('.b64'))
    .sort();
  if (parts.length === 0) {
    console.error('No parts for', partPrefix);
    process.exit(1);
  }
  const b64 = parts.map((f) => readFileSync(join(blobDir, f), 'utf8').trim()).join('');
  const buf = Buffer.from(b64, 'base64');
  const outPath = join(root, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  console.log('assembled', outRel, buf.length, 'bytes from', parts.length, 'parts');
}

assemble('src/game/state.ts', 'state.ts.part');
assemble('src/game/render.ts', 'render.ts.part');
