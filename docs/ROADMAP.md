# The Flood — the roadmap

A plan written against two pages of brainstorm notes: `docs/notes/ideas-01.md`, written
before anything below was built, and `docs/notes/ideas-02.md`, written after the first
complete run — start to finish, ark built, won.

It is a reading of those notes as much as a schedule: what they are all secretly asking
for, which ones argue with each other, and what order to build them in so the expensive
ones land on foundations that already exist.

Nothing here is precious. Where I disagree with a note I say so and say why, and the note
wins if you still want it.

**Status:** Every wave has shipped (frame budget; the world people left behind; the
depth ladder and the things that beat it; interiors and instruments; contour ledges; the
rain begins; the endless sand), along with the round-two fixes in *What the first full run
changed* below. Next is Wave 7, which fills the world with signs of the people who live in it.

> Full Wave 0 / Wave 1 prose is unchanged from `main` history. This file keeps the
> Wave 2 write-up and the forward plan; expand from `main` if you need the long
> Wave 0 stutter autopsy or Wave 1 settlement tables.

---

## Wave 0 — The frame budget *(shipped)*

Never miss a vsync. Fixed 60 Hz simulation, interpolated render, allocation discipline,
perf overlay on F3, Playwright frame-budget gate. See `main` history for the full write-up.

## Wave 1 — The world people left behind *(shipped)*

Pipeline inversion: elevation → landforms → settlements → roads → siting → paint.
River/gorge highway, escarpments, towns, ark panel, Rod ladder validation. See `main`.

## What the first full run changed

Round-two fixes shipped on `main` before Wave 2 (ark panel, pitch seal, road costs,
gorge, cliff faces, shrine high ground, etc.). Note 14's skiff depth cap was held until
Wave 2 so the upgrade ladder could ship with it — and that half has now shipped.

---

## Wave 2 — Depth, and the things that beat it *(shipped)*

The strongest idea in round two is one you wrote across four separate notes without naming
it. Notes 1 (galoshes), 14 (skiff tiers, the sounding line), 15 (the skiff as an object) and
17 (water is depth 2) are all the same system:

> **Water has depth, and everything you own is an answer to a particular depth.**

| Depth | What it is | What crosses it |
|---|---|---|
| 0 | Dry | your feet |
| 1 | Ankle-deep; the gorge on the first day of rain | **galoshes**, at reduced speed |
| 2 | Over your head; any pond, the gorge by day 12 | **the skiff** |
| 3 | The channel late, the drowned lowlands | **a pitched skiff**, recaulked at a dock |
| 4 | The deep | nothing. That is what the ark is for. |

### 2.1 The skiff becomes an object (note 15) — shipped

A skiff that **sits where you left it** is a place on the map. Haul overland at half
speed, beach and walk, and if the deep closes around it while you are away, it is gone
and you build another. Dedicated beached-skiff tile; set-down / pick-up / portage.

### 2.2 The sounding line (note 14) — shipped

With the line aboard, drowned nodes around the skiff report clear depth and resource in
the contextual prompt — perception, not reach.

### 2.3 Barter, not money (notes 7, 20) — shipped

No currency. Marked town frontage (`TownDoor`, labeled Town Market) barters ark materials;
prices rise as biomes drown. Markets now sit behind shop doors (Wave 3); the outdoor `TownDoor` is the mouth.

### 2.4 Tools that break (notes 12, 13, 18, 20) — shipped

Axe and pickaxe: harvestable target = 1 durability; never-harvestable scenery = 2–3; both
yield one unit. Tool-first recovery when a shrine is about to drown.

### 2.5 Heart containers, earned (note 19) — shipped

Off the ground: dungeon chests remain; loose overworld hearts are retired at run start;
shop heart at a painful barter price; mountain hermit trades a rescued sheep for a heart
(now through the hermit interior).

---

## Wave 3 — Doors, and the people behind them *(shipped)*

### 3.1 Interiors — shipped

One-room interior primitive (same enter-from-south / stairs-back pattern as dungeon
rooms) for hermit, shop, carpenter, and Noah's tent. Town markets and the hermit trade
happen at the focus tile inside; the slipway opens the carpenter; the camp tent at
spawn is enterable. No second room system.

