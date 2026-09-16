# The Flood — the roadmap

A plan written against two pages of brainstorm notes: `docs/notes/ideas-01.md`, written
before anything below was built, and `docs/notes/ideas-02.md`, written after the first
complete run — start to finish, ark built, won.

It is a reading of those notes as much as a schedule: what they are all secretly asking
for, which ones argue with each other, and what order to build them in so the expensive
ones land on foundations that already exist.

Nothing here is precious. Where I disagree with a note I say so and say why, and the note
wins if you still want it.

**Status:** Wave 0 (the frame budget) and Wave 1 (the world people left behind) have
shipped, along with the round-two fixes in *What the first full run changed* below. What
remains is Waves 2 through 5.

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

## Wave 0 — The frame budget *(shipped)*

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

## Wave 1 — The world people left behind *(shipped)*

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


## What the first full run changed

Round two of the notes came out of an actual win, and it is a different kind of document
from round one: less "what should this game be" and more "here is what the world does wrong
when you walk through it for two hours". Most of it has shipped. What follows is what the
notes asked for, what I did, and the three places playing turned up something nobody had
written down.

### Shipped

| Note | What it said | What happened |
|---|---|---|
| 4 | Ark on its own authored panel, one screen north of spawn | Spawn is chosen first now; the ark panel is the one screen in the world that is hand-laid, not generated. Walled platform, centre-bottom, one stair up from the south, hull growing out of it. The road to the ark is gone. |
| 6 | Serpent Rod is free on day one | A **seal of pitch** across that dungeon's vault. Not bought — *parted*, and only by a Rod that has been imbued with pitch at the scrub shrine. It gates the best tool in the game behind the whole ladder without charging pitch, which a dungeon must never eat. |
| 7 | The road is a straight line | It was, and provably: uniform cost over flat ground makes a shortest-path search return a ruler. Roads now pay to climb and pay to cross rough country, so they follow contours and bend around terrain. Longest straight run across test seeds went from 107 tiles to 62, and there is a test pinning it under a third of the map. |
| 8 | The gorge should be dry, impassable, already crossed | It is a landform now, not a river: a `Gorge` tile you cannot climb into, cut with its fords already in place so the channel never divides the world. |
| 9 | The elevation lines aren't working | They were a 3px translucent smear on the *upper* tile, which read as a seam rather than a drop. Replaced with a real six-pixel cliff face drawn onto the tile below — lit lip, rock face, contact shadow. |
| 11 | No blockers in front of stairs | Swept, after the connectivity repair rather than before, because that pass cuts stairs of its own. Seam-aware, so clearing one side of a panel boundary cannot leave an invisible wall on the other. |
| 14 (half) | Float over drowned obstacles | Depth 2 or more and you sail over a boulder instead of round it. The *other* half is deliberately held — see below. |
| 16 | The river should be wet by day 10 | The gorge carries its own runoff from the first day of rain, independent of sea level, deepening a step every ten days. It is rain off the mountain, not the sea arriving, and it is now the first thing on the map that tells you the weather has turned. |
| 17 | Normal water is too deep to wade | Natural water is depth 2 whatever the sea is doing. It looks exactly as it did. |

Note 5's "off the road" half shipped too — mountain dwellings get a south-facing doorstep
and a track out of it. The enterable half is Wave 3.

### One thing I did not ship, on purpose

**Note 14's depth cap on the skiff.** The note asks for two things: the skiff cannot enter
the deepest water, *and* it can be upgraded at higher docks to handle more. Those have to
ship together. By day 20 most drowned ground is already depth 4; a cap without the upgrade
ladder would make the skiff useless for the back half of the run, which is the half it
exists for. The depth model it needs is in place — the ladder is the top of Wave 2.

### Three things playing turned up that nobody wrote down

**1. The first gate in the game was drowning before you could pay for it.** Note 12 says
*"lower shrine keeps getting swallowed before I get there — fine in principle"*. It is not
fine in principle. The Rod harvests fiber and nothing else until the valley shrine says
otherwise, so that shrine is the gate on *every other resource in the game* — and the valley
is, by design, the first ground to go under. Measured across thirty worlds, it drowned on a
median of **day 6.3**, and as early as day 2.1. A run that loses it can never build the ark,
and nothing on screen says so.

