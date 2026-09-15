# The Flood — the next wave

A plan written against a page of brainstorm notes (`docs/notes/ideas-01.md`). It is a
reading of those notes as much as a schedule: what they are all secretly asking for, which
ones argue with each other, and what order to build them in so the expensive ones land on
foundations that already exist.

Nothing here is precious. Where I disagree with a note I say so and say why, and the note
wins if you still want it.

---

## What the notes are actually asking for

Twenty notes, and almost all of them are one request wearing different hats:

> **The world should read as a place people lived in, not a noise field.**

Note 3 says it outright — *the world is flooded because of PEOPLE, so where is everyone?*
But note 4 (a gorge, plateaus, bridges, dungeon mouths cut into rock), note 18 (a logging
town, a tent city, a cathedral, a cairn), note 15 (Noah's camp), note 14 (the ark as a
monument you climb to), notes 7/8/20 (shops, carpenters, an axe that breaks), note 11
(clues), note 19 (heart containers you earn from a hermit rather than find in a field) and
note 9 (make north feel like *up*) are all the same request. Each one is asking for a world
with **intent** in it.

There is a second thread, smaller but load-bearing: **the clock is eating the game.** Note
12 says the roguelike urgency is fighting the thing you liked about Zelda 1. Note 13 wants
the flood inside dungeons. Note 16 wants animals to be a logistics problem. These are all
about the *shape of the pressure*, not its amount.

And a third: **legibility.** Note 6 (the rod is too long), note 9 (verticality), note 17
(a map, because the world is big), note 11 again (clues). Things the player cannot read
yet.

So: three threads, plus your note 0, which is its own thing and comes first.

### Why the map feels random (a diagnosis, since it's diagnosable)

Note 2 and note 3 describe the symptom. The cause is in the pipeline order, in
`src/core/worldgen/index.ts`:

```
elevation → biomes → paint → connectivity repair → POIs → validation
```

`paint` decides every tile by thresholding a noise field, independently, with no knowledge
of anything. Then `placePois` drops the ark, four dungeons, four shrines, six hearts and a
slipway onto *randomly chosen walkable tiles* that happen to be far enough apart. Nothing
in the generator has ever formed an intention about a location. That is precisely what
"random" feels like, and no amount of retuning `scatterDensity` will fix it, because the
problem isn't the noise — it's that nothing is allowed to override the noise.

The fix is to invert the order and let later passes *overwrite* earlier ones:

```
elevation → landforms → settlements → roads → siting (shrines, dungeons, slipways,
the ark) → paint → scatter → resources → connectivity repair → validation
```

Once settlements exist before paint, "the shrine is south-east of town on a footpath" and
"the sheep are in a pasture on a farm" stop being features you have to special-case. They
are just what the pipeline produces. This inversion is the single biggest structural change
in the plan, and Wave 1 is mostly it.

---

## Wave 0 — The frame budget

> *"The game should never lag or stutter EVER for ANY REASON."*

This comes first, and not only because you asked. Every wave below adds per-frame work —
towns to draw, NPCs to step, an economy to tick, a fullscreen map to rasterise. If the
frame budget isn't instrumented and defended *before* that lands, you will be bisecting
stutter across four waves of new features with no baseline to bisect against.

**One honest caveat about the number.** You can't pin a browser game to 144 Hz. A canvas
game presents on the compositor's vsync, and `requestAnimationFrame` fires at whatever the
display does — 60, 120, 144, or 60 when the laptop drops to battery saver. What you *can*
guarantee, and what actually produces the feeling you're describing, is:

- the **simulation** runs at a fixed rate that never varies (60 Hz), so the game's physics
  and the flood are identical on every machine;
- the **render** runs once per vsync at whatever the display offers, and **interpolates**
  between simulation states, so 144 Hz genuinely looks smoother than 60 instead of just
  drawing the same frame twice;
- **no frame ever misses its deadline**, which is the thing "stutter" actually means.

"Locked 144" is the wrong target. "Never misses a vsync" is the right one, it is stricter
in the ways that matter, and unlike a frame-rate number it can be tested in CI.

### Why it stutters today

These are real, and measured against the code as it stands:

