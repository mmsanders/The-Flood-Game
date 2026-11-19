import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

/**
 * Wave 6 for review as images: walking off the edge into the endless sand,
 * the stranger's path, and the oasis at the end of it.
 */

const OUT = 'screenshots';
const SEED = '20260830';
const KEY = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

type Win = { flood: { state: any; render: () => void } };

test.describe('wave 6', () => {
  test.beforeEach(async ({}, info) => {
    if (info.project.name !== 'desktop') test.skip();
  });

  test('the endless sand and the oasis', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(300);

    // Midday in the prologue, standing in the gate.
    const side = await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      const g = s.world.desert.gate;
      s.elapsed = s.world.params.secondsPerDay * 2.5;
      const wall = g.side === 1 ? s.world.w - 1 : 0;
      s.player.x = (wall - g.side * 3) * 16 + 3;
      s.player.y = (g.y0 + 1) * 16 + 2;
      s.player.prevX = s.player.x;
      s.player.prevY = s.player.y;
      s.camera.panelX = Math.floor(s.player.x / 256);
      s.camera.panelY = Math.floor(s.player.y / 176);
      s.camera.fromX = s.camera.panelX;
      s.camera.fromY = s.camera.panelY;
      s.camera.scroll = 0;
      return g.side;
    });
    await page.screenshot({ path: `${OUT}/game-desert-gate.png` });

    const out = side === 1 ? 'ArrowRight' : 'ArrowLeft';
    await page.keyboard.down(out);
    await page.waitForTimeout(900);
    await page.keyboard.up(out);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as Win).flood.state.location.kind)).toBe('desert');
    await page.screenshot({ path: `${OUT}/game-desert-sand.png` });

    // Seven steps already walked; take the eighth.
    const last = await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      s.desertSteps = 7;
      return s.world.desert.gate.code[7];
    });
    await page.keyboard.down(KEY[last]);
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(100);
      if (await page.evaluate(() => (window as unknown as Win).flood.state.inOasis)) break;
    }
    await page.keyboard.up(KEY[last]);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => (window as unknown as Win).flood.state.inOasis)).toBe(true);
    await page.screenshot({ path: `${OUT}/game-desert-oasis.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the stranger at the carpenter', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      const room = s.world.interiors.find((r: any) => r.kind === 2);
      s.location = { kind: 'interior', dungeonId: -1, interiorId: room.id, returnTo: room.overworldEntrance };
      s.player.x = room.lore.x * 16 + 3;
      s.player.y = room.lore.y * 16 + 2;
      s.player.prevX = s.player.x;
      s.player.prevY = s.player.y;
      s.camera.panelX = 0;
      s.camera.panelY = 0;
      s.camera.fromX = 0;
      s.camera.fromY = 0;
    });
    await page.waitForTimeout(150);
    await page.keyboard.press('e');
    await page.waitForTimeout(400);
    const title = await page.evaluate(() => (window as unknown as Win).flood.state.banner?.title);
    expect(title).toMatch(/^[NESW](, [NESW]){7}$/);
    await page.screenshot({ path: `${OUT}/game-desert-stranger.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
