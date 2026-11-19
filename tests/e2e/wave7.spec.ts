import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

/**
 * Wave 7 for review as images: a lived-in farm with its farmer, a farm with
 * a story, and a town full of people.
 */

const OUT = 'screenshots';
const SEED = '20260830';

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

type Win = { flood: { state: any; render: () => void } };

async function standAt(page: import('@playwright/test').Page, tx: number, ty: number): Promise<void> {
  await page.evaluate(
    ([x, y]) => {
      const s = (window as unknown as Win).flood.state;
      s.elapsed = s.world.params.secondsPerDay * 2.5;
      s.player.x = x * 16 + 3;
      s.player.y = y * 16 + 2;
      s.player.prevX = s.player.x;
      s.player.prevY = s.player.y;
      s.camera.panelX = Math.floor(s.player.x / 256);
      s.camera.panelY = Math.floor(s.player.y / 176);
      s.camera.fromX = s.camera.panelX;
      s.camera.fromY = s.camera.panelY;
      s.camera.scroll = 0;
      s.message = null;
    },
    [tx, ty],
  );
  await page.waitForTimeout(700);
}

test.describe('wave 7', () => {
  test.beforeEach(async ({}, info) => {
    if (info.project.name !== 'desktop') test.skip();
  });

  test('farms, the farmer, and a town full of people', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(300);

    const farms = await page.evaluate(() =>
      (window as unknown as Win).flood.state.world.homesteads.map((f: any) => ({ x: f.x, y: f.y, state: f.state })),
    );
    const lived = farms.find((f: any) => f.state === 0);
    await standAt(page, lived.x + 1, lived.y + 2);
    const prompt = await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      return s.world.people.filter((p: any) => p.role === 1).length;
    });
    expect(prompt).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}/game-farm-lived-in.png` });

    const story = farms.find((f: any) => f.state !== 0);
    await standAt(page, story.x + 1, story.y + 3);
    await page.screenshot({ path: `${OUT}/game-farm-${story.state === 1 ? 'abandoned' : 'fallen-fence'}.png` });

    const town = await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      // The biggest town, standing a little off its square.
      const towns = s.world.places.filter((q: any) => q.homestead < 0);
      const p = towns.reduce((a: any, b: any) => (b.spots.length > a.spots.length ? b : a));
      return p.spots[5];
    });
    const w = await page.evaluate(() => (window as unknown as Win).flood.state.world.w);
    await standAt(page, town % w, Math.floor(town / w));
    await page.screenshot({ path: `${OUT}/game-town-people.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