**1. The HUD map is rebuilt from scratch every frame.** `rasterizeMiniMap` is the largest
single item in the renderer. For every visited panel it calls `landmarkOnPanel`, which calls
`panelHasTile`, which **scans all 176 tiles of that panel** looking for a town door. Then
`drawMiniMap` loops the same cells and calls `landmarkOnPanel` *again* for the overlay. Late
in a well-explored run that is 480 panels × 176 tiles × 2 = **~169,000 tile reads per
frame**, for a 40×48 pixel widget that mostly hasn't changed. And then, per HUD pixel,
`sampleMinimapRgb` calls `hexToRgb(tileColor(tile))` — a string slice and a `parseInt`,
~1,900 times a frame, to recompute constants.

Measured with the whole overworld explored, this is about a third of the time a frame
spends rendering — real, but on its own not enough to drop a frame on a fast machine.
Which is exactly why it presents as *"stutters sometimes"* rather than *"is slow"*: the
headroom absorbs it until something else lands in the same frame.

Fix: build a per-panel POI index once when the world is created; replace the hex-string
lookup with a 256-entry RGB byte table; cache the rasterised `ImageData` and rebuild it only
when an input actually changed (a newly explored panel, the water crossing a visible
threshold, the active map changing, the player moving to a new panel).

**2. Garbage collection.** This is the classic cause of "stutters for no reason": the frame
that gets unlucky is the frame the collector runs. The game currently allocates, *per frame
or per simulation step*: an array of up to 480 cell objects (`visitedCells`), a growing
`floods` array in `drawWorld`, five arrays per `canOccupy` call (called twice per step), an
array plus a `Set` plus objects in `hitboxTiles` (every step), a `Tod` object per `todAt`
call, a rect object per minimap cell per frame ×2, and a fresh `Intents` object with seven
closures every frame. None of it is expensive on its own. All of it together is a steady
drip into the nursery, and the collector eventually presents the bill as a dropped frame.

Fix: module-level scratch buffers and flat typed arrays. Unglamorous; it is most of the
work, and it is the half that actually removes the intermittent long frame.

**3. The substep bomb.** `src/game/main.ts` runs `while (accumulator >= STEP && steps <
240)`. Hold shift (8× fast-forward) and a single frame runs eight simulation steps; load
with `?speed=60` and it runs sixty. Miss one frame for any reason and the accumulator
catches up by running *everything it owes* inside the next frame — and that hitch feeds the
next accumulator, which is the spiral of death the 240 cap exists to stop.

To be straight about this one: a step is cheap enough today that I could not make it bite.
At `?speed=120` the old loop runs 120 steps a frame and still lands in 16.8 ms. It is a
latent hazard rather than a bug you can currently feel — but it is the hazard that a
simulation growing four waves of towns, NPCs and an economy walks straight into, and the
240-step ceiling is not a defence, because a cap on *count* doesn't bound *time*. The fix is
a cap on wall-clock time spent stepping, with the clock allowed to slip when the budget is
blown: a simulation that quietly runs slow is a bug you can live with, and a 400 ms frame
is not.

**4. Small change costs that add up.** `ctx.font` is assigned about a dozen times a frame,
`measureText` runs per frame on strings that change a few times a minute, and a
`ctx.save()/clip()/restore()` pair wraps the playfield every frame.

### What Wave 0 ships

- `src/game/perf.ts` — a ring buffer of frame times, and a **perf overlay on F3**: fps,
  frame-time p50/p99, the worst frame in the last few seconds, simulation substeps, and a
  count of frames that missed the vsync deadline. Because "it never stutters" has to be
  something you can *look at*, or it is a vibe.
- The minimap fixes, the allocation sweep, and the budgeted loop above.
- **Render interpolation**: player, animals and the panel-scroll camera drawn at
  `previous + (current − previous) × alpha`. Teleports (a pit, a dungeon door) snap the
  interpolation so nothing smears across the map.
- A Playwright spec that runs a real session for several seconds and **fails the build** if
  any frame exceeded the budget. This is the only mechanism that keeps note 0 true after
  Wave 3 lands.

Measured before and after on the same machine, with the whole overworld explored:

| | before | after |
|---|---|---|
| `render()` cost, mean | 0.94 ms | 0.60 ms |
| `render()` cost, p99 | 1.4 ms | 1.1 ms |
| heap growth per frame | +200 to +1200 B | none measurable |

The allocation row is the one that matters. A few hundred bytes a frame is ~20 KB a second
of pure garbage, and the collection that eventually reclaims it is the frame that hitches —
which is what a 50 ms frame observed once in three baseline runs, and not at all after,
looks like.

Two one-line fixes ride along, because they're one line:

