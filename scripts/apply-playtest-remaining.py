#!/usr/bin/env python3
from pathlib import Path

render = Path('src/game/render.ts')
r = render.read_text()
old1 = """      if (tile === Tile.HeartContainer || tile === Tile.Pedestal) {
        blitTile(ctx, sheet, carveTo(map.biome[i] as Biome), sx, sy);
      }
      // A gorge with water in it is a river, and should look like one. Dry,
"""
new1 = """      if (tile === Tile.HeartContainer || tile === Tile.Pedestal) {
        blitTile(ctx, sheet, carveTo(map.biome[i] as Biome), sx, sy);
      }
      if (tile === Tile.Skiff) {
        const tracked = state.boatX === tx && state.boatY === ty;
        const under = tracked ? state.boatUnderTile : carveTo(map.biome[i] as Biome);
        blitTile(ctx, sheet, under === Tile.Skiff ? carveTo(map.biome[i] as Biome) : under, sx, sy);
      }
      // A gorge with water in it is a river, and should look like one. Dry,
"""
if 'boatUnderTile' not in r:
    if old1 not in r:
        raise SystemExit('render skiff site missing')
    r = r.replace(old1, new1, 1)
    r = r.replace(
        "const FACE_LIP = '#9a917f';\nconst FACE_ROCK = '#4a443b';\nconst FACE_FOOT = '#26221c';\n",
        "const FACE_LIP = '#2a2620';\nconst FACE_ROCK = '#141210';\nconst FACE_FOOT = '#0a0908';\n",
        1,
    )
    render.write_text(r)
    print('patched render')
else:
    print('render already patched')

state = Path('src/game/state.ts')
s = state.read_text()
if 'function sealResourceOf' not in s:
    old_seal = "/** Rod tier that parts a seal of pitch. */\nconst SEAL_TIER = Resource.Pitch;\n"
    new_seal = (
        'function sealResourceOf(tile: number): Resource | null {\n'
        '  switch (tile) {\n'
        '    case Tile.ReedSeal:\n'
        '      return Resource.Fiber;\n'
        '    case Tile.WoodSeal:\n'
        '      return Resource.Wood;\n'
        '    case Tile.StoneSeal:\n'
        '      return Resource.Stone;\n'
        '    case Tile.PitchSeal:\n'
        '      return Resource.Pitch;\n'
        '    default:\n'
        '      return null;\n'
        '  }\n'
        '}\n'
    )
    if old_seal not in s:
        raise SystemExit('state SEAL_TIER site missing')
    s = s.replace(old_seal, new_seal, 1)

    old_chest = (
        '    case RewardKind.SerpentRod:\n'
        '      state.rodReach = 2;\n'
        '      break;\n'
        '  }\n'
    )
    new_chest = (
        '    case RewardKind.SerpentRod:\n'
        '      state.rodReach = 2;\n'
        '      break;\n'
        '    case RewardKind.Chart:\n'
        '      state.hasChart = true;\n'
        '      break;\n'
        '    case RewardKind.Galoshes:\n'
        '      state.hasGaloshes = true;\n'
        '      break;\n'
        '  }\n'
    )
    if old_chest not in s:
        raise SystemExit('state chest site missing')
    s = s.replace(old_chest, new_chest, 1)

    dash = '\u2014'
    old_obs = (
        '  if (tile === Tile.PitchSeal) {\n'
        '    const ready = state.rodTier >= SEAL_TIER;\n'
        '    return {\n'
        '      tile,\n'
        '      label: ready\n'
        f"        ? 'Part the seal {dash} the Rod knows pitch'\n"
        "        : 'A seal of pitch. The Rod is not ready for this.',\n"
        '      affordable: ready,\n'
        '    };\n'
        '  }\n'
    )
    new_obs = (
        '  const needed = sealResourceOf(tile);\n'
        '  if (needed !== null) {\n'
        '    const ready = state.rodTier >= needed;\n'
        '    const name = RESOURCE_LABEL[needed];\n'
        '    return {\n'
        '      tile,\n'
        '      label: ready\n'
        f'        ? `Part the seal {dash} the Rod knows ${{name}}`\n'
        '        : `A seal of ${name}. The Rod is not ready for this.`,\n'
        '      affordable: ready,\n'
        '    };\n'
        '  }\n'
    )
    if old_obs not in s:
        idx = s.find('if (tile === Tile.PitchSeal)')
        print(repr(s[idx:idx+240]) if idx >= 0 else 'no pitchseal')
        raise SystemExit('state obstacle site missing')
    s = s.replace(old_obs, new_obs, 1)

    old_clear = (
        '  if (tile === Tile.PitchSeal) {\n'
        '    if (state.rodTier < SEAL_TIER) {\n'
        "      say(state, 'The seal holds. Imbue the Rod with pitch and return.');\n"
        '      return;\n'
        '    }\n'
        '    convertConnected(map, tx, ty, tile, Tile.DungeonFloor);\n'
        '    state.mapRevision++;\n'
        "    say(state, 'The Rod drinks the pitch. The seal parts.');\n"
        '    return;\n'
        '  }\n'
    )
    new_clear = (
        '  const needed = sealResourceOf(tile);\n'
        '  if (needed !== null) {\n'
        '    const name = RESOURCE_LABEL[needed];\n'
        '    if (state.rodTier < needed) {\n'
        '      say(state, `The seal holds. Imbue the Rod with ${name} and return.`);\n'
        '      return;\n'
        '    }\n'
        '    convertConnected(map, tx, ty, tile, Tile.DungeonFloor);\n'
        '    state.mapRevision++;\n'
        '    say(state, `The Rod drinks the ${name}. The seal parts.`);\n'
        '    return;\n'
        '  }\n'
    )
    if old_clear not in s:
        raise SystemExit('state tryClear site missing')
    s = s.replace(old_clear, new_clear, 1)
    if 'SEAL_TIER' in s:
        raise SystemExit('SEAL_TIER still present')
    state.write_text(s)
    print('patched state')
else:
    print('state already patched')
