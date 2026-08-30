import { describe, expect, it } from 'vitest';
import { PANEL_H, PANEL_W, withParams } from '../src/core/config.js';
import {
  PANEL_TOTAL_BYTES,
  SEED_FORM_BYTES,
  fromSeedForm,
  hexDump,
  panelFromBytes,
  panelToBytes,
  toSeedForm,
  worldToBytes,
} from '../src/core/serialize.js';
import { getPanel } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });

describe('serialize: seed form', () => {
  it('round-trips a world in 16 bytes', () => {
    const bytes = toSeedForm(3735928559, SMALL);
    expect(bytes.length).toBe(SEED_FORM_BYTES);
    expect(bytes.length).toBe(16);

    const decoded = fromSeedForm(bytes);
    expect(decoded.seed).toBe(3735928559);
    expect(decoded.panelsX).toBe(8);
    expect(decoded.panelsY).toBe(20);
  });

  it('rejects a blob that is not a world', () => {
    expect(() => fromSeedForm(new Uint8Array(16))).toThrow(/not a flood world/i);
  });

  it('regenerates an identical world from the decoded seed', () => {
    const original = generateWorld(4242, SMALL);
    const decoded = fromSeedForm(toSeedForm(original.seed, original.params));
    const rebuilt = generateWorld(decoded.seed, withParams(decoded));
    expect(rebuilt.tiles).toEqual(original.tiles);
    expect(rebuilt.elev).toEqual(original.elev);
  });
});

describe('serialize: panel bytes', () => {
  it('encodes a panel as 176 tile bytes plus 176 elevation bytes', () => {
    const world = generateWorld(11, SMALL);
    const bytes = panelToBytes(getPanel(world, 2, 3));
    expect(bytes.length).toBe(PANEL_TOTAL_BYTES);
    expect(bytes.length).toBe(352);
    expect(PANEL_W * PANEL_H).toBe(176);
  });

  it('round-trips a panel through its byte form', () => {
    const world = generateWorld(11, SMALL);
    const panel = getPanel(world, 2, 3);
    const back = panelFromBytes(2, 3, panelToBytes(panel));
    expect(back.tiles).toEqual(panel.tiles);
    expect(back.elev).toEqual(panel.elev);
  });

  it('rejects a panel blob of the wrong length', () => {
    expect(() => panelFromBytes(0, 0, new Uint8Array(10))).toThrow(/expected 352 bytes/i);
  });

  it('stores every value in a single byte', () => {
    const world = generateWorld(77, SMALL);
    for (const t of world.tiles) expect(t).toBeLessThanOrEqual(255);
    for (const e of world.elev) expect(e).toBeLessThanOrEqual(255);
  });
});

describe('serialize: explicit world form', () => {
  it('writes a header plus one block per panel', () => {
    const world = generateWorld(5, SMALL);
    const bytes = worldToBytes(world);
    const panels = SMALL.panelsX * SMALL.panelsY;
    expect(bytes.length).toBe(SEED_FORM_BYTES + panels * PANEL_TOTAL_BYTES);
  });

  it('keeps the whole shipping map comfortably small', () => {
    const world = generateWorld(5);
    const bytes = worldToBytes(world);
    // 480 panels x 352 bytes ~= 169 KB, per the design budget.
    expect(bytes.length).toBeLessThan(200 * 1024);
  });

  it('places each panel block where the header says it should be', () => {
    const world = generateWorld(5, SMALL);
    const bytes = worldToBytes(world);
    const px = 3;
    const py = 4;
    const off = SEED_FORM_BYTES + (py * SMALL.panelsX + px) * PANEL_TOTAL_BYTES;
    const block = bytes.subarray(off, off + PANEL_TOTAL_BYTES);
    expect(block).toEqual(panelToBytes(getPanel(world, px, py)));
  });
});

describe('serialize: hex dump', () => {
  it('lays bytes out one panel row per line', () => {
    const dump = hexDump(new Uint8Array([0, 1, 255, 16]), 2);
    expect(dump).toBe('00 01\nff 10');
  });
});