### 3.2 The instruments — shipped

Chart (colours the minimap; explored panels stay grey without it), Lodestone (bearing
to the ark on land or at sea), Dove (scout dry land or free beasts). Sounding Line and
Galoshes remain Wave 2. All three are bartered in shop interiors at prices that compete
with ark materials.

**Deferred deliberately:** fullscreen map key (Chart still drives HUD colour); a
distinct `Shop` tile art beyond the existing door (TownDoor / CampTent mouths are
enough).

## Playtest follow-ups (post–Wave 3)

Shipped on `playtest-road-auras-cliffs`:

- **Road auras.** Towns (and Noah's camp) radiate pavement that peters out;
  routes still *point* toward the next settlement, but wilderness gaps remain
  between auras so navigation is not a free highway. Connectivity repair still
  guarantees a solvable foot path without continuous paved roads.
- **Impassable cliff faces.** Escarpment bands are thickened and gap-filled;
  `Tile.Cliff` stays blocking. Stairs are cut only through really wide bands
  (plus whatever connectivity must open for solvability). Roads no longer pave
  Steps through every cliff they touch. The elevation-face overlay is drawn
  only on `Cliff`/`Steps` — a grass slope no longer pretends to be a wall —
  and any remaining 40-unit drop of walkable ground is sealed to `Cliff`
  before connectivity repair.
- **Resource abundance.** Modest ~15% density cut and slightly tighter
  clustering after playtest feedback that nodes never felt scarce. Shrine/ark
  solvability margins retained; revisit with more play data if still too easy.
- **Deferred:** scattered wayfinding signs if aura gaps prove too hard; full
  elevation contour ledges remain Wave 4.

## Playtest notes (post-cliff)

Gorge is a continuous channel with one bridge per biome. Scattered overworld
ladders are gone. Dungeon chests hold the rods and instruments — Budding Rod
behind pitch in the mountain, Serpent Rod behind stone in the scrub,
Chart / Galoshes split across forest and valley behind wood and reed.
Remaining kit is shop or hermit. Biome seams block north–south as a dark
cliff line with sideways stairs. A beached skiff keeps the ground it was
set on.

## Housekeeping: one module per system (#17) — shipped

`src/game/state.ts` is split into one module per system (types, queries, camera,
movement, rod, skiff, trade, places, ground, instruments, run, actions). `state.ts` stays
the single public entry point and the hot-reload boundary. The E key has one resolver,
an ordered list of providers in `actions.ts`. The dove no longer releases underground,
and a single-room cave's chest needs that cave's key. `tests/actions.test.ts` and
`tests/replay.test.ts` pin the behaviour.

## Wave 4 — Contour ledges *(shipped)*

Note 10: "impossible ledges with stairs". The biome seams were already ledges at the band
edges. Wave 4 adds `contoursPerBand` more lines inside each band (default 1, so lines at
elevation ~36 / 102 / 158 / 219 and seven in all). The flood rises at a constant rate,
so it crosses a ledge about every five days, and the topographic map doubles as a flood
calendar.

- **Closed, not decorative.** Unlike the seams, a contour walls every crossing, so you
  cannot walk round its end. It climbs by planned stairs every 24 tiles along the line,
  each with open ground straight across it. Stairs stay off the panel seams, where
  they used to pair with ledge across the boundary and force repair to cut it open.
- **Slivers become bank.** A strip of 24 tiles or fewer sealed between a ledge and a
  gorge, river or other wall becomes part of the ledge instead of a pocket that repair
  would cut a stair into.
- **Towns stand on one terrace.** Sites prefer a footprint with no ledge in it, but
  never at the cost of moving down a terrace. A town moved down would drag its shrine
  below the grace line. If no clean site exists on its own terrace, a town keeps its
  ledge rather than not being built.
- **Repair is the safety net, not the design.** A ledge costs repair as much as ten
  trees, so it takes the longer way through scatter when there is one. The repair's
  bucket queue also had fewer buckets than the gorge's cost, which settled gorge tiles out
  of order; fixing that is what made the cut count honest.
- **The numbers** (12 seeds, full size, `npx tsx scripts/survey.ts 12`): repair cuts
  about 54 ledge tiles per world against about 37 with contours off, and single-attempt
  solvability is unchanged. The inspector shows lines, stairs and repair cuts per world.

## Wave 5 — The rain begins *(shipped)*

Round-one notes 12, 13 and 16: the prologue, the dungeon flood, animals as logistics.

### 5.1 The prologue — shipped

`RAIN_DAY = 5` in `src/core/flood.ts`. The water is pinned at zero until then and climbs a
steeper ramp to the same day 40. The gorge front, the dungeon flood and the palette all
key off the same constant. Every tile drowns on the same day or later than under the old
two-day grace, so worldgen validation can only have got easier (tested).

The moment (`src/game/weather.ts`): a banner, *THE RAIN BEGINS.*, with the voice's first
real line; the light cools to slate over a third of a day on top of the time-of-day tint;
rain streaks the overworld; and a wet streak with a sliding bead runs down about half the
cliff faces, keyed to world tiles so a scrolling camera doesn't reshuffle them. A tick on
the HUD's day bar marks the rain day. All of it allocation-free per frame.

### 5.2 The dungeon flood — shipped

The 4×4 generator is back in worldgen, with the stairs in the top row and the room row as
depth. The treasure is the deepest leaf room, so cutting it back to one approach never
strands anything; a seal ring of the biome's resource surrounds the chest, so the Rod
ladder still gates the reward. The valley cave's tolls are all rope (no planks before the
Rod knows wood). The chasm/ledge tolls and the locked door in `ground.ts` are live again.