Worse, I made it sharper last round by tripling shrine costs at your request: the first gate
became the most expensive thing in the game relative to the time you have to afford it.

Fixed three ways: shrines now stand on the **high ground near their town** (which is what
people do with temples, and buys days for nothing), the generator **validates the ladder**
and re-rolls a world whose required shrines drown too early to afford, and the supply check
now measures against the hull *and* the ladder rather than the hull alone. Median valley
shrine life went 6.3 → 8.7 days, worst case 2.1 → 4.4, and the ladder check rejects about
a third of raw worlds before they reach you.

If it still bites, the dial is the valley shrine's price — 18 fiber is a lot to find on the
ground you have least time on. I have left it where you asked for it.

**2. The map is half a day wide.** At four tiles a second and 180 real seconds to the
in-game day, walking the entire 440-tile height of the world takes about 0.6 days. So the
time-expanded solvability check — which asks "could the player walk here before it drowns" —
was nearly vacuous: everything is reachable almost immediately. What actually costs a run is
*round trips* and *gathering*, neither of which the check models. That is why the shrine
guard above is written against affordability rather than travel time, and it is worth
knowing before anyone tunes `secondsPerDay` or the map size.

**3. Panel seams and deliberate tiles disagree.** The seam system mirrors scenery across
panel boundaries so a tree on the far side is never an invisible wall, but it refuses to
pave over a road or a bridge. When a gorge runs alongside a road across a seam, one side
ends up passable and the other does not. Pre-existing, rare, cosmetic — you see the road
stop at the screen edge. Noted rather than fixed, because the fix is either paving roads or
re-validating the seam pass across every seed, and neither is a thing to do in passing.

---

## Wave 2 — Depth, and the things that beat it

The strongest idea in round two is one you wrote across four separate notes without naming
it. Notes 1 (galoshes), 14 (skiff tiers, the sounding line), 15 (the skiff as an object) and
17 (water is depth 2) are all the same system:

> **Water has depth, and everything you own is an answer to a particular depth.**

The depth model now exists in code — every tile answers 0 to 4 — and it is doing nothing
yet but stopping you wading. Turn it into a ladder and it becomes the second spine of the
game, running exactly parallel to the Rod's:

| Depth | What it is | What crosses it |
|---|---|---|
| 0 | Dry | your feet |
| 1 | Ankle-deep; the gorge on the first day of rain | **galoshes**, at reduced speed |
| 2 | Over your head; any pond, the gorge by day 12 | **the skiff** |
| 3 | The channel late, the drowned lowlands | **a pitched skiff**, recaulked at a dock |
| 4 | The deep | nothing. That is what the ark is for. |

Two ladders, one for harvesting and one for moving, each gated by places you have to find.
That is a real structure, and it is what note 14 was reaching for.

### 2.1 The skiff becomes an object (note 15)

This is the note that makes the ladder work, and it is my favourite thing in round two.

A skiff you carry in your pocket is a flag on the player. A skiff that **sits where you left
it** is a place on the map. You haul it overland at half speed, you beach it somewhere and
walk on, and if the deep closes around it while you are away, it is gone and you build
another. That is a real loss, arriving through your own decisions, in a game that is about
losing things.

It also resolves the collision you spotted: galoshes and a pocket boat solve the same
problem, so the boat has to cost something to move. And it makes "upgrade it at a higher
dock" a journey — you portage your boat uphill — rather than a menu.

### 2.2 The sounding line, and seeing underwater (note 14)

With the line aboard, the tiles around the skiff read clearly to the bottom: you can see the
drowned nodes you are dredging instead of guessing. That is the right shape — an instrument
that changes what you can *perceive* rather than what you can reach, which is the one
category of item the game does not have yet.

### 2.3 Barter, not money (notes 7, 20 — round one)

