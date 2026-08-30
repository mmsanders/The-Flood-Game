/**
 * The Flood — world inspector.
 *
 * A phone-first view onto the same worldgen the game runs. Nothing here has a
 * private copy of the simulation: it imports `core/` directly, so what you see
 * on your phone is exactly what the game would generate from that seed.
 */

import { DEFAULT_PARAMS, FLOOD_DAYS, PANEL_H, PANEL_W } from '../core/config.js';
import { REWARD_NAMES } from '../core/dungeon.js';
import { parseSeed, randomSeed } from '../core/rng.js';
import type { TileMap } from '../core/tilemap.js';
import { BIOME_NAMES, type Biome } from '../core/tiles.js';
import type { World } from '../core/world.js';
import { generateValidWorld } from '../core/worldgen/index.js';
import {
  type Overlay,
  drawPanelGrid,
  drawPoiMarkers,
  renderOverviewBitmap,
} from '../render/worldmap.js';
import { closePanelSheet, openPanelSheet, type PanelSheetRefs } from './panelsheet.js';
import { dryFraction, healthState, renderReadout } from './readout.js';
import { Viewport } from './viewport.js';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

// ---------------------------------------------------------------- state

interface State {
  seed: number;
  world: World;
  day: number;
  overlay: Overlay;
  showPois: boolean;
  /** -1 for the overworld, otherwise the dungeon index being viewed. */
  viewing: number;
}

const url = new URL(window.location.href);
const initialSeed = parseSeed(url.searchParams.get('seed'));
const initialDay = clampDay(Number(url.searchParams.get('day') ?? 0));
const initialOverlay = (url.searchParams.get('overlay') as Overlay) || 'tiles';

const state: State = {
  seed: initialSeed,
  world: generateValidWorld(initialSeed, DEFAULT_PARAMS).world,
  day: initialDay,
  overlay: isOverlay(initialOverlay) ? initialOverlay : 'tiles',
  showPois: url.searchParams.get('pins') !== '0',
  viewing: Number(url.searchParams.get('dungeon') ?? -1),
};

/**
 * The map on screen. Dungeons are TileMaps just like the overworld, so every
 * renderer below takes them without modification — that is the payoff of
 * making a dungeon room exactly one panel.
 */
function viewedMap(): TileMap {
  return state.viewing >= 0 ? state.world.dungeons[state.viewing] : state.world;
}

/** Cached 1px-per-tile bitmap; only rebuilt when the world, day or overlay changes. */
let bitmap: HTMLCanvasElement | OffscreenCanvas | null = null;
let bitmapKey = '';

function overviewBitmap(): HTMLCanvasElement | OffscreenCanvas {
  const key = `${state.seed}|${state.day}|${state.overlay}|${state.viewing}`;
  if (!bitmap || key !== bitmapKey) {
    bitmap = renderOverviewBitmap(viewedMap(), {
      day: state.day,
      overlay: state.overlay,
      showPois: state.showPois,
    });
    bitmapKey = key;
  }
  return bitmap;
}

// ---------------------------------------------------------------- viewport

const mapCanvas = el<HTMLCanvasElement>('map');

const viewport = new Viewport(mapCanvas, {
  contentW: state.world.w,
  contentH: state.world.h,
  minScale: 0.4,
  maxScale: 24,
  onDraw: (ctx, scale) => {
    const map = viewedMap();
    ctx.drawImage(overviewBitmap() as CanvasImageSource, 0, 0);
    drawPanelGrid(ctx, map, scale);
    if (state.showPois && state.viewing < 0) drawPoiMarkers(ctx, state.world, scale);
    if (state.showPois && state.viewing >= 0) drawDungeonMarkers(ctx, scale);
  },
  onTap: (x, y) => {
    const map = viewedMap();
    const px = Math.floor(x / PANEL_W);
    const py = Math.floor(y / PANEL_H);
    if (px < 0 || py < 0 || px * PANEL_W >= map.w || py * PANEL_H >= map.h) return;
    openPanelSheet(sheetRefs, map, px, py, state.day);
  },
});

