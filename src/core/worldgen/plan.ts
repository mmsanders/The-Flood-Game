/**
 * The intent plane.
 *
 * Later worldgen passes overwrite earlier ones by writing tile IDs into a
 * parallel buffer. Paint, scatter and resources then fill only the cells
 * still marked unplanned, which is what makes a road stay a road and a
 * pasture stay a pasture instead of growing a random tree.
 */

export const UNPLANNED = 0xff;

export function freshPlan(n: number): Uint8Array {
  return new Uint8Array(n).fill(UNPLANNED);
}

export function isPlanned(plan: Uint8Array, i: number): boolean {
  return plan[i] !== UNPLANNED;
}

/** Write `tile` unless a previous pass already claimed the cell. */
export function stamp(plan: Uint8Array, i: number, tile: number): boolean {
  if (i < 0 || i >= plan.length) return false;
  if (plan[i] !== UNPLANNED) return false;
  plan[i] = tile;
  return true;
}

/** Later passes overwrite earlier ones. */
export function overwrite(plan: Uint8Array, i: number, tile: number): boolean {
  if (i < 0 || i >= plan.length) return false;
  plan[i] = tile;
  return true;
}

/** Paint the planned tiles onto the real map. Unplanned cells are left alone. */
export function applyPlan(tiles: Uint8Array, plan: Uint8Array): void {
  for (let i = 0; i < tiles.length; i++) {
    if (plan[i] !== UNPLANNED) tiles[i] = plan[i];
  }
}
