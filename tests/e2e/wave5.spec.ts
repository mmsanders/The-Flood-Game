import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

/**
 * Wave 5 for review as images: the rain arriving, a cave filling from the
 * bottom, and a string of animals on the rope.
 */

const OUT = 'screenshots';
const SEED = '20260830';

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

type Win = { flood: { state: any; render: () => void } };

test.describe('wave 5', () => {
  test.beforeEach(async ({}, info) => {
    if (info.project.name !== 'desktop') test.skip();
  });

  test('the rain begins', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/game-prologue.png` });

    // Mid-morning, just before the prologue ends; the next steps cross it.
    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      s.elapsed = s.world.params.secondsPerDay * 4.999;
    });
    await page.waitForTimeout(1200);
    const banner = await page.evaluate(() => (window as unknown as Win).flood.state.banner?.title);
    expect(banner).toBe('THE RAIN BEGINS.');
    await page.screenshot({ path: `${OUT}/game-rain-begins.png` });

    // A day into the rain: grey light, rain, wet ledges.
    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      s.elapsed = s.world.params.secondsPerDay * 6.3;
      s.bannerTimer = 0;
      s.banner = null;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/game-raining.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a cave filling from the bottom', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const w = window as unknown as Win;
      const s = w.flood.state;
      // The highest cave fills slowest; put the waterline mid-dungeon.
      let d = s.world.dungeons[0];
      for (const c of s.world.dungeons) {
        const e = (p: any) => s.world.elev[p.overworldEntrance.y * s.world.w + p.overworldEntrance.x];
        if (e(c) > e(d)) d = c;
      }
      const mouth = s.world.elev[d.overworldEntrance.y * s.world.w + d.overworldEntrance.x];
      const sealed = 5 + (mouth / 256) * 35;
      s.elapsed = s.world.params.secondsPerDay * (5 + (sealed - 5) * 0.4);
      s.rainBegun = true;
      s.message = null;
      s.location = { kind: 'dungeon', interiorId: -1, dungeonId: d.id, returnTo: d.overworldEntrance };
      // Stand in the third row of rooms, above the water if it has not got there.
      const ry = 2;
      const rx = Math.floor(d.stairs.x / 16);
      s.player.x = (rx * 16 + 8) * 16 + 3;
      s.player.y = (ry * 11 + 2) * 16 + 2;
      s.camera.panelX = rx;
      s.camera.panelY = ry;
      s.camera.fromX = rx;
      s.camera.fromY = ry;
      s.camera.scroll = 0;
      w.flood.render();
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/game-dungeon-flood.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a string of animals on the rope', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      s.hasRope = true;
      // Open ground in the middle of the panel, so the string has room.
      const w = s.world;
      const cx = s.camera.panelX * 16 + 12;
      const cy = s.camera.panelY * 11 + 5;
      for (let y = cy - 3; y <= cy + 3; y++) {
        for (let x = cx - 9; x <= cx + 2; x++) {
          w.tiles[y * w.w + x] = 0x00;
          w.elev[y * w.w + x] = 250;
        }
      }
      s.mapRevision++;
      s.player.x = cx * 16 + 3;
      s.player.y = cy * 16 + 2;
      s.player.prevX = s.player.x;
      s.player.prevY = s.player.y;
      // Bring four creatures to Noah's feet; walking catches them.
      const px = s.player.x;
      const py = s.player.y;
      for (const a of s.world.animals.slice(0, 4)) {
        a.x = px;
        a.y = py;
        a.prevX = px;
        a.prevY = py;
      }
    });
    // Walk them around the tent a little so the string strings out.
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(900);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
    await page.evaluate(() => {
      const s = (window as unknown as Win).flood.state;
      s.message = null;
      s.messageTimer = 0;
    });
    await page.waitForTimeout(100);
    const led = await page.evaluate(() => (window as unknown as Win).flood.state.string.length);
    expect(led).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}/game-rope-string.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
