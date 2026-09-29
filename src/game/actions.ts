/**
 * The E key: what the HUD offers here, and what pressing E does.
 *
 * Each system offers its E actions as providers, written beside its own
 * rules. A provider returns null when it has nothing to do with where the
 * player stands, or an Action carrying the prompt and the effect together.
 *
 * The first provider to answer owns the HUD prompt. Pressing E runs the same
 * providers in the same order until one acts, so the prompt and the key can
 * only part ways where an Action says so: a hint with no `run`, or a `run`
 * that declines and passes E on.
 */

import { obstacleAction } from './ground.js';
import { doveAction } from './instruments.js';
import { entranceAction, interiorAction } from './places.js';
import { dredgeHint, shrineAction } from './rod.js';
import { boatYardAction, launchAction, setDownAction, skiffPickupAction } from './skiff.js';
import { townAction } from './trade.js';
import type { Action, GameState, ObstaclePrompt } from './types.js';

/** In order of precedence: the first that answers wins the prompt. */
const PROVIDERS: readonly ((state: GameState) => Action | null)[] = [
  interiorAction,
  shrineAction,
  entranceAction,
  boatYardAction,
  townAction,
  skiffPickupAction,
  launchAction,
  setDownAction,
  dredgeHint,
  obstacleAction,
  doveAction,
];

/** Context action rendered by the HUD. */
export function actionPrompt(state: GameState): ObstaclePrompt | null {
  if (state.phase !== 'playing') return null;
  for (const provide of PROVIDERS) {
    const action = provide(state);
    if (action) return action.prompt;
  }
  return null;
}

export function handleInteract(state: GameState): void {
  for (const provide of PROVIDERS) {
    if (provide(state)?.run?.(state)) return;
  }
}
