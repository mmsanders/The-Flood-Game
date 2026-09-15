# The Flood — design notes

The full shape of the game, including the parts not built yet. Anything marked
**deferred** is designed for but not implemented; the point of writing it down is that the
foundations don't have to be torn up to add it later.

---

## The pitch

A roguelike with permadeath, on a Zelda 1-style overworld of single-screen panels. The
world is procedurally generated every run. Shortly after you start, the water begins to
rise from the south. You have forty days to gather material, climb north, and finish an
ark before the world is gone.

Any and all biblical reference is welcome — Torah and Old Testament especially. God is a
recurring character in the register of the King of All Cosmos: over the top, brusque,
lavish in praise and withering in disappointment.

---

## The map

**Dimensions.** 12 × 40 panels = 480 panels, each 16 × 11 tiles at 16px — exactly a
Zelda 1 screen (256 × 176 px). For scale, Zelda 1's whole overworld was 16 × 8 = 128
screens, so this is roughly 3× that.

Forty rows is load-bearing: one row drowns per day, forty days, Genesis 7:12. The width
started at 10 and went to 12 because 10 was a corridor — too narrow to route around
obstacles or hide anything.

**Data footprint.** A panel is a list of 8-bit numbers and nothing more:

| Form | Size |
|---|---|
| Panel, tile plane | 176 B |
| Panel, tile + elevation planes | 352 B |
| Whole map, explicit | 169 KB |
| Whole map, as a seed | 16 B |

**Elevation.** fBm value noise plus a strong north-south gradient, normalised to fill the
full 0–255 byte range. This one field drives biome selection, tile painting, and the flood.

The generator no longer paints first and drops points of interest on whatever grass is left.
It forms an intention and then fills in around it:

```
elevation → landforms → settlements → siting → roads → paint → connectivity → validation
```

