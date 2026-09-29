/**
 * The camera and fog of war: snapping, easing, render interpolation, and
 * marking panels explored as the player walks.
 */

import { PANEL_PX_H, PANEL_PX_W, TILE_PX } from '../core/config.js';
import { panelsHigh, panelsWide } from '../core/tilemap.js';
import type { Point } from '../core/world.js';
import { activeMap } from './queries.js';
import { type GameState, PLAYER_H, PLAYER_W } from './types.js';

/** Record the panel the camera is on as visited. Cheap and idempotent. */
export function markExplored(state: GameState): void {
  const map = activeMap(state);
  const w = panelsWide(map);
  const h = panelsHigh(map);
  const x = state.camera.panelX;
  const y = state.camera.panelY;
  if (x < 0 || y < 0 || x >= w || y >= h) return;

  const i = y * w + x;
  if (state.location.kind === 'dungeon') {
    const grid = state.exploredDungeons[state.location.dungeonId];
    if (grid && i < grid.length) grid[i] = 1;
    return;
  }
  if (state.location.kind === 'interior') {
    const grid = state.exploredInteriors[state.location.interiorId];
    if (grid && i < grid.length) grid[i] = 1;
    return;
  }
  if (i < state.exploredOverworld.length) state.exploredOverworld[i] = 1;
}

/** Collapse interpolation onto the current state after a teleport. */
export function syncInterpolation(state: GameState): void {
  state.player.prevX = state.player.x;
  state.player.prevY = state.player.y;
  state.camera.prevScroll = state.camera.scroll;
}

/** Move the player onto a tile and snap the camera to its panel. */
export function placeOn(state: GameState, tile: Point): void {
  state.player.x = tile.x * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = tile.y * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  snapCamera(state);
  syncInterpolation(state);
}

/** Put the camera on the player's panel with no transition. */
export function snapCamera(state: GameState): void {
  const panelX = Math.floor((state.player.x + PLAYER_W / 2) / PANEL_PX_W);
  const panelY = Math.floor((state.player.y + PLAYER_H / 2) / PANEL_PX_H);
  state.camera.panelX = panelX;
  state.camera.panelY = panelY;
  state.camera.fromX = panelX;
  state.camera.fromY = panelY;
  state.camera.scroll = 0;
  markExplored(state);
}

export function updateCamera(state: GameState): void {
  const p = state.player;
  const panelX = Math.floor((p.x + PLAYER_W / 2) / PANEL_PX_W);
  const panelY = Math.floor((p.y + PLAYER_H / 2) / PANEL_PX_H);

  if (panelX !== state.camera.panelX || panelY !== state.camera.panelY) {
    state.camera.fromX = state.camera.panelX;
    state.camera.fromY = state.camera.panelY;
    state.camera.panelX = panelX;
    state.camera.panelY = panelY;
    state.camera.scroll = 1;
  }
  markExplored(state);
}