- **Note 6** — the serpent rod's head should sit *in* the second tile, not past it.
- **Note 10** — shrine costs (currently 6 / 8 / 5 / 3 against an ark recipe of 40 / 60 /
  30 / 10) are close to free. Roughly tripled, so imbuing the Rod is a decision.

---

## Wave 1 — The world people left behind

The pipeline inversion, and the content it makes possible. This is the biggest wave and the
one that changes how the game feels most.

### 1.1 Landforms (note 4)

A pass between elevation and everything else, carving features that span many panels:

- **The river.** A single watercourse from the north edge to the south, following the
  descent, with a few tributaries. It floods early and deeply — which turns it from an
  obstacle into the game's **highway**: once you have the skiff, the river is how you cross
  the map fast. That is exactly your instinct in note 4, and it gives the skiff a reason to
  exist before day 20.
- **Escarpments.** Where elevation crosses a biome band, a cliff line with a *countable*
  number of stairways through it. Going north stops being a walk and becomes finding the
  stair. This is the mechanical half of note 9.
- **Plateaus and bridges** in the high country, so the mountains read as a different kind of
  space rather than scrub with snow on it.
- **Dungeon mouths sited into terrain**: a hole in an escarpment face, or the centre of a
  deep grove. Right now a dungeon entrance is a sprite dropped on grass. Note 4 is right
  that it should look like it belongs to the rock.

### 1.2 Verticality, the art half (note 9)

Two cheap tricks, both possible because the tilesheet is drawn in code:

- Cliff tiles get a lit top face and a dark front face, so a step reads as a step.
- Any tile whose southern neighbour is a full elevation band lower gets a 2–3 px drop
  shadow on its south edge.

Plus your own idea, which I want to hold until Wave 3 because it's a pacing beat as much as
an art one: **water trickling down the ledges once the rain starts.**

### 1.3 Settlements (notes 3, 18)

A settlement pass, after landforms and before paint. Per your note 18:

| Biome | Settlement | Size | Shrine sits in |
|---|---|---|---|
| Valley | Tent city (the camp in the wilderness) | ~2 panels + sprawl | a tent of meeting |
| Forest | Logging town | ~2 panels + sprawl | a grove |
| Scrub | City, stone roads | ~4 panels | a cathedral |
| Mountain | No town — scattered isolated dwellings | — | a cairn |

Settlements are placed on buildable ground near water and near their biome's resource,
which is where people actually settle, and that alone makes their locations feel reasoned.

Three consequences fall out for free, and they are the good part:

- **The sheep are in somebody's pasture** (note 3). A farm outside town is a fenced
  paddock, and animals spawn in it. Suddenly they're livestock, not wildlife.
- **The slipway is a carpenter's yard in town** (note 8), plus a dock on any sufficiently
  large body of water. Worldgen gets a "guarantee at least one large water body per biome"
  constraint so this is reliable rather than lucky.
- **Shrines are placed relative to town**, on a footpath, at a real bearing — which makes
  the NPC line in note 3 (*"we worship south-east of town"*) a true statement the generator
  can produce rather than flavour text.

### 1.4 Roads, and the best clue system you already have (note 11)

Note 11 asks for more clues so exploration feels like detective work. My strongest single
suggestion in this document:

> **Make the roads the clues, and make dialogue the backup.**

Zelda 1's best navigational information was never dialogue. It was the shape of the land.
If every road in this world actually goes somewhere, then "follow the road" is a clue that
needs no text box, no dialogue system, and no localisation — and a player who learns that
**stone roads mean a city, dirt roads mean a farm, and a footpath means a shrine** is
reading your world the way you want it read.

So: generate the settlement graph, then a road network joining settlements to each other
and to shrines, slipways, dungeon mouths and the ark. Roads are also the cheapest possible
answer to note 9, because a road that switchbacks up an escarpment says "this is a climb"
better than any tile art.

And then the flood does something lovely for free: as the valleys drown, the roads that are
still above water form a visible network pointing north. The catastrophe becomes the
signpost.

NPC dialogue still happens — it's just the second-best clue, reserved for things terrain
can't say (*"the hermit wants a lamb"*, the desert's eight-step code).

### 1.5 The ark as a monument (note 14) and Noah's camp (note 15)

The ark becomes a raised platform you climb stairs onto, dominating its panel, and its
**appearance is a pure function of what you've delivered** — keel, ribs, hull, deck, roof,
pitch. Since every sprite is drawn in code, this is cheap, and it gives the ark meter a
diegetic twin: you can see how far along you are from the next panel over. By 100% it
should take up most of the screen, as you describe.

