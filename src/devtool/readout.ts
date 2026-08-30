/**
 * The world health readout.
 *
 * The point of this panel is to answer "is this world any good?" without you
 * having to squint at the map. Anything that fails validation says so in red,
 * with the reason spelled out.
 */

import { FLOOD_DAYS } from '../core/config.js';
import { drownDayForElev } from '../core/flood.js';
import { ARK_RECIPE } from '../core/resources.js';
import {
  BIOME_COUNT,
  BIOME_NAMES,
  type Biome,
  RESOURCE_COUNT,
  RESOURCE_NAMES,
  type Resource,
} from '../core/tiles.js';
import { worldToBytes } from '../core/serialize.js';
import type { World } from '../core/world.js';
import { BIOME_COLORS, PALETTE } from '../render/palette.js';

const RESOURCE_SWATCH = [PALETTE.flax, PALETTE.gopher, PALETTE.stoneNode, PALETTE.pitch];

export function renderReadout(world: World, day: number): string {
  const s = world.stats;
  const dry = dryFraction(world, day);

  return [
    group('Validation', [
      row('Fully connected', flag(s.connected)),
      row('Winnable', flag(s.solvable)),
      row('Generation seed', mono(String(world.seed))),
    ]),

    group(
      'Biomes',
      Array.from({ length: BIOME_COUNT }, (_, b) =>
        row(
          BIOME_NAMES[b as Biome],
          `${pct(s.biomeTiles[b], s.totalTiles)}`,
          BIOME_COLORS[b],
        ),
      ),
    ),

    group(
      'Resources',
      Array.from({ length: RESOURCE_COUNT }, (_, r) => {
        const need = ARK_RECIPE[r as Resource];
        const reach = s.reachableResources[r];
        const ratio = need > 0 ? reach / need : 0;
        return row(
          RESOURCE_NAMES[r as Resource],
          `${reach}/${need} <span class="dim">×${ratio.toFixed(1)}</span>`,
          RESOURCE_SWATCH[r],
          ratio >= 2 ? 'is-good' : 'is-bad',
        );
      }),
    ),

    group('Terrain', [
      row('Walkable', pct(s.walkableTiles, s.totalTiles)),
      row('Panels', `${world.params.panelsX} × ${world.params.panelsY}`),
      row('Tiles', s.totalTiles.toLocaleString()),
      row('Explicit size', `${(worldToBytes(world).length / 1024).toFixed(0)} KB`),
      row('Seed form', '16 B'),
    ]),

    group('Flood', [
      row('Day', `${day.toFixed(2)} / ${FLOOD_DAYS}`),
      row('Dry ground', pct(dry, 1)),
      row('Ark site drowns', `day ${arkDrownDay(world).toFixed(1)}`),
    ]),

    s.problems.length
      ? `<div class="problems"><strong>Problems</strong><ul>${s.problems
          .map((p) => `<li>${escapeHtml(p)}</li>`)
          .join('')}</ul></div>`
      : '',
  ].join('');
}

export function healthState(world: World): { label: string; state: 'good' | 'bad' } {
  const ok = world.stats.connected && world.stats.solvable;
  return ok
    ? { label: 'Healthy', state: 'good' }
    : { label: `${world.stats.problems.length} issue(s)`, state: 'bad' };
}

/** Share of the map still above water at a given day. */
export function dryFraction(world: World, day: number): number {
  let dry = 0;
  for (const e of world.elev) if (drownDayForElev(e) > day) dry++;
  return dry / world.elev.length;
}

function arkDrownDay(world: World): number {
  return drownDayForElev(world.elev[world.ark.y * world.w + world.ark.x]);
}

function group(title: string, rows: string[]): string {
  return `<div class="group"><h3>${title}</h3><div class="rows">${rows.join('')}</div></div>`;
}

function row(key: string, value: string, swatch?: string, valueClass = ''): string {
  const dot = swatch ? `<span class="swatch" style="background:${swatch}"></span>` : '';
  return (
    `<div class="row"><span class="row-key">${dot}${escapeHtml(key)}</span>` +
    `<span class="row-val ${valueClass}">${value}</span></div>`
  );
}

function flag(ok: boolean): string {
  return ok ? '<span class="is-good">✓ yes</span>' : '<span class="is-bad">✗ no</span>';
}

function mono(text: string): string {
  return `<span style="font-family:ui-monospace,monospace">${escapeHtml(text)}</span>`;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
}

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
