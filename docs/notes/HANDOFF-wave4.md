# Hand-off: Wave 4 (contour ledges), in progress

Written at the end of a cloud session so a local instance can pick up from the repo alone.
Delete this file when Wave 4 ships.

## Where things stand

**Merged: #17** (squash `0261533` on `main`). Four changes:

- `src/game/state.ts` was split into one module per system (types, queries, camera,
  movement, rod, skiff, trade, places, ground, instruments, run, actions). `state.ts` stays
  the single public entry point and the HMR boundary.
- The E key has one resolver (`actions.ts`, an ordered list of providers).
- The dove no longer releases underground.
- Single-room cave chests need the cave's key. Keys are held per cave (`keysByDungeon`).

`tests/actions.test.ts` and `tests/replay.test.ts` pin behaviour.

**This branch** (`claude/noahs-ark-roguelike-plan-tky1jp`, one WIP commit on top of
`main`) holds Wave 4 generation and survey tooling. It is **not finished**. Six tests fail
and are listed below.

## The design (approved by the owner)

**The biome seams are already ledges.** `markBiomeSeams` in
`src/core/worldgen/escarpments.ts` walls the band edges at elevation ~71/133/184, but only
blocks north–south steps. Wave 4 adds `contoursPerBand` more lines inside each band.
Default 1 gives lines at **~36/102/158/219**, so there are seven lines in all.

**The flood crosses one about every 5 days**, so the topographic map doubles as a flood
calendar. Owner note 10 in `docs/notes/ideas-02.md` is the origin: "impossible ledges with
stairs, but you can just walk around them". Contours must be **closed**.

**Implementation:** `src/core/worldgen/contours.ts`.

- `contourThresholds(params)` gives the thresholds. `markContours` reads terraces off a
  3×3 box-blurred elevation. Of every 4-neighbour pair that straddles a threshold, the
  higher tile is marked. Marks are grouped into 8-connected runs, and runs shorter than
  `MIN_CONTOUR_RUN` = 10 are dropped.
- `cutContours` stamps `Tile.Cliff` onto `UNPLANNED` plan tiles only. It places `Tile.Steps`
  every `CONTOUR_STAIR_STRIDE` = 24 tiles along a run, and only where the tiles straight
  across the ledge (low side and high side) are both unmarked and unplanned. Every run gets
  at least one stair if any spot qualifies. A contour tile beside a pre-existing stair
  becomes Steps too, so it widens that stair rather than walling it.
- Reusing `Tile.Cliff` means connectivity cost, `carveOpening` → Steps, roads refusing to
  pave Cliff, the face renderer and the minimap all work unchanged.

**Wiring:**

- `src/core/worldgen/index.ts` calls `cutContours` right after `carveLandforms` and before
  settlements, with its own `stageRng(seed, 'contours')` so other stages' randomness is
  untouched.
- `clearStairApproaches` now also runs *before* `ensureConnected`.
- `WorldParams.contoursPerBand` is set in `src/core/config.ts`, default 1.
- `world.stats.contours` = `{ lines, stairs, stairsCut }`, in `src/core/world.ts`.
- `ConnectivityResult.stairsCut` counts Cliff tiles the repair carved, in
  `src/core/worldgen/connectivity.ts`.

**Tooling:**

- `npx tsx scripts/survey.ts 12 [--small] [--contours=N]` now prints a "Contour ledges"
  section.
- `npx tsx scripts/diag-regions.ts [seed] [contoursPerBand]` reports the regions stranded
  before repair and what walls them.

## Survey so far (12 seeds, full size)

| | contours 0 | contours 1 |
|---|---|---|
| Solvable (single attempt) | 10/12 | 11/12 |
| Lines per world | 0 | 23.2 |
| Planned stairs per world | 0 | 95.6 |
| Cliff tiles cut by repair per world | 34.3 | 90.6 |
| Cliff share | 3.2% | 5.9% |
| Walkable | 69.7% | 68.1% |
| Generation | ~210 ms | ~240 ms |

The two solvability failures at contours 0 are pre-existing: the valley shrine drowns too
early on seeds 1000 and 72271.

## The open problem: repair still cuts too many stairs

