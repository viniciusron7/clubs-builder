/*
 * Loads the browser's game-rule runtime inside Deno.
 *
 * Keeping these imports pointed at the production files is intentional: the
 * Edge Function and the GitHub Pages UI must normalize builds with the exact
 * same DATA/Calc implementation instead of maintaining a second ruleset.
 */

export type GameBuild = {
  archetypeId: string | null;
  level: number;
  height: number;
  weight: number;
  attributes: Record<string, number>;
  playstyles: string[];
  playstylePurchases: Record<
    string,
    { before: Record<string, number>; after: Record<string, number> }
  >;
  signatures: Record<string, string>;
  positions: string[];
  disabledAttrs: string[];
  sumExcluded: string[];
};

type GameArchetype = {
  id: string;
  position: string;
  minHeight: number;
  maxHeight: number;
  minWeight: number;
  maxWeight: number;
};

type GameAttribute = {
  id: string;
  baseValue: number;
  maxValue: number;
};

type GameData = {
  archetypes: GameArchetype[];
  categories: Array<{ attributes: Array<{ id: string }> }>;
  playstyles: Array<{ id: string }>;
  specializations: Array<{ id: string; archetypeId: string }>;
};

type GameCalc = {
  archetype(id: string): GameArchetype | null;
  baseCategories(
    archetype: GameArchetype,
  ): Array<{ attributes: GameAttribute[] }>;
  normalizeBuild(
    build: GameBuild,
  ): { build: GameBuild; adjusted: boolean };
};

type OverallModel = {
  positions: Record<string, unknown>;
};

type GameGlobal = typeof globalThis & {
  window?: GameGlobal;
  DATA?: GameData;
  Calc?: GameCalc;
  OVERALL_MODEL?: OverallModel;
};

const gameGlobal = globalThis as GameGlobal;
if (gameGlobal.window !== gameGlobal) {
  Object.defineProperty(gameGlobal, "window", {
    configurable: true,
    value: gameGlobal,
    writable: false,
  });
}

await import("../../../js/data.js");
await import("../../../js/weights.js");
await import("../../../js/calc.js");

if (
  !gameGlobal.DATA || !gameGlobal.Calc || !gameGlobal.OVERALL_MODEL ||
  typeof gameGlobal.Calc.normalizeBuild !== "function"
) {
  throw new Error("The shared game-rule runtime could not be loaded");
}

export const GAME_DATA = gameGlobal.DATA;
export const GAME_CALC = gameGlobal.Calc;
export const GAME_OVERALL_MODEL = gameGlobal.OVERALL_MODEL;