Noah's tent goes at spawn, not enterable yet. It costs almost nothing and it means the run
starts *somewhere* instead of at a coordinate.

---

## Wave 2 — Reasons to go there

Wave 1 builds the places. Wave 2 makes them worth the walk.

### 2.1 Barter, not money (notes 7, 20)

Note 20 worries: *"We don't have currency though so we'll have to find a way to trade."* I'd
argue **don't add currency**, and treat that as a feature rather than a gap:

- It's right for the setting. This is a pre-coin world; weighed silver, at the earliest.
- It skips an entire UI and an entire balance problem.
- Most importantly, it keeps every transaction competing with the ark. That is already the
  best tension in the game — it's exactly why dungeon obstacles cost gopher wood — and
  shekels would launder it away. A shop that takes stone is a shop that makes you choose.

Your supply-and-demand instinct in note 7 is the correct pricing model, and I'd push it one
step further:

> **Prices move as the world drowns.** Wood gets dearer every day the forest is underwater.

One multiplier over the submerged fraction of the source biome. It costs almost nothing to
implement, it rewards planning ahead, and it makes the economy feel like it is *reacting to
the catastrophe* rather than sitting outside it. It also directly solves the run you lost:
being three wood short late is survivable, but it costs you dearly, which is the right
shape for a mercy mechanic.

### 2.2 Tools that break (note 20)

Axe and pickaxe, bought in town, 5–10 uses, then gone. They clear otherwise-permanent trees
and rock, and the axe yields gopher wood while it works. These are the answer to "I can see
where I want to go and the panel maze won't let me," and the limited charges mean using one
is a decision rather than a habit.

### 2.3 The instruments (note 17)

Your note 17 has the best framing device in the whole page: *"it would be cool if these
things also had a function on the actual Ark."* I want to promote that from a nice-to-have
to a **design rule**:

> **No item exists unless it also works at sea.**

That gives you a set that already knows what the ocean stage is for:

| Item | On land | At sea (later) |
|---|---|---|
| **The Chart** | Colours the HUD map; `M` opens a fullscreen world map of explored panels | Reveals the ocean |
| **The Lodestone** | Points to the ark | Points to Ararat |
| **The Sounding Line** | Dredges nodes below the Rod's depth from the skiff | Finds the mountaintop under the water |
| **The Dove** | Released, it flies to the nearest dry land or unvisited panel | Genesis 8:8, exactly as written |

The Chart is note 17 as you wrote it: before you have it, explored panels are grey, and the
fullscreen map says *"A map would help."* After it, full colour, everything you've seen,
minus collectables — remembering *where things were* is the point.

The Dove is my addition and my favourite. It is a real mechanic (a pointer to the nearest
dry land, which gets more valuable exactly as the world drowns), it is the single most
famous image in the story, and it makes the flock and the item set rhyme.

Items are dungeon rewards, as you suggest — which also fixes the current problem that two of
the four dungeons pay out an interchangeable heart container.

### 2.4 Heart containers, earned (note 19)

Agreed and easy: off the ground entirely. Dungeon chests, a shop that sells one at a
painful price, and a hermit who wants something specific — resources, or **a particular
animal**. Trading a creature you walked across the map for a heart you'll need to survive
day 38 is the best decision in this document and it costs nothing to build once Wave 1
exists.

---

## Wave 3 — The rain begins

The pacing rework. Held until last because it should be tuned against a world that is
actually worth exploring — doing it before Wave 1 would just give you more time in a world
made of noise.

### 3.1 The prologue, and why it doesn't break the balance (note 12)

Note 12 is the most important note on the page and you talked yourself out of it at the end
(*"but then it might get too easy to get all the resources"*). I think the worry is
unfounded, and the reason is a mechanic you already shipped.

**The Rod gates the resources, not the clock.** The Rod starts able to harvest fiber and
nothing else. Wood, stone and pitch need shrine upgrades, and shrines need finding. So a dry
prologue is spent *learning the map and unlocking capability* — you physically cannot
stockpile wood on day 2, no matter how much time you're given. The exploration window and
the scarcity are already independent. You just have to make the shrine climb expensive
enough to fill the window, which is note 10, which is in Wave 0.

