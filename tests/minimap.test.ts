import { describe, expect, it } from 'vitest';
import { PANEL_H, PANEL_W, withParams } from '../src/core/config.js';
import { Biome } from '../src/core/tiles.js';
import { PoiKind } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  MiniPoi,
  cellRect,
  dominantBiome,
  floodFillHeight,
  followMinimapView,
  layoutMiniMap,
  minimapFlatColor,
  minimapLandColor,
  minimapWaterColor,
  panelPoi,
  sampleMinimapPixel,
} from '../src/game/minimap.js';

const WELL = { x: 0, y: 0, w: 40, h: 40 };

const WORLD = { cols: 12, rows: 40 };

function layoutOf(cells: { x: number; y: number }[]) {
  return layoutMiniMap(cells, WELL.x, WELL.y, WELL.w, WELL.h, WORLD.cols, WORLD.rows);
}

describe('minimap layout', () => {
  it('draws a single panel as one centred square, wherever it sits in the world', () => {
    const nw = layoutOf([{ x: 0, y: 0 }]);
    const se = layoutOf([{ x: 11, y: 39 }]);
    expect(nw).not.toBeNull();
    expect(se).not.toBeNull();
    if (!nw || !se) return;

    expect(nw.scrolls).toBe(false);
    expect(nw.cell).toBe(se.cell);
    expect(nw.originX).toBe(se.originX);
    expect(nw.originY).toBe(se.originY);
    expect(nw.originX).toBeGreaterThan(0);
    expect(nw.cell).toBeLessThan(WELL.w);
    expect(nw.cell).toBeGreaterThan(WELL.w / 2);
    expect(cellRect(nw, 0, 0).w).toBe(cellRect(nw, 0, 0).h);
    expect(cellRect(nw, 0, 0)).toEqual(cellRect(se, 11, 39));
  });

  it('pops a new tile on the explored side and recentres, without empty world-padding', () => {
    const south = { x: 5, y: 10 };
    const north = { x: 5, y: 9 };
    const layout = layoutOf([south, north]);
    expect(layout).not.toBeNull();
    if (!layout) return;

    expect(layout.cols).toBe(1);
    expect(layout.rows).toBe(2);
    expect(layout.cell).toBeGreaterThan(10);
    expect(layout.cell).toBe(cellRect(layout, south.x, south.y).h);

    // One column nearly fills the width; two tall squares pan rather than shrink.
    expect(layout.originX).toBeGreaterThan(0);
    expect(layout.scrolls).toBe(true);
  });

  it('does not shrink to full-world tile size just because the trail is tall', () => {
    const cells = [];
    for (let y = 20; y <= 32; y++) {
      cells.push({ x: 4, y });
      cells.push({ x: 5, y });
      cells.push({ x: 6, y });
    }
    const layout = layoutOf(cells);
    expect(layout).not.toBeNull();
    if (!layout) return;

    expect(layout.cols).toBe(3);
    expect(layout.cell).toBeGreaterThan(Math.floor(WELL.w / WORLD.cols));
    expect(layout.originX).toBeGreaterThan(0);
    expect(layout.originX + layout.cols * layout.cell + (layout.cols - 1) * layout.gap).toBeLessThan(
      WELL.w,
    );
    expect(layout.scrolls).toBe(true);
  });

  it('keeps square tiles and only fills width once east-west is complete', () => {
    const cells = [];
    for (let x = 0; x < WORLD.cols; x++) {
      cells.push({ x, y: 10 });
      cells.push({ x, y: 11 });
    }
    const layout = layoutOf(cells);
    expect(layout).not.toBeNull();
    if (!layout) return;

    expect(layout.scrolls).toBe(false);
    expect(layout.cols).toBe(WORLD.cols);

    const first = cellRect(layout, 0, 10);
    const last = cellRect(layout, WORLD.cols - 1, 11);
    expect(first.w).toBe(first.h);
    expect(last.w).toBe(last.h);
    expect(first.x).toBeGreaterThan(0);
    expect(last.x + last.w).toBeLessThan(WELL.w);
    expect(last.y + last.h - first.y).toBe(2 * layout.cell + layout.gap);
    expect(last.y + last.h - first.y).toBeLessThan(WELL.h);
  });

  it('scrolls a fully explored tall world instead of squashing tiles', () => {
    const cells = [];
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 12; x++) cells.push({ x, y });
    }
    const layout = layoutOf(cells);
    expect(layout).not.toBeNull();
    if (!layout) return;

    expect(layout.scrolls).toBe(true);
    expect(layout.cell).toBe(Math.floor(WELL.w / WORLD.cols));

    const atTop = cellRect(layout, 0, 0, 0);
    const below = cellRect(layout, 0, 1, 0);
    expect(atTop.w).toBe(atTop.h);
    expect(below.y - atTop.y).toBe(layout.cell);
    expect(40 * layout.cell).toBeGreaterThan(WELL.h);
  });

  it('keeps the player two-thirds up while heading north, and waits to scroll south', () => {
    const cell = 3;
    const wellH = 40;
    const worldRows = 40;
    const viewRows = wellH / cell;
    let viewY = 20;

    // Inside the dead zone: no motion.
    const mid = 20 + viewRows / 2;
    expect(followMinimapView(viewY, mid, cell, wellH, worldRows, true)).toBe(20);

    // Climb north past two-thirds up: the view follows.
    const north = followMinimapView(viewY, 20 + viewRows / 3 - 2, cell, wellH, worldRows, true);
    expect(north).toBeLessThan(viewY);

    // Walk south a little: still in the dead zone, no follow.
    viewY = north;
    const player = north + viewRows / 3 + 1;
    expect(followMinimapView(viewY, player, cell, wellH, worldRows, true)).toBe(viewY);

    // Walk south past two-thirds down: the view follows.
    const south = followMinimapView(viewY, north + (2 * viewRows) / 3 + 2, cell, wellH, worldRows, true);
    expect(south).toBeGreaterThan(viewY);
  });

  it('returns null when nothing has been explored', () => {
    expect(layoutOf([])).toBeNull();
  });
});

