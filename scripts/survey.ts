/**
 * Worldgen survey: generate a batch of worlds and print the aggregate shape.
 *
 * This is the tuning instrument — run it after changing any worldgen parameter
 * to see what the change did to biome balance, resource supply, and solvability
 * across many seeds rather than one lucky one.
 *
 *   npx tsx scripts/survey.ts [count] [--small]
 */

import { DEFAULT_PARAMS, FLOOD_DAYS, withParams } from '../src/core/config.js';
import { OBSTACLE_COST, REWARD_NAMES } from '../src/core/dungeon.js';
import { drownDayForElev } from '../src/core/flood.js';
import { ARK_RECIPE } from '../src/core/resources.js';
import { BIOME_NAMES, Biome, RESOURCE_NAMES, Resource } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';

const count = Number(process.argv[2] ?? 12);
const small = process.argv.includes('--small');
const params = small ? withParams({ panelsX: 8, panelsY: 20 }) : DEFAULT_PARAMS;

console.log(
  `Surveying ${count} worlds at ${params.panelsX}x${params.panelsY} panels ` +
    `(${params.panelsX * params.panelsY} panels, ` +
    `${params.panelsX * 16 * params.panelsY * 11} tiles)\n`,
);

const biomeTotals = [0, 0, 0, 0];
const nodeTotals = [0, 0, 0, 0];
const reachTotals = [0, 0, 0, 0];
let walkable = 0;
let total = 0;
let connected = 0;
let solvable = 0;
let genMs = 0;
let dungeonCount = 0;
let dungeonToll = 0;
let dungeonRooms = 0;
const rewardCounts = new Map<string, number>();
const sealDays: number[] = [];

for (let i = 0; i < count; i++) {
  const seed = 1000 + i * 7919;
  const t0 = performance.now();
  const world = generateWorld(seed, params);
  genMs += performance.now() - t0;

  for (let b = 0; b < 4; b++) biomeTotals[b] += world.stats.biomeTiles[b];
  for (let r = 0; r < 4; r++) {
    nodeTotals[r] += world.stats.resourceNodes[r];
    reachTotals[r] += world.stats.reachableResources[r];
  }
  walkable += world.stats.walkableTiles;
  total += world.stats.totalTiles;
  if (world.stats.connected) connected++;
  if (world.stats.solvable) solvable++;
  else console.log(`  seed ${seed}: ${world.stats.problems.join('; ')}`);

  for (const d of world.dungeons) {
    dungeonCount++;
    dungeonRooms += d.rooms.length;
    dungeonToll += d.obstacles.reduce(
      (sum, o) => sum + (OBSTACLE_COST[o.tile]?.amount ?? 0),
      0,
    );
    const name = REWARD_NAMES[d.reward];
    rewardCounts.set(name, (rewardCounts.get(name) ?? 0) + 1);
    sealDays.push(
      drownDayForElev(world.elev[d.overworldEntrance.y * world.w + d.overworldEntrance.x]),
    );
  }
}

const avg = (n: number): string => (n / count).toFixed(0);
const pct = (n: number, d: number): string => ((n / d) * 100).toFixed(1) + '%';

console.log('\nBiome share (mean tiles per world)');
for (let b = 0; b < 4; b++) {
  console.log(
    `  ${BIOME_NAMES[b as Biome].padEnd(14)} ${avg(biomeTotals[b]).padStart(7)}  ${pct(
      biomeTotals[b],
      total,
    )}`,
  );
}

console.log('\nResource nodes (mean per world)');
for (let r = 0; r < 4; r++) {
  const need = ARK_RECIPE[r as Resource];
  const reach = reachTotals[r] / count;
  const ratio = reach / need;
  console.log(
    `  ${RESOURCE_NAMES[r as Resource].padEnd(14)} ` +
      `${avg(nodeTotals[r]).padStart(6)} on map  ` +
      `${avg(reachTotals[r]).padStart(6)} reachable  ` +
      `need ${String(need).padStart(3)}  ` +
      `supply x${ratio.toFixed(1)}`,
  );
}

console.log('\nDungeons');
console.log(`  per world       ${(dungeonCount / count).toFixed(1)}`);
console.log(`  rooms each      ${(dungeonRooms / Math.max(1, dungeonCount)).toFixed(1)}`);
console.log(
  `  toll on the ark ${(dungeonToll / Math.max(1, dungeonCount)).toFixed(1)} units mean`,
);
sealDays.sort((a, b) => a - b);
if (sealDays.length > 0) {
  const at = (f: number): string => sealDays[Math.floor(sealDays.length * f)].toFixed(1);
  // When the entrance drowns: the deadline for raiding each one.
  console.log(`  sealed by day   ${at(0)} / ${at(0.5)} / ${at(0.99)}  (first / median / last)`);
}
for (const [name, n] of [...rewardCounts.entries()].sort()) {
  console.log(`  ${name.padEnd(16)}${n}`);
}

console.log('\nHealth');
console.log(`  walkable        ${pct(walkable, total)}`);
console.log(`  connected       ${connected}/${count}`);
console.log(`  solvable        ${solvable}/${count}`);
console.log(`  generation      ${(genMs / count).toFixed(0)} ms/world`);

// A rough read on flood pacing: how much of the map is dry at each quarter.
const sample = generateWorld(1000, params);
console.log('\nDry ground remaining');
for (const day of [0, 10, 20, 30, 35, 40]) {
  let dry = 0;
  for (const e of sample.elev) if (drownDayForElev(e) > day) dry++;
  console.log(
    `  day ${String(day).padStart(2)}/${FLOOD_DAYS}   ${pct(dry, sample.elev.length).padStart(6)}`,
  );
}
