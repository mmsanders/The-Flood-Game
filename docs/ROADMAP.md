# The Flood — the roadmap

A plan written against two pages of brainstorm notes: `docs/notes/ideas-01.md`, written
before anything below was built, and `docs/notes/ideas-02.md`, written after the first
complete run — start to finish, ark built, won.

It is a reading of those notes as much as a schedule: what they are all secretly asking
for, which ones argue with each other, and what order to build them in so the expensive
ones land on foundations that already exist.

Nothing here is precious. Where I disagree with a note I say so and say why, and the note
wins if you still want it.

**Status:** Waves 0–3 have shipped (frame budget; the world people left behind; the
depth ladder and the things that beat it; interiors and instruments), along with the
round-two fixes in *What the first full run changed* below. What remains is Waves 4
through 6.

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

## Wave 4 — Contour ledges

Risky global movement constraint; own session.

## Wave 5 — The rain begins

Prologue, dungeon flood, animal husbandry.

## Wave 6 — The endless sand

Desert Easter egg; independent.

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
Wave 4  contour ledges                      ← next; risky; own session
Wave 5  the prologue, dungeon flood,
        animal husbandry
Wave 6  the desert                          ← independent; whenever
```

## Things I'd deliberately not do yet

- **Currency.** Section 2.3.
- **Enemies.** Still deferred.
- **Multi-floor dungeons.** Room row as depth is cheaper.
- **A full dialogue system.** Roads carry the clues.
