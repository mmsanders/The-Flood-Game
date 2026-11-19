import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

/**
 * Wave 8 for review as images: the full-screen map with and without the
 * Chart, the Lodestone needle, clear water under the Sounding Line, and a
 * line in the water.
 */

const OUT = 'screenshots';
const SEED = '20260830';

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

type Win = { flood: { state: any; render: () => void } };

test.describe('wave 8', () => {
  test.beforeEach(async ({}, info) => {
    if (info.project.name !== 'desktop') test.skip();
  });

  test('the map, the needle, the clear water and the line', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(300);

    // Explore a wide swathe, then open the map without and with the Chart.
    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      const g = s.exploredOverworld;
      for (let i = 0; i < g.length; i++) if (i % 12 < 10 && Math.floor(i / 12) > 14) g[i] = 1;
      s.elapsed = s.world.params.secondsPerDay * 9;
      s.rainBegun = true;
    });
    await page.keyboard.press('m');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/game-map-no-chart.png` });
    await page.keyboard.press('m');
    await page.evaluate(() => {
      (window as unknown as Win).flood.state.hasChart = true;
    });
    await page.keyboard.press('m');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/game-map-chart.png` });
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: `${OUT}/game-map-scrolled.png` });
    await page.keyboard.press('m');

    // Afloat with the Sounding Line over a drowned field, the Lodestone in hand.
    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      s.hasLodestone = true;
      s.hasSoundingLine = true;
      s.hasFishingRod = true;
      s.hasBoat = true;
      s.inBoat = true;
      s.boatDepth = 3;
      const w = s.world;
      const x0 = s.camera.panelX * 16 + 4;
      const y0 = s.camera.panelY * 11 + 3;
      for (let y = y0; y < y0 + 6; y++) {
        for (let x = x0; x < x0 + 9; x++) {
          w.elev[y * w.w + x] = 5;
          w.tiles[y * w.w + x] = (x + y) % 3 === 0 ? 0x20 : (x * y) % 5 === 0 ? 0x22 : 0x00;
        }
      }
      s.elapsed = s.world.params.secondsPerDay * 14;
      s.player.x = (x0 + 4) * 16 + 3;
      s.player.y = (y0 + 2) * 16 + 2;
      s.player.prevX = s.player.x;
      s.player.prevY = s.player.y;
      s.player.dir = 3;
      s.mapRevision++;
      s.message = null;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/game-sounding-clear.png` });

    // A line in the water.
    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      s.castX = Math.floor((s.player.x + 5) / 16) + 2;
      s.castY = Math.floor((s.player.y + 6) / 16);
      s.castT = 30;
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/game-fishing.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