Unchanged from round one, and round two's note 18 wanting "a quick and dirty shop in town"
is the same thing: **don't add currency.** It is right for the setting, it skips an entire
UI, and it keeps every purchase competing with the ark — which is the best tension the game
has. Prices move as the world drowns: wood gets dearer every day the forest is underwater.

Note 18 asks that it be obvious which building is the shop. Agreed, and it should be a
distinct tile, not a door among doors.

### 2.4 Tools that break (notes 12, 13, 18, 20)

Your durability model in note 13 is better than what I had written and I am taking it as
given:

> a normally-harvestable target costs one point, a target that was never harvestable costs
> two or three, and both yield their one unit

That single rule does three jobs. It makes the axe a *tool* first and a *key* second. It
means using it on a gopher tree is cheap and using it to punch through a wall of scenery is
expensive, so the interesting choice is which. And it gives note 12 its answer: if the
valley shrine is about to go under and you are four fiber short, an axe is the thing that
buys you the last few — an in-game recovery to sit alongside the worldgen guarantee above,
rather than instead of it.

### 2.5 Heart containers, earned (note 19 — round one)

Off the ground entirely: dungeon chests, a shop at a painful price, and a hermit who wants
something specific. Trading an animal you walked across the map for a heart you will need on
day 38 is still the best single decision in this document.

---

## Wave 3 — Doors, and the people behind them

### 3.1 Interiors (notes 5, 18)

Note 5 asks for the mountain dwelling to be enterable from the south with dungeon-door
mechanics, and note 18 wants shops, a hermit and items in them. Those are one feature: **a
one-room interior primitive**, which the dungeon warp already almost is.

A door is a tile you step into from the south; inside is a single room with a person in it
and something to trade. Build it once and it carries the hermit, the shop, the carpenter and
Noah's own tent — which has been standing at spawn since Wave 1 with nothing inside it.

This is where the item set finally lands: axe, pickaxe, chart, galoshes, sounding line,
spread across dungeon chests, the hermit and the shops, so that two of the four dungeons
stop paying out interchangeable heart containers.

### 3.2 The instruments (note 17 — round one)

Still the design rule, and round two's items slot into it cleanly:

> **No item exists unless it also works at sea.**

| Item | On land | At sea |
|---|---|---|
| **The Chart** | Colours the HUD map; `M` opens the fullscreen world map | Reveals the ocean |
| **The Lodestone** | Points to the ark | Points to Ararat |
| **The Sounding Line** | See and dredge to the bottom around the skiff | Finds the mountaintop under the water |
| **The Dove** | Released, flies to the nearest dry land | Genesis 8:8, exactly as written |
| **Galoshes** | Wade depth 1, slowly | Keep the deck |

---

## Wave 4 — The world as a contour map (note 10)

The biggest remaining change to how the world reads, and the riskiest, which is why it has a
wave to itself.

Note 10 has two halves. The complaint — *"it's weird that there are impassable ledges with
stairs but then you can just walk around them"* — is exactly right, and it is a consequence
of how escarpments are cut today: a cliff is marked wherever elevation happens to drop far
enough to the south, which produces broken fragments rather than lines. A fragment you can
walk around is scenery pretending to be a gate.

The proposal — *ledges at round-numbered elevations, so the whole world gets an
elevation-map vibe* — is the fix, and it is better than what is there:

- cut a cliff along **every contour** where elevation crosses a fixed band (every 24 units,
  say, giving about ten bands over the map)
- place a countable number of stairs per contour **segment**, not per fragment
- make the connectivity repair route *through stairs* rather than carving through contours,
  which is the part that needs care — today it will happily cut a hole in a cliff, which
  would dissolve the whole system on the first pass

The payoff is large: the world reads as a topographic map, north genuinely means up, every
climb is a decision about where the stair is, and the flood becomes legible because you can
*see* which contour the water is on. It also retires the last of note 9 — you would no
longer need a drawn cliff face to infer height, because height would be drawn.

