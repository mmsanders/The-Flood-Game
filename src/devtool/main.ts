/**
 * The Flood — world inspector.
 *
 * A phone-first view onto the same worldgen the game runs. Nothing here has a
 * private copy of the simulation: it imports `core/` directly, so what you see
 * on your phone is exactly what the game would generate from that seed.
 */

import { DEFAULT_PARAMS, FLOOD_DAYS, PANEL_H, PANEL_W } from '../core/config.js';
import { parseSeed, randomSeed } from '../core/rng.js';
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
};

/** Cached 1px-per-tile bitmap; only rebuilt when the world, day or overlay changes. */
let bitmap: HTMLCanvasElement | OffscreenCanvas | null = null;
let bitmapKey = '';

function overviewBitmap(): HTMLCanvasElement | OffscreenCanvas {
  const key = `${state.seed}|${state.day}|${state.overlay}`;
  if (!bitmap || key !== bitmapKey) {
    bitmap = renderOverviewBitmap(state.world, {
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
    ctx.drawImage(overviewBitmap() as CanvasImageSource, 0, 0);
    drawPanelGrid(ctx, state.world, scale);
    if (state.showPois) drawPoiMarkers(ctx, state.world, scale);
  },
  onTap: (x, y) => {
    const px = Math.floor(x / PANEL_W);
    const py = Math.floor(y / PANEL_H);
    if (px < 0 || py < 0 || px >= state.world.params.panelsX || py >= state.world.params.panelsY) {
      return;
    }
    openPanelSheet(sheetRefs, state.world, px, py, state.day);
  },
});

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
  syncAll();
  viewport.requestDraw();
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

syncAll();
viewport.resize();
viewport.fit();

// Fade the gesture hint once you've had a moment to read it.
setTimeout(() => hint.setAttribute('data-faded', 'true'), 3500);

// Expose state for debugging from the browser console.
Object.assign(window as unknown as Record<string, unknown>, {
  flood: { state, viewport, regenerate },
});
