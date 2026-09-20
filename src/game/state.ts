/** Assembled by scripts/assemble-wave3.mjs — do not edit stub. */
export const enum Dir { Down = 0, Up = 1, Left = 2, Right = 3 }
export type Phase = "playing" | "won" | "drowned";
export const PLAYER_W = 10;
export const PLAYER_H = 11;
export interface Player { x: number; y: number; prevX: number; prevY: number; dir: Dir; hearts: number; maxHearts: number; swing: number; cooldown: number; invuln: number; drownTimer: number; moving: boolean; animTime: number }
export interface Camera { panelX: number; panelY: number; scroll: number; prevScroll: number; fromX: number; fromY: number }
export interface Location { kind: "overworld" | "dungeon" | "interior"; dungeonId: number; interiorId: number; returnTo: { x: number; y: number } | null }
export interface GameState { [key: string]: unknown }
export interface StepInput { moveX: number; moveY: number; attackPressed: boolean; interactPressed?: boolean }
export interface ObstaclePrompt { label: string; [key: string]: unknown }
export function createGame(_w: unknown): GameState { throw new Error("assemble-wave3"); }
export function adoptHotState(s: GameState): GameState { return s; }
export function step(_s: GameState, _i: StepInput, _dt: number): void {}
export function activeMap(_s: GameState): unknown { return null; }
export function currentDungeon(_s: GameState): unknown { return null; }
export function currentInterior(_s: GameState): unknown { return null; }
export function waterLevel(_s: GameState): number { return 0; }
export function currentDay(_s: GameState): number { return 0; }
export function depthAt(_s: GameState, _x: number, _y: number): number { return 0; }
export function gorgeRunoff(_s: GameState, _y: number): number { return 0; }
export function isBoatableTile(_s: GameState, _x: number, _y: number): boolean { return false; }
export function facingTile(_s: GameState): { map: unknown; tx: number; ty: number } { return { map: null, tx: 0, ty: 0 }; }
export function obstacleInFront(_s: GameState): ObstaclePrompt | null { return null; }
export function actionPrompt(_s: GameState): ObstaclePrompt | null { return null; }
export function syncInterpolation(_s: GameState): void {}
export function snapCamera(_s: GameState): void {}
export function damage(_s: GameState, _n: number): void {}
export function arkProgress(_s: GameState): number { return 0; }
export function flockScore(_s: GameState): unknown { return null; }
export function say(_s: GameState, _t: string): void {}
export function markExplored(_s: GameState): void {}
export function lodestoneBearing(_s: GameState): Dir | null { return null; }
export const LODESTONE_DIR_NAME: Record<Dir, string> = { [Dir.Down]: "south", [Dir.Up]: "north", [Dir.Left]: "west", [Dir.Right]: "east" };
export function releaseDove(_s: GameState): void {}
