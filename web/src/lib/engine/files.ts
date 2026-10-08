// The files an engine game's run holds: one GLB per entity whose model is not a primitive, next to settings.json as entity-NAME.glb. The Unity
// player loads them by entity name and draws a primitive for any entity without one.
import { PRIMITIVES, type GameSpec } from "./spec";

export const entityFile = (name: string): string => `entity-${name}.glb`;

export const usesFile = (model: string): boolean => !(PRIMITIVES as readonly string[]).includes(model);

/** The distinct file names a game's run must have besides settings.json, in the order of the entities. */
export function entityFilesNeeded(spec: GameSpec): string[] {
  return Object.entries(spec.entities)
    .filter(([, e]) => usesFile(e.model) && !e.behaviors.some((b) => b.type === "spawn"))
    .map(([name]) => entityFile(name));
}