Repair-cut stairs land wherever is cheapest and read as arbitrary, so the goal is to make
them rare. Contours add about 56 cut tiles per world. Running `clearStairApproaches` before
repair barely helped (95.4 → 90.6).

Before repair, the map is fragmented mostly by scatter (rocks and trees), even with
contours off: about 1,300 regions. So the metric partly counts cheap routes through cliffs
that repair picks over longer scatter routes.

Leads, most promising first:

1. **Stairs crossed east–west.** On diagonal stretches of contour, `isStairSpot` accepts a
   stair whose open sides are east and west. The `gates` test (below) expects every stair to
   be open north and south. Also check how `clearStairApproaches` / `seamGroup` treat it.
   Consider allowing only north–south crossings, as the seams do, or updating the test's
   expectation deliberately.
2. **Pockets with no stair**, between a contour and a seam, escarpment, plateau rim or water.
3. **A stair's far side planned over later** by towns or POIs (houses, fences, walls), or
   turned into Cliff by `sealElevationFaces`.
4. **Panel-seam mismatches** (`openSeamMismatches`) carving through cliffs at panel edges.

## Failing tests on this commit (all expected from a worldgen change)

- `tests/gates.test.ts` › stairs › "always has open ground above and below it": seed 1,
  a stair at 48,158 has a Tree to the south. See lead 1.
- `tests/resources.test.ts` › seed 67758: needs 6 generation attempts (limit 5).
  Contours cost solvability on this seed. Tune, don't raise the limit blindly.
- `tests/replay.test.ts` (3 runs) and `tests/actions.test.ts` › "releases the dove
  outdoors": these pin gameplay on the `SMALL` test world, whose terrain changed. Re-capture
  them **only once worldgen is final**, in its own commit, and say so in the PR:
  `npx vitest run -u tests/replay.test.ts tests/actions.test.ts`.

## Remaining checklist

- [ ] Get repair-cut stairs down (above), then re-run the survey.
- [ ] **Settlement footprint guard.** `pickSite` in `src/core/worldgen/settlements.ts` only
      rejects Cliff at the centre tile. Prefer sites with no Cliff anywhere inside the
      town's ellipse (rx, ry from `placeTown`), and fall back to today's behaviour if no
      site qualifies, so a town is never dropped.
- [ ] **`tests/contours.test.ts`:**
  - thresholds for default params, and how they move with `contoursPerBand`;
  - closure: every tile in a kept run ends up Cliff / Steps / Water / Gorge / Bridge /
    DungeonEntrance or otherwise not walkable;
  - every contour stair is open on both crossing sides;
  - no Cliff inside a settlement footprint;
  - the world is connected and winnable at shipping params across 12+ seeds;
  - the same seed gives the same contours.
- [ ] Fix or deliberately re-pin the failing tests above.
- [ ] **Inspector health readout** (`src/devtool/`): one row,
      "Contours: N lines · S stairs · C cut by repair".
- [ ] **`docs/ROADMAP.md`:**
  - mark Wave 4 shipped;
  - record the `state.ts` split (#17);
  - under Wave 5, note that dungeon flooding **revives the 4×4 multi-room generator**
    (`generateDungeon` in `src/core/dungeon.ts`, the owner's decision), with row-as-depth.
    Its chasm/ledge tolls and locked door in `src/game/ground.ts` are kept dormant for this.
- [ ] Screenshots: the overworld at day 0 and day 20, and a contour-dense panel.
- [ ] Refresh the owner's inspector Artifact:
      https://claude.ai/code/artifact/b812d3ab-0c4d-4987-a99a-91227177e506
- [ ] Open or refresh the PR. When CI is green, merge it (the owner has delegated merging),
      then confirm the Pages deploy.

## Gotchas

- Run `CI=true npx vitest run`, so a missing snapshot fails instead of being written.
- `npm run typecheck`, `npm test`, `npm run test:e2e` (Playwright; build first with
  `npm run build`).
- Hot reload: `main.ts` hot-accepts `./state.js` only. Everything in `src/game/` reaches it
  through `state.ts` or `render.ts`, so keep it that way.
- Don't `pkill -f` with a pattern that also matches your own shell's command line.
- Commit trailers the owner expects, and PR bodies ending with the Claude Code line: see
  earlier commits on `main`.