The risk is equally large. Contour cliffs are a global constraint on movement, and the
connectivity and solvability passes were written against a world where you can mostly walk
anywhere. This wants its own session, the survey script open the whole time, and a
willingness to back it out.

---

## Wave 5 — The rain begins

Unchanged from round one in substance: a dry prologue with the water pinned at zero, then
*"THE RAIN BEGINS"*, a cooling palette, water trickling down every ledge, and a steeper ramp
to the same day 40. Forty days stays load-bearing; only the curve changes.

Round two adds one thing: **the gorge already does this**, and shipping it early was
accidental good luck. It runs from the first day of rain, so the channel filling from the
north is already the signal that the weather has turned. The prologue just has to hold it
at zero for longer and then let it go.

The dungeon flood (note 13, round one) and animals-as-logistics (note 16, round one) stay
in this wave and stay as written: room row as depth, and animals led in strings rather than
one at a time.

---

## Wave 6 — The endless sand (note 5, round one)

The desert Easter egg, built as a general primitive: a small map that is not the overworld,
not a dungeon, and does not obey euclidean adjacency. Independent of everything; whenever.

---

## Two I would answer differently than asked

### Resource regrowth (round two, note 2)

You said *"not convinced but it's an idea"*, and I would go further: as written it fights
the premise. The whole game is that this is going away and will not come back. A flax patch
that regrows makes the flood a soft constraint and removes the reason to get somewhere
*before* it drowns, which is the only reason the clock is interesting.

The thing it is reaching for — a mercy when you are three wood short and the forest is gone
— is the shop (2.3), and the shop is better because it costs you something. A trade is a
decision; a respawn timer is a wait.

There is a version I would take, if late-game scarcity turns out too harsh in playtesting:
**regrowth above the waterline only**, of the local biome, far slower than you consume it.
That reads as life persisting until it doesn't, and it cannot save you from having lost a
biome. Keep it as a dial, not a feature.

### The sabbath (round two, note 3)

The gag is free and worth shipping: on days 7, 14, 21, 28 and 35, the voice says something.
That is a good use of the dialogue system whenever it lands.

The punishment is the wrong mechanic — it takes agency away during the most time-pressured
game imaginable, which is where agency matters most. But there is a third option better than
either: **a sabbath that pays**. Spend the seventh day at the ark and something happens —
the flock settles, a heart comes back, the voice is pleased. Now resting is a real decision
with a real price, one of your forty days, and the player chooses whether the run can afford
it. That is a mechanic. A penalty is just a rule.

---

## Order, and why

```
Wave 0  frame budget                        ← shipped
Wave 1  landforms, settlements, roads       ← shipped
        round-two fixes                     ← shipped (see above)
Wave 2  the depth ladder, the skiff as an   ← the depth model is already in place
        object, barter, tools
Wave 3  interiors, the people in them,      ← needs the shops Wave 2 prices
        the item set
Wave 4  contour ledges                      ← risky; own session, survey open
Wave 5  the prologue, dungeon flood,
        animal husbandry
Wave 6  the desert                          ← independent; whenever
```

Wave 2 is the one to do next: the depth model is built and inert, and turning it into the
traversal ladder is the single change that would most alter how a run plays.

## Things I'd deliberately not do yet

- **Currency.** Section 2.3.
- **Enemies.** Still deferred. The world is only now becoming worth walking through, and
  combat would compete with the flood for the job of pressuring the player.
- **Multi-floor dungeons.** Room row as depth gets the mechanic for a fraction of the cost.
- **A full dialogue system.** Roads carry the clues. One line per NPC until there is
  something dialogue alone can say — the sabbath gag is the first thing that qualifies.
- **The skiff depth cap without the upgrade ladder.** Half a mechanic is worse than none.

## One thing not on your list

A run still ends on `Flock 12/20`. Now that there are towns in the world, that number is the
wrong ending. An end card that names **what you saved and what you left** — the logging
town, the family on the mountain, the pair of oxen still tied to a post in a drowned pasture
— would land the weight of the premise harder than any mechanic in this document, and it is
mostly a text template over state the game already tracks.
