# The Flood — the roadmap

A plan written against two pages of brainstorm notes: `docs/notes/ideas-01.md`, written
before anything below was built, and `docs/notes/ideas-02.md`, written after the first
complete run — start to finish, ark built, won.

It is a reading of those notes as much as a schedule: what they are all secretly asking
for, which ones argue with each other, and what order to build them in so the expensive
ones land on foundations that already exist.

Nothing here is precious. Where I disagree with a note I say so and say why, and the note
wins if you still want it.

**Status:** Waves 0–2 have shipped (frame budget; the world people left behind; the
depth ladder and the things that beat it), along with the round-two fixes in *What the
first full run changed* below. What remains is Waves 3 through 6.

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
prices rise as biomes drown. A dedicated `Shop` interior tile is deferred to Wave 3 with
interiors, so the economy does not have to move twice.

### 2.4 Tools that break (notes 12, 13, 18, 20) — shipped

Axe and pickaxe: harvestable target = 1 durability; never-harvestable scenery = 2–3; both
yield one unit. Tool-first recovery when a shrine is about to drown.

### 2.5 Heart containers, earned (note 19) — shipped

Off the ground: dungeon chests remain; loose overworld hearts are retired at run start;
shop heart at a painful barter price; mountain hermit trades a rescued sheep for a heart
(outdoor scaffold until Wave 3 interiors).

---

## Wave 3 — Doors, and the people behind them

### 3.1 Interiors

One-room interior primitive for hermit, shop, carpenter, Noah's tent. Move Wave 2 markets
behind doors; optional distinct shop tile.

### 3.2 The instruments

Chart, Lodestone, Dove. Sounding Line and Galoshes already land in Wave 2.

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
Wave 3  interiors, the people in them,      ← next
        the item set
Wave 4  contour ledges                      ← risky; own session
Wave 5  the prologue, dungeon flood,
        animal husbandry
Wave 6  the desert                          ← independent; whenever
```

## Things I'd deliberately not do yet

- **Currency.** Section 2.3.
- **Enemies.** Still deferred.
- **Multi-floor dungeons.** Room row as depth is cheaper.
- **A full dialogue system.** Roads carry the clues.