Second: **don't add days.** Forty is load-bearing — one row per day, Genesis 7:12 — and a
seven-day prologue also makes the run 20% longer, which is a real cost for a two-hour game.
Instead, change the *curve*. Water is already a scalar function of time
(`waterLevelAtDay`), so this is a few lines:

```
days 0–5    water pinned at 0        the world is sunny; the clock is yours
day 5       "THE RAIN BEGINS."       palette cools, sky greys, water starts
                                     trickling down every ledge (your idea, 1.2)
days 5–40   a steeper ramp to 256    the same ending, arriving with more urgency
```

Same run length, same forty days, a real exploration window, and a *tenser* back half than
you have now. Five days is a guess and should be playtested — it's one constant.

The transition wants to be a moment: the light changes, the palette cools, and God says
something. That's the first real use of the voice from `DESIGN.md`.

### 3.2 The flood enters the dungeons (note 13)

The best mechanical idea in the notes, and I'd build it exactly as written. It converts a
dungeon from "a side trip with a toll" into "a race with a visible deadline," which is
strictly more interesting, and it kills the slightly silly current situation where the
safest place during a global flood is underground.

Implementation note so it stays cheap: dungeons are 4×4 rooms on a single plane today.
Rather than building multi-floor dungeons, **treat the room row index as depth** — the
bottom row is the deepest. Water rises from the highest row index upward, on a slower clock
than the surface. Rooms seal from the bottom, the treasure is deep, and surfacing into water
already works because it isn't special-cased. No new structure, the whole mechanic, today's
generator.

### 3.3 Animals as logistics (note 16)

Right instinct, with one risk worth flagging: walking twenty animals to the ark one at a
time is twenty round trips across a large map. That's tedium, not difficulty, and it will
eat the exploration time Wave 3 just bought you.

Counter-proposal, same idea, better shape:

- Fiber buys a rope; a rope leads a **string** of animals, not one.
- Each additional animal on the string slows you further. Lead two and you're quick; lead
  six and you're crawling toward a rising waterline.
- **Paddocks** — at the ark, and at the farms from Wave 1 — hold a string safely. Drop
  animals off, go back for more.
- Tethered animals still drown if you leave them low. That's the tension, and it makes a
  paddock's elevation something you think about.

So the decision is *how many do I lead at once*, which is a real trade, and it's four trips
rather than twenty.

---

## Wave 4 — The endless sand (note 5)

Your desert Easter egg, which I want to build as a **general primitive** rather than a
special case, because it is one:

> a small map that is not the overworld, not a dungeon, and does not obey euclidean
> adjacency.

Walk into the sand at the far south-east or south-west, get a note — *"Endless sand
stretches in every direction..."* — and every direction but back loops to the same tile.
An NPC somewhere holds a randomised eight-step N/S/E/W code that walks you to something
worth finding. Which is a direct descendant of `EASTMOST PENINSULA IS THE SECRET`, and
exactly the right register for this game.

Build the primitive once and any future weirdness is nearly free. Do it whenever; it depends
on nothing.

---

## Order, and why

```
Wave 0  frame budget                      ← first: everything below adds frame cost
Wave 1  landforms, settlements, roads     ← the pipeline inversion; the biggest change
Wave 2  barter, tools, instruments        ← needs towns to exist
Wave 3  the prologue, dungeon flood,      ← tune pacing against a world worth exploring
        animal husbandry
Wave 4  the desert                        ← independent; whenever
```

Waves 1 and 2 are each several sessions. Waves 0, 3 and 4 are each roughly one.

## Things I'd deliberately not do yet

- **Currency.** Section 2.1.
- **Enemies.** Still deferred. This wave is about making the world worth walking through;
  adding something that interrupts the walking is a different project, and combat would
  compete with the flood for the role of "the thing pressuring you."
- **Multi-floor dungeons.** Row-as-depth (3.2) gets the mechanic for a fraction of the cost.
  Revisit if it isn't enough.
- **A full dialogue system.** Roads carry the clues (1.4). NPCs can get by on a single line
  each until there's something dialogue alone can say.

## One thing not on your list

A run currently ends on `Flock 12/20`. Once Wave 1 puts people in the world, that number is
the wrong ending. An end card that names **what you saved and what you left** — the logging
town, the family on the mountain, the pair of oxen still tied to a post in a drowned
pasture — would land the weight of the premise harder than any mechanic in this document,
and it is mostly a text template over state you already track. It also, finally, gives the
flock a narrative reason to exist beyond being a high score.