/** Stairs, key and chest, so a dungeon's shape reads at a glance. */
function drawDungeonMarkers(ctx: CanvasRenderingContext2D, scale: number): void {
  const d = state.world.dungeons[state.viewing];
  if (!d) return;

  const r = Math.max(3.5, Math.min(9, 30 / scale));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [point, color, glyph] of [
    [d.stairs, '#8a7fa8', 'S'],
    [d.key, '#e8c84a', 'K'],
    [d.chest, '#c98a2e', 'X'],
  ] as const) {
    ctx.beginPath();
    ctx.arc(point.x + 0.5, point.y + 0.5, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, r * 0.25);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.stroke();
    if (r * scale >= 9) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 1.3}px system-ui, sans-serif`;
      ctx.fillText(glyph, point.x + 0.5, point.y + 0.5);
    }
  }
  ctx.restore();
}

window.addEventListener('resize', () => viewport.resize());

// ---------------------------------------------------------------- controls

const seedInput = el<HTMLInputElement>('seed-input');
const dayInput = el<HTMLInputElement>('day');
const dayOut = el('day-out');
const dryOut = el('dry-out');
const hint = el('hint');

const sheetRefs: PanelSheetRefs = {
  root: el('panel-sheet'),
  title: el('panel-title'),
  body: el('panel-body'),
};

el('seed-form').addEventListener('submit', (e) => {
  e.preventDefault();
  regenerate(parseSeed(seedInput.value));
});

el('reroll').addEventListener('click', () => regenerate(randomSeed()));

el('fit').addEventListener('click', () => viewport.fit());

const poiToggle = el<HTMLButtonElement>('toggle-pois');
poiToggle.addEventListener('click', () => {
  state.showPois = !state.showPois;
  poiToggle.classList.toggle('is-active', state.showPois);
  poiToggle.setAttribute('aria-pressed', String(state.showPois));
  syncUrl();
  viewport.requestDraw();
});

for (const chip of el('overlay-chips').querySelectorAll<HTMLButtonElement>('[data-overlay]')) {
  chip.addEventListener('click', () => {
    const next = chip.dataset.overlay as Overlay;
    if (!isOverlay(next)) return;
    state.overlay = next;
    for (const other of el('overlay-chips').querySelectorAll('[data-overlay]')) {
      other.classList.toggle('is-active', other === chip);
    }
    syncUrl();
    viewport.requestDraw();
  });
}

/** One chip per map: the overworld plus each dungeon. */
function buildMapChips(): void {
  const bar = el('map-chips');
  bar.innerHTML = '';

  const add = (label: string, viewing: number, title: string): void => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = label;
    chip.title = title;
    chip.classList.toggle('is-active', state.viewing === viewing);
    chip.addEventListener('click', () => {
      state.viewing = viewing;
      bitmap = null;
      closePanelSheet(sheetRefs);
      buildMapChips();
      syncReadout();
      syncUrl();
      resizeViewportToMap();
    });
    bar.appendChild(chip);
  };

  add('Overworld', -1, 'The 12x40 panel overworld');
  state.world.dungeons.forEach((d, i) => {
    add(
      `${BIOME_NAMES[d.biomeKind as Biome]} ⌂`,
      i,
      `${d.roomsX}x${d.roomsY} rooms — ${REWARD_NAMES[d.reward]}`,
    );
  });
}

/** Dungeons are a different size to the overworld, so refit on every swap. */
function resizeViewportToMap(): void {
  const map = viewedMap();
  viewport.setContentSize(map.w, map.h);
  viewport.fit();
}

dayInput.addEventListener('input', () => {
  state.day = clampDay(Number(dayInput.value));
  syncDayLabels();
  syncUrl();
  viewport.requestDraw();
});

el('readout-toggle').addEventListener('click', () => {
  const readout = el('readout');
  const open = readout.dataset.open !== 'true';
  readout.dataset.open = String(open);
  el('readout-toggle').setAttribute('aria-expanded', String(open));
  // The map box changes size when the drawer opens.
  requestAnimationFrame(() => viewport.resize());
});

el('sheet-scrim').addEventListener('click', () => closePanelSheet(sheetRefs));
el('sheet-close').addEventListener('click', () => closePanelSheet(sheetRefs));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanelSheet(sheetRefs);
  if (e.key === 'r' && !isTyping(e)) regenerate(randomSeed());
  if (e.key === 'f' && !isTyping(e)) viewport.fit();
});

// ---------------------------------------------------------------- actions

function regenerate(seed: number): void {
  state.seed = seed;
  state.world = generateValidWorld(seed, DEFAULT_PARAMS).world;
  bitmap = null;
  closePanelSheet(sheetRefs);
  buildMapChips();
  syncAll();
  resizeViewportToMap();
}

function syncAll(): void {
  seedInput.value = String(state.seed);
  dayInput.value = String(state.day);
  syncDayLabels();
  syncReadout();
  syncUrl();
}

function syncDayLabels(): void {
  dayOut.textContent = Number.isInteger(state.day)
    ? String(state.day)
    : state.day.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  dryOut.textContent = `${(dryFraction(state.world, state.day) * 100).toFixed(0)}% dry`;
}

function syncReadout(): void {
  el('readout-body').innerHTML = renderReadout(state.world, state.day);
  const health = healthState(state.world);
  const badge = el('health-badge');
  badge.textContent = health.label;
  badge.dataset.state = health.state;
}

let urlTimer = 0;
function syncUrl(): void {
  // Debounced: the day scrubber fires continuously while dragging.
  window.clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const next = new URL(window.location.href);
    next.searchParams.set('seed', String(state.seed));
    next.searchParams.set('day', String(state.day));
    next.searchParams.set('overlay', state.overlay);
    if (state.viewing >= 0) next.searchParams.set('dungeon', String(state.viewing));
    else next.searchParams.delete('dungeon');
    if (!state.showPois) next.searchParams.set('pins', '0');
    else next.searchParams.delete('pins');
    window.history.replaceState(null, '', next);
  }, 250);
}

// ---------------------------------------------------------------- helpers

function isOverlay(value: string): value is Overlay {
  return value === 'tiles' || value === 'biome' || value === 'elevation' || value === 'walkable';
}

function clampDay(day: number): number {
  if (!Number.isFinite(day)) return 0;
  return Math.max(0, Math.min(FLOOD_DAYS, day));
}

function isTyping(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
}

// ---------------------------------------------------------------- boot

for (const chip of el('overlay-chips').querySelectorAll<HTMLButtonElement>('[data-overlay]')) {
  chip.classList.toggle('is-active', chip.dataset.overlay === state.overlay);
}
poiToggle.classList.toggle('is-active', state.showPois);

buildMapChips();
syncAll();
viewport.resize();
resizeViewportToMap();

// Fade the gesture hint once you've had a moment to read it.
setTimeout(() => hint.setAttribute('data-faded', 'true'), 3500);

// Expose state for debugging from the browser console.
Object.assign(window as unknown as Record<string, unknown>, {
  flood: { state, viewport, regenerate },
});