Water pools from the bottom row once the rain begins and fills on the cave's own clock —
full the day the mouth drowns (`dungeonFloodRows`). A three-row ankle-deep band rides the
waterline over depth 2. Survey, 12 seeds: entrances seal on day 6.4 / 23.6 / 37.7 (first /
median / last), so the valley cave is a prologue raid and the mountain cave fills over
weeks.

### 5.3 Husbandry — shipped

Built as the counter-proposal in round one: fiber twists a rope at Noah's tent (4, once);
the rope leads a string of up to six, following your breadcrumb trail; each animal slows
you, to 0.46× with six. Within two tiles of the ark site the string walks aboard. `E` ties
it anywhere (any high ground is a paddock), walking back into a tied animal re-leads it,
and the flood drowns tied animals and any led animal in water over its head. The string
ties itself when you go indoors, underground or afloat.

**Left alone deliberately:** the hermit still takes a sheep that is already aboard, not one
on the rope. The dove still scouts only wild animals. The HUD map doesn't show cave water.

**Tuning to playtest:** `RAIN_DAY` (5), `ROPE_COST` (4), `MAX_STRING` (6), the slowdown
per animal (0.09), and `DUNGEON_SHALLOW_ROWS` (3).

## Wave 6 — The endless sand *(shipped)*

Round-one note 5, built as the general primitive round one asked for: a map that does not
obey euclidean adjacency. A 3x3-panel map whose outer panels match the centre; every panel
crossing is folded back one panel so the slide always lands in the centre. Anything else
that should loop (a lost woods, a stair that never ends) can reuse `wrapDesert`'s trick.

- **Gate:** a four-row gap cut through the east or west rock wall in the bottom two panel
  rows, with sand around it. It floods with the lowlands, around day 10 in the seeds
  surveyed — an early secret.
- **Path:** a stranger in the carpenter's workshop gives an eight-step compass path that
  never includes the way back. A wrong step resets the count.
- **Prize:** an oasis with a heart container. Any way out of it is the way home.

Every world in the survey has a gate. If neither wall has plain ground behind it in the far
south, the egg is simply absent and the stranger says the sea has it.

**Left alone deliberately:** the dev tool doesn't show the sand; the stranger's path
isn't saved anywhere but the banner (write it down — that is the genre); and there's no
second destination for the primitive yet.

---

## Wave 7 — Signs of people

The world is supposed to be one people left behind, but there isn't a person in it. Wave 7
puts them back, along with the farms, trades and comforts that would explain why everything
is where it is. The rule for every addition: **it needs a reason to be there.** Domestic
animals live where people keep them; wild ones keep away from people; a tool lying on the
ground was dropped by someone who was using it there.

