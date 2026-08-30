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
30 stone, 10 pitch.

**End:** the ark completes and floats, or your hearts run out.

**Heart containers** are scattered across all four biomes; each permanently adds one.

---

## Deferred

### Dungeons
One per biome, placed at generation time (the slots already exist in worldgen and render
as `D` pins in the inspector; the doors report "sealed"). Dangerous — platforms, enemies,
or both — and each holds an upgrade.

The interesting tension is that dungeon-running consumables come from the *same* materials
as the ark: rope for descents, planks for bridges. Every rope you tie is hull you didn't
build. That trade is the reason dungeons should exist at all, so it should be legible in
the UI from the first version of them.

### Towns and money
One per biome, with shekels as currency. Shops that sell what you'd otherwise spend days
gathering. `TownDoor` already has a tile ID and a sprite reserved.

### The voice of God
Over the top, brusque, King of All Cosmos. Speaks at the start of a run, on milestones
(first pitch, half an ark, the first heart container), and at both endings. Currently a
single opening line and two end cards; wants a proper dialogue system with a message queue
and a portrait.

### The ocean stage
After the ark launches: exploration or survival on open water — did you store enough to
outlast the flood? Deliberately out of scope until the land game is good.

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
