/**
 * Byte-level representation of a world.
 *
 * Two forms, both first-class:
 *
 *   - the *seed form* (16 bytes) is what the game and the dev tool actually
 *     pass around, since a world is a pure function of its seed;
 *   - the *explicit form* dumps the tile and elevation planes panel by panel,
 *     which is what makes the world inspectable, diffable, and eventually
 *     hand-editable.
 */

import { PANEL_H, PANEL_W, type WorldParams } from './config.js';
import type { Panel, World } from './world.js';

const MAGIC = 0x464c4431; // "FLD1"
export const SEED_FORM_BYTES = 16;

/** The whole world in 16 bytes: magic, version, seed, and map dimensions. */
export function toSeedForm(seed: number, params: WorldParams): Uint8Array {
  const buf = new Uint8Array(SEED_FORM_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint32(0, MAGIC, false);
  view.setUint8(4, 1); // format version
  view.setUint8(5, params.panelsX);
  view.setUint8(6, params.panelsY);
  view.setUint8(7, 0); // reserved
  view.setUint32(8, seed >>> 0, false);
  view.setUint32(12, 0, false); // reserved
  return buf;
}

export interface SeedForm {
  seed: number;
  panelsX: number;
  panelsY: number;
}

export function fromSeedForm(buf: Uint8Array): SeedForm {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, false) !== MAGIC) throw new Error('Not a Flood world blob');
  const version = view.getUint8(4);
  if (version !== 1) throw new Error(`Unsupported world format version ${version}`);
  return {
    panelsX: view.getUint8(5),
    panelsY: view.getUint8(6),
    seed: view.getUint32(8, false),
  };
}

/**
 * One panel as raw bytes: 176 tile bytes followed by 176 elevation bytes.
 * This is the format the whole design is built around — one panel is a list
 * of 8-bit numbers and nothing more.
 */
export const PANEL_TILE_BYTES = PANEL_W * PANEL_H;
export const PANEL_TOTAL_BYTES = PANEL_TILE_BYTES * 2;

export function panelToBytes(panel: Panel): Uint8Array {
  const out = new Uint8Array(PANEL_TOTAL_BYTES);
  out.set(panel.tiles, 0);
  out.set(panel.elev, PANEL_TILE_BYTES);
  return out;
}

export function panelFromBytes(px: number, py: number, bytes: Uint8Array): Panel {
  if (bytes.length !== PANEL_TOTAL_BYTES) {
    throw new Error(`Expected ${PANEL_TOTAL_BYTES} bytes, got ${bytes.length}`);
  }
  return {
    px,
    py,
    tiles: bytes.slice(0, PANEL_TILE_BYTES),
    elev: bytes.slice(PANEL_TILE_BYTES),
    biome: 0,
  };
}

/** Explicit form: every panel's bytes, row-major by panel. */
export function worldToBytes(world: World): Uint8Array {
  const { panelsX, panelsY } = world.params;
  const out = new Uint8Array(SEED_FORM_BYTES + panelsX * panelsY * PANEL_TOTAL_BYTES);
  out.set(toSeedForm(world.seed, world.params), 0);

  let off = SEED_FORM_BYTES;
  for (let py = 0; py < panelsY; py++) {
    for (let px = 0; px < panelsX; px++) {
      for (let ty = 0; ty < PANEL_H; ty++) {
        const row = (py * PANEL_H + ty) * world.w + px * PANEL_W;
        out.set(world.tiles.subarray(row, row + PANEL_W), off + ty * PANEL_W);
        out.set(
          world.elev.subarray(row, row + PANEL_W),
          off + PANEL_TILE_BYTES + ty * PANEL_W,
        );
      }
      off += PANEL_TOTAL_BYTES;
    }
  }

  return out;
}

/** Human-readable hex dump of a byte plane, PANEL_W bytes per line. */
export function hexDump(bytes: Uint8Array, width = PANEL_W): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += width) {
    const row: string[] = [];
    for (let j = i; j < Math.min(i + width, bytes.length); j++) {
      row.push(bytes[j].toString(16).padStart(2, '0'));
    }
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}
