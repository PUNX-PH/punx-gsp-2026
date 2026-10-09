// The files an engine game's run holds: one GLB per entity whose model is not a primitive, next to settings.json as entity-NAME.glb. The Unity
// player loads them by entity name and draws a primitive for any entity without one.
import { PRIMITIVES, type GameSpec } from "./spec";

export const entityFile = (name: string): string => `entity-${name}.glb`;

/** The phone's variant of a GLB in a run: entity-NAME.glb has entity-NAME.mobile.glb beside it when its model was built with one. */
export const mobileFile = (file: string): string => file.replace(/\.glb$/, ".mobile.glb");

/** The file a phone variant is for, or null when the name is not one. */
export const pcFileOf = (file: string): string | null => (file.endsWith(".mobile.glb") ? file.replace(/\.mobile\.glb$/, ".glb") : null);

export const usesFile = (model: string): boolean => !(PRIMITIVES as readonly string[]).includes(model);

/** The distinct file names a game's run must have besides settings.json, in the order of the entities. */
export function entityFilesNeeded(spec: GameSpec): string[] {
  return Object.entries(spec.entities)
    .filter(([, e]) => usesFile(e.model) && !e.behaviors.some((b) => b.type === "spawn"))
    .map(([name]) => entityFile(name));
}