A north-south river (the skiff's highway once the valleys drown), escarpments with a
countable number of stairs, a tent city / logging town / stone city / mountain hamlets,
and roads that actually go somewhere are all written into a plan buffer before paint runs.
Paint, scatter and resources fill only the cells nothing else claimed.

**Biomes**, as elevation bands, low to high:

| Biome | Share | Resource | Character |
|---|---|---|---|
| Valley / farm | ~24% | Fiber → rope | crops, ponds, open ground; drowns first |
| Forest / foothills | ~30% | Gopher wood | dense trees, the bulk of the hull |
| Scrub / rocky | ~26% | Stone | gravel, boulders, sparse cover |
| High mountain | ~21% | Pitch | snow and cliffs, resource-poor by design |

Because elevation already trends north-south, biomes band by latitude with a natural
wiggle — the blended transitions come free rather than needing a separate pass.

**Pitch** is the answer to "what's in the high mountains?" Genesis 6:14 is explicit:
*cover it with pitch inside and out*. Textually exact, and mechanically ideal — you need
very little, you cannot finish without it, and it sits at the top of the map, pulling the
player upward at the same time the water pushes them there.

---

## The flood

Water is a single rising scalar, not a row-by-row schedule:

```
submerged  ⟺  elev < waterLevel(day)
waterLevel: 0 through day 2, then linear to 256 at day 40
```

Rows still drown at about one per day because elevation trends north-south. But the
model gives more than a schedule would: a hilltop in a drowned row becomes a shrinking
island, a low valley in a dry row floods early, and water rises continuously through the
day so parts of a panel go under at different times. None of that is special-cased.

Two days of grace at the start — the calm before, and room for the opening scene.

Submerged ground blocks movement *into* it, but a player the water has risen under can
keep wading (at 55% speed), taking a heart every two seconds. Otherwise a rising tide
would freeze you in place instead of chasing you uphill.

---

## The run

**Start:** 3 hearts, the Rod of Aaron, in the southern lowlands. Spawn is drawn from the
middle of the southern elevation range, not the lowest ground — starting at the bottom
drowns you in four days no matter how well you play.

**Gather:** the Rod is weapon and tool at once. Swinging at a resource node harvests it.
Nodes are clustered into patches rather than sprinkled evenly, so a location is worth
remembering and worth returning to before it goes under.

**Build:** carry material to the ark site (high, northern, central — among the last ground
to drown) and it is deposited automatically. The recipe is 40 fiber, 60 gopher wood,
30 stone, 10 pitch. The hull itself is a monument on a raised platform: keel, ribs, hull,
deck, roof, then pitch, grown from whatever you have delivered, big enough to read from
the next panel over.

**End:** the ark completes and floats, or your hearts run out. The flock is a high
score on the same run, never a second win condition.

**Heart containers** are scattered across all four biomes; each permanently adds one.

**The flock.** Ten biblical kinds, two of each, spawn in the biome that reads as their
home and wander until they drown or come aboard:

| Kind | Home |
|---|---|
| sheep, oxen, doves | valley |
| donkeys, bears | forest |
| lions, serpents, camels | scrub |
| goats, ravens | mountain |

Walking into a wild creature boards it. Completing a pair is a moment, not a victory.
Best flock (pairs first, then bodies) is stored per-browser.

**The skiff.** Not the ark. A valley slipway (a wooden dock, preferably on a pond bank)
frames a small boat from 8 gopher wood and 6 fiber. Once crafted, any shore will do:
walk into water or flood to shove off, walk onto dry ground to beach. Sailing occupies
floodwater without drowning. The Rod, swung from the deck, dredges a submerged node.
A fishing-rod blessing is a later Rod of Aaron upgrade, not this system.

---

## Dungeons

One per biome, 4x4 rooms where **each room is exactly one panel**, so a dungeon shares the
overworld's byte format, renderer and inspector view with no new drawing code.

**Structure is guaranteed, not hoped for**, mirroring the overworld connectivity pass:

- a randomised spanning tree from the entrance means every room is reachable
- loop edges are added *before* distances are measured, so a shortcut cannot bypass the
  edges obstacles were placed to gate
- the treasure room is the furthest from the entrance, then cut back to a single approach
  so the locked door is a real gate
- the key is placed strictly before the door it opens — asserted across many seeds

**The trade is the point.** Obstacles are paid for out of the same stock the ark needs:

| Obstacle | Costs | Becomes |
|---|---|---|
| Chasm | 2 gopher wood | Plank bridge |
| Ledge | 2 fiber | Rope |
| Locked door | a key found inside | Open door |

Pitch is never spendable — it is the scarce thing gating the ark, and letting a dungeon eat
it could strand a run underground. A whole dungeon costs about 6 units against a recipe
wanting 60 wood and 40 fiber: a real bite, not a run-ender.

The price and your balance are on screen at the moment of the decision
(*"Bridge the chasm — 2 gopher wood (you have 14)"*). A cost discovered only after paying
it is a surprise, not a trade.

**Danger** is the resource toll, the clock (the flood keeps rising while you are
underground), and pits, which cost a heart and spit you back onto the last safe ground.
Pits sit well inside rooms so they can always be walked around — a pit that sealed a
corridor would be an obstacle, and obstacles are things you pay to cross.

**Rewards**, fixed per biome so every run offers the whole set:

| Dungeon | Reward |
|---|---|
| Valley | Heart container |
| Forest | **The Budding Rod** — harvest 2 per swing (Numbers 17) |
| Scrub | Heart container |
| Mountain | **The Serpent Rod** — +1 tile reach (Exodus 7:12) |

The Budding Rod is the loop closing: ark material spent on a tool that gathers ark material
twice as fast. It sits in the forest so it lands mid-run, while doubling still pays.

**The flood reaches the entrance, not the interior.** Once the mouth submerges that dungeon
is gone for the run, which makes a low-lying one a decision about *when*, not whether — the
first typically seals around day 7, when you have barely gathered enough to pay its toll.
Interiors never flood. Surfacing into water is not special-cased: the ordinary flood rules
take over.

---

## The frame budget

A hard rule, ahead of every feature below: **no frame ever misses a vsync.**

The simulation is fixed at 60Hz and never varies with the display, so the flood, collision
and animal movement play out identically on every machine. The render runs once per vsync at
whatever rate the display offers and interpolates between the last two simulation states,
which is what makes a high-refresh screen smoother rather than just repetitive. Catch-up
stepping is bounded by wall-clock time, so a fast-forward or a slow frame slips the in-game
clock rather than producing a long one. The loop allocates nothing per frame; the HUD map
caches its raster and rebuilds only when an input to it changed.

"Locked 144" is not the target and is not achievable in a browser — rAF fires at the
display's rate, whatever that is. "Never misses its deadline" is stricter where it counts and
can be tested, which `tests/e2e/frametime.spec.ts` does on every build. `F3` shows the same
numbers live.

The rule is load-bearing for the plan in `ROADMAP.md`: every wave of it adds per-frame work,
and the budget is easier to defend than to recover.

## Deferred

### Enemies
Nothing currently threatens the player but water and pits. Two or three types with distinct
movement (walker, chaser, shooter), which also gives the Rod something to do besides
harvest. Biblical flavour: locusts, serpents, foxes; Nephilim as dungeon bosses.

### Towns and shops
Settlements exist as scenery: a tent city in the valley, a logging town in the forest, a
stone city in the scrub, isolated dwellings on the mountain. Shrines sit on a bearing from
town; sheep spawn in a fenced pasture; the slipway is a carpenter's yard. Shops, barter, and
entering a building are Wave 2 — see `docs/ROADMAP.md`.

### The voice of God
Over the top, brusque, King of All Cosmos. Speaks at the start of a run, on milestones
(first pitch, half an ark, the first heart container), and at both endings. Currently a
single opening line and two end cards; wants a proper dialogue system with a message queue
and a portrait.

### The ocean stage
After the ark launches: exploration or survival on open water — did you store enough to
outlast the flood? Deliberately out of scope until the land game is good. The skiff is
the land-game boat, not this.

### Presentation
Sprite variety beyond one repeating tile per type; animation; sound. The current look is
deliberately flat and repetitive — Zelda 1, Pokémon Red — and the tilesheet is drawn in
code so there is nothing to re-export when it changes.

### Touch controls
The game is keyboard-only; the inspector is the phone-facing half. Input is already
abstracted into intents, so an on-screen d-pad feeds the same path without touching game
logic.

---

## Explicitly rejected

- **Hunger.** Asked for and refused. It taxes attention without adding a decision.
- **A day/night cycle you have to sleep through.** The clock matters because the water
  is rising, not because the game wants you indoors.
- **Better graphics.** 16-bit flat colour is the target, not a placeholder. Cheap to
  render, cheap to change, and correct for the feel.