Decided with Michael, round three:

- The town drinking house is a **tavern**.
- **No townsfolk come aboard.** Genesis 7:23 holds. The people are there to be left behind.
- Animals sold by farmers, or found at homesteads, are **one of the run's two of that
  kind**, never a third. Same for every domestic kind, not just the ox.
- Some homesteads are **abandoned**, with animals still penned; some have a **fallen fence**
  and an animal that never strays more than a tile from home.
- **Wild animals avoid people and settlements.**

### 7.1 Homesteads, and animals that live somewhere — shipped

Farmsteads scattered through the valley, forest and scrub: a house, a fenced paddock, a well,
on buildable ground near water like the towns. The domestic kinds — sheep, goat, donkey,
camel, ox, dove — are placed where people keep them: a paddock at a homestead, the town
pasture, a dovecote, a caravan yard in the city. Each animal remembers its home and wanders
only inside it.

Every homestead is one of three things:

- **Lived in.** The farmer is in the yard. His animal is his: walking into it with a rope
  gets *"That's the farmer's ox."* He'll sell it for ark materials, priced by kind.
- **Abandoned.** The house is a ruin, the fence still stands, the animal still waits inside.
  Free to take.
- **Fallen fence.** Gaps in the fence; the animal stays within a tile of home anyway.

Wild kinds (lion, bear, serpent, raven) spawn well away from any settlement or homestead and
steer away from people when they wander.

### 7.2 People — shipped

Townsfolk walk the towns and homesteads. Stand next to one and press `E` for a line. Lines
follow the flood: in the prologue they mock the man building a boat on dry land, once the
rain starts they get uneasy, and late on they ask to come aboard. They can't.

As the water nears their home they move uphill to the next settlement that's still dry,
when you're not looking, so the southern towns empty and the northern ones fill. A run
ends with some of them gone. Only people on the current panel are simulated, so the frame
budget is safe.

### 7.3 Fuller towns, and the trades between them

Towns get more houses, a well, market stalls and a signpost. The city gets a merchant's villa
with a walled garden. Between towns, small sites that explain the landscape:

- a **woodcutter's clearing** in the forest — stumps, chips, and an axe left in a stump
- a **charcoal burner's** mounds at the forest edge
- a **quarry** of cut blocks in the hills, with a worn pickaxe
- a **potter's kiln** by valley water, where the clay is
- a **vineyard and winepress** on a warm slope

All placed from the seed on the worldgen plan, so connectivity and solvability checks keep
holding.

### 7.4 The tavern

One per town. Rumours, one new one per visit, pointing at real things in this world: the
axe in the woodcut, what the hermit wants, the stranger at the carpenter's, which farmer is
selling. And rest: buy back a heart for fiber.

### 7.5 Found tools

The woodcutter's axe and the quarry pickaxe are free, but they wear out like the shop
tools, so a find is a head start, not a broken economy.

### 7.6 An ending with names (stretch)

The end card names who you saved and who you left: *the potter's family at Kiln Hill; the
oxen still in the Hollow Farm paddock.* Sites get names in 7.1 and 7.3 so this is mostly a
text template.

**Order:** 7.1 and 7.2 first, with the farmer's trade, as one PR — that's the change that
makes the world feel inhabited. 7.3–7.6 as a second.

---

## Order, and why

```
Wave 0  frame budget                        ← shipped
Wave 1  landforms, settlements, roads       ← shipped
        round-two fixes                     ← shipped
Wave 2  the depth ladder, the skiff as an   ← shipped
        object, barter, tools
Wave 3  interiors, the people in them,      ← shipped
        the item set
Wave 4  contour ledges                      ← shipped
Wave 5  the prologue, dungeon flood,        ← shipped
        animal husbandry
Wave 6  the endless sand                    ← shipped
Wave 7  signs of people                     ← next
```

## Things I'd deliberately not do yet

- **Currency.** Section 2.3.
- **Enemies.** Still deferred.
- **Multi-floor dungeons.** Room row as depth is cheaper.
- **A full dialogue system.** Roads carry the clues.