describe('minimap flood tint', () => {
  it('is biome-coloured when dry and deep blue when drowned', () => {
    expect(minimapFlatColor(Biome.Valley, 0)).toBe('rgb(127,191,79)');
    expect(minimapFlatColor(Biome.Forest, 0)).toBe('rgb(47,125,56)');
    expect(minimapFlatColor(Biome.Valley, 1)).toBe('rgb(28,74,128)');
    expect(minimapLandColor(Biome.Valley, 0)).toBe('rgb(127,191,79)');
  });

  it('moves toward water as the panel drowns, without jumping', () => {
    const dry = minimapFlatColor(Biome.Valley, 0);
    const mid = minimapFlatColor(Biome.Valley, 0.5);
    const wet = minimapFlatColor(Biome.Valley, 1);
    expect(mid).not.toBe(dry);
    expect(mid).not.toBe(wet);
    expect(minimapWaterColor(0.2)).toBe(minimapWaterColor(0.4));
    expect(minimapWaterColor(1)).not.toBe(minimapWaterColor(0.4));
  });

  it('fills water from the bottom of a cell, rounded to pixels', () => {
    expect(floodFillHeight(20, 0)).toBe(0);
    expect(floodFillHeight(20, 0.5)).toBe(10);
    expect(floodFillHeight(20, 1)).toBe(20);
    expect(floodFillHeight(19, 0.1)).toBeGreaterThanOrEqual(1);
  });
});

describe('minimap terrain and landmarks', () => {
  const SMALL = withParams({ panelsX: 8, panelsY: 20 });
  const world = generateWorld(4242, SMALL);

  it('paints a panel from its real tiles, not a flat brown', () => {
    const px = Math.floor(world.spawn.x / PANEL_W);
    const py = Math.floor(world.spawn.y / PANEL_H);
    const pixel = sampleMinimapPixel(world, px, py, 0.5, 0.5, 0);
    expect(pixel).not.toBe('rgb(106,90,56)');
    expect(pixel.startsWith('rgb(') || pixel.startsWith('#')).toBe(true);
  });

  it('reports the majority biome of a panel', () => {
    const px = Math.floor(world.spawn.x / PANEL_W);
    const py = Math.floor(world.spawn.y / PANEL_H);
    expect(dominantBiome(world, px, py)).toBe(Biome.Valley);
  });

  it('pins a dungeon on the panel that holds its entrance', () => {
    const d = world.pois.find((p) => p.kind === PoiKind.Dungeon);
    expect(d).toBeDefined();
    if (!d) return;
    const px = Math.floor(d.x / PANEL_W);
    const py = Math.floor(d.y / PANEL_H);
    expect(panelPoi(world.pois, px, py)).toBe(MiniPoi.Dungeon);
    expect(panelPoi(world.pois, px + 2, py)).not.toBe(MiniPoi.Dungeon);
  });

  it('pins the ark on its panel', () => {
    const px = Math.floor(world.ark.x / PANEL_W);
    const py = Math.floor(world.ark.y / PANEL_H);
    expect(panelPoi(world.pois, px, py)).toBe(MiniPoi.Ark);
  });
});
