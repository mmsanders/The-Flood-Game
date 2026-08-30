# The Flood

2D Zelda-inspired roguelike. Explore the world. Crawl the dungeons. Survive the flood.

A procedurally generated overworld drains from the south while you climb north gathering
material for an ark. Forty days. Permadeath. One seed, one world, one run.

```
npm install
npm run dev          # game at /, world inspector at /dev/
npm test             # 137 unit tests over the simulation
npm run test:e2e     # screenshots into ./screenshots
npx tsx scripts/survey.ts 12   # worldgen tuning report
```

## The two things to look at

**The game** (`/`) — arrows or WASD to move, space swings the Rod of Aaron, `R` restarts,
hold shift to fast-forward the clock. `?seed=12345` replays an exact world; `?speed=60`
compresses the hour-long run into a minute for testing.

**The world inspector** (`/dev/`) — a phone-first view onto the same generator the game
runs. Pan and pinch the whole map, drag the day slider to watch the world drown, tap any
panel for its sprites and its raw bytes, and switch overlays for biome, elevation and
walkability. The seed lives in the URL, so a link is a world.

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
harvests a resource node now.

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

## Status

Playable end to end: worldgen, the flood, resource gathering, the ark, win/lose, and
dungeons with the resource trade. Enemies, towns and money, the voice of God as a recurring
character, and the ocean stage are designed for but not yet built — see `docs/DESIGN.md`.
