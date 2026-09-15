# The Flood

2D Zelda-inspired roguelike. Explore the world. Crawl the dungeons. Survive the flood.

A procedurally generated overworld drains from the south while you climb north gathering
material for an ark. Forty days. Permadeath. One seed, one world, one run.

```
npm install
npm run dev          # game at /, world inspector at /dev/
npm test             # unit tests over the simulation
npm run test:e2e     # screenshots into ./screenshots
npx tsx scripts/survey.ts 12   # worldgen tuning report
```

## The two things to look at

**The game** (`/`) — arrows or WASD to move, space swings the Rod of Aaron, `E` uses
(enter a dungeon, imbue the Rod at a shrine, frame the skiff, launch), `B` opens the flock,
`F3` shows frame times, `R` restarts, hold shift to fast-forward the clock. `?seed=12345`
replays an exact world; `?speed=60` compresses the two-hour run into a couple of minutes
for testing.

**The world inspector** (`/dev/`) — a phone-first view onto the same generator the game
runs. Pan and pinch the whole map, drag the day slider to watch the world drown, tap any
panel for its sprites and its raw bytes, and switch overlays for biome, elevation and
walkability. The seed lives in the URL, so a link is a world.

## Play-and-hotfix

`npm run dev` is a live session, not a build. Leave the game open. Edits to rules,
rendering, controls, or the palette land through Vite HMR without restarting the run —
you keep walking, the next frame uses the new code. A `LIVE` badge means the loop is
connected; a toast flashes when a patch lands.

Worldgen and most of `DEFAULT_PARAMS` only run when a world is created, so those edits
apply the next time you press `R`. `secondsPerDay` is the exception: it is read every
step, so the flood clock updates on the live run.

## How it fits together

One Vite + TypeScript project, no game engine, two HTML entry points over one source tree.
The important structural property: **the game and the inspector import the same `src/core/`
module**. There is no export step and no synchronised copy, so the inspector cannot show
you a world the game wouldn't generate.

```
src/core/      pure simulation, zero DOM — worldgen, flood, resources, serialization
src/render/    palette and the tilesheet, drawn in code (no binary assets)
src/game/      canvas renderer, input, game loop
src/devtool/   the world inspector
tests/         vitest over core + game; playwright for screenshots
```

## Design decisions worth knowing

**Elevation is the spine.** One byte per tile drives biome selection, tile painting *and*
the flood. Because all three read the same field, the world reads as one landscape rather
than three systems that happen to overlap.

**The flood is a scalar, not a schedule.** Water is a single rising number compared against
per-tile elevation: `submerged ⟺ elev < waterLevel(day)`. Rows still go under at roughly one
per day, because elevation trends north-south — but hilltops in a drowned row survive as
shrinking islands and low valleys flood early, with no special-casing anywhere. Two days of
grace before the water starts; everything is gone by day 40.

**A panel is 176 bytes.** 16×11 tiles, exactly a Zelda 1 screen. A panel serialises to a
tile plane plus an elevation plane (352 B); the whole 12×40 map is 169 KB explicit, or
16 bytes as a seed. The inspector's hex dump is the same data the renderer draws.

**Connectivity is repaired, not hoped for.** Worldgen runs an explicit pass (Dial's
algorithm outward from the mainland) that carves the cheapest route into every stranded
region, and re-verifies afterwards. Every walkable tile is reachable; every panel is
enterable. Both are tested across many seeds.

**Winnability is a test.** A time-expanded reachability check asks whether the player could
actually walk to enough of each resource *before it drowns*, given the flood curve. Worlds
that fail are regenerated. This is what separates a roguelike from a random number
generator.

**The Rod of Aaron is weapon and tool.** The same swing that will fight things later is what
harvests a resource node now. From the deck of the skiff it dredges nodes the flood has
already covered — there is no fishing pole.

**Two of every kind.** Ten biblical kinds, two of each, wander their home biomes. Walking
into one takes it aboard. A complete flock is a high score, not a win condition: the ark
still launches on timber and pitch. Best flock is kept in localStorage.

**The skiff is not the ark.** Frame it at the valley slipway from 8 gopher wood and 6 fiber,
then walk into water from any shore. It lets you occupy the flood instead of drowning in it.

**Dungeons cost you the ark.** One per biome, 4x4 rooms where each room is exactly one panel
— so they share the overworld's format, renderer and inspector for free. Chasms are bridged
with gopher wood and ledges roped with fiber, both drawn from the same stock the hull needs,
and the price is on screen while you decide. A dungeon's entrance seals when the water
reaches it; the first usually goes under around day 7.

## Tuning

Every worldgen number lives in one typed object, `DEFAULT_PARAMS` in `src/core/config.ts` —
map size, elevation shape, biome band edges, scatter and resource density, day length.
Change one and run the survey to see what it did across many seeds:

```
npx tsx scripts/survey.ts 12
```

It reports biome share, resource supply against the ark recipe, walkable fraction,
connectivity and solvability rates, and how much dry ground remains at each quarter of
the flood. Biome bands and resource densities were both set this way.

## The frame budget

**No frame may miss a vsync.** The simulation is pinned at a fixed 60Hz, independent of the
display, so the flood and collision play out identically everywhere. The render runs once per
vsync at whatever rate the display offers and interpolates between the last two simulation
states, so a 144Hz screen is genuinely smoother rather than showing each state twice.
Catch-up stepping is bounded by wall-clock time rather than by a step count, so a
fast-forward or a slow frame slips the in-game clock instead of producing a long frame. The
loop allocates nothing per frame — the collection that reclaims a steady drip of garbage is
the frame that hitches — and the HUD map caches its raster instead of rescanning 480 panels
every frame.

"Locked 144" is not achievable in a browser: rAF fires at the display's rate, whatever that
is. "Never misses its deadline" is stricter where it counts, and it can be tested.

`F3` shows fps, frame-time p50/p99, the worst frame in the last few seconds, and the count of
frames that missed a vsync — that last number should read 0. `npm run test:e2e` plays a real
session and fails the build if it doesn't.

## Status

Playable end to end: worldgen, the flood, resource gathering, the ark, the flock, the
skiff, win/lose, and dungeons with the resource trade. Wave 1 of `docs/ROADMAP.md` is in:
a river you can sail, escarpments you have to find stairs through, towns with roads that
go somewhere, a pasture for the sheep, Noah's tent at spawn, and an ark that grows as you
build it. Enemies, shops, the voice of God as a recurring character, and the ocean stage
are still ahead.
