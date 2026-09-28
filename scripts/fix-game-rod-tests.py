from pathlib import Path
p = Path('tests/game.test.ts')
s = p.read_text()
old_b = """  it('applies the Budding Rod to harvest yield', () => {
    const forest = state.world.dungeons.find((d) => d.biomeKind === Biome.Forest);
    expect(forest).toBeDefined();
    if (!forest) return;

    state.location = { kind: 'dungeon', interiorId: -1, dungeonId: forest.id, returnTo: { x: 1, y: 1 } };
    placeAt(state, forest.chest.x, forest.chest.y);
"""
new_b = """  it('applies the Budding Rod to harvest yield', () => {
    const mountain = state.world.dungeons.find((d) => d.biomeKind === Biome.Mountain);
    expect(mountain).toBeDefined();
    if (!mountain) return;

    state.location = { kind: 'dungeon', interiorId: -1, dungeonId: mountain.id, returnTo: { x: 1, y: 1 } };
    placeAt(state, mountain.chest.x, mountain.chest.y);
"""
old_s = """  it('applies the Serpent Rod to reach', () => {
    const mountain = state.world.dungeons.find((d) => d.biomeKind === Biome.Mountain);
    expect(mountain).toBeDefined();
    if (!mountain) return;

    state.location = { kind: 'dungeon', interiorId: -1, dungeonId: mountain.id, returnTo: { x: 1, y: 1 } };
    placeAt(state, mountain.chest.x, mountain.chest.y);
"""
new_s = """  it('applies the Serpent Rod to reach', () => {
    const scrub = state.world.dungeons.find((d) => d.biomeKind === Biome.Scrub);
    expect(scrub).toBeDefined();
    if (!scrub) return;

    state.location = { kind: 'dungeon', interiorId: -1, dungeonId: scrub.id, returnTo: { x: 1, y: 1 } };
    placeAt(state, scrub.chest.x, scrub.chest.y);
"""
if old_b not in s:
    if 'biomeKind === Biome.Mountain' in s and 'Budding Rod' in s:
        print('already patched')
    else:
        raise SystemExit('budding site missing')
else:
    s = s.replace(old_b, new_b, 1)
if old_s in s:
    s = s.replace(old_s, new_s, 1)
elif 'biomeKind === Biome.Scrub' not in s:
    raise SystemExit('serpent site missing')
p.write_text(s)
print('ok')
