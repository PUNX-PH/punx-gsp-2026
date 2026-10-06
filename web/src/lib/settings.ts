// Validation of a game's settings.json, written to agree with the Unity template: the checks, their order, the ranges
// and the message words are ported from SettingsParser.cs and Winnability.cs, and the shared files in
// fixtures/settings/ are accepted and rejected the same way by both. This validator may be stricter than Unity on a
// wrongly typed value, never looser. The 16 KB size limit is the caller's job.

export const DENSITIES = ["few", "some", "lots"] as const;
export type Density = (typeof DENSITIES)[number];

/** How the game is lit: `flat` is the plain shader every game had, `lit` the High one (sun, sky light, metal, glow, fog). */
export const LOOKS = ["flat", "lit"] as const;
export type Look = (typeof LOOKS)[number];

/** The styles of the High world (the same as the kit's WORLD_STYLES; a test keeps them equal). */
export const WORLD_STYLES = ["desert", "meadow"] as const;
export type WorldStyle = (typeof WORLD_STYLES)[number];

/** The three files a world is made of, next to settings.json, whatever its style. */
export const WORLD_FILES = ["terrain.glb", "road.glb", "backdrop.glb"] as const;

/**
 * Optional: settings from before it existed have none. The three indexes are into the palette; the scenery files are GLBs next to
 * settings.json. A High environment also has a `world`: the style of the land, the road and the far hills, whose three files are
 * WORLD_FILES.
 */
export interface Environment {
  sky: number;
  field: number;
  stripe: number;
  density: Density;
  scenery: string[];
  world?: { style: WorldStyle };
}

export interface GameSettings {
  schemaVersion: number;
  template: string;
  palette: string[];
  roles: { hero: string; obstacle: string; collectible: string };
  tuning: { speed: number; jumpHeight: number; obstacleSpacing: number };
  environment?: Environment;
  /** Optional: absent means flat. */
  look?: Look;
}

export type SettingsResult = { ok: true; settings: GameSettings; text: string } | { ok: false; error: string };

const SUPPORTED_VERSION = 1;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const GLB_FILE_NAME = /^[A-Za-z0-9_-]+\.[Gg][Ll][Bb]$/;
const ROLES = ["hero", "obstacle", "collectible"] as const;
const MAX_SCENERY = 3;

// From RunnerSim.cs and Winnability.cs. The Unity template reads each number from the settings file as a single-precision
// float and then does the winnability arithmetic in double precision, which is identical in the Editor and in the
// WebGL player (in float arithmetic those two disagreed at a few tunings sitting exactly on an edge). So here: round
// each input and each constant to single precision with Math.fround, and do the arithmetic as JavaScript's doubles.
// A web validator in plain double precision accepted tunings Unity refuses (speed 4, jumpHeight 2.35).
const fl = Math.fround;
const GRAVITY = 30;
const OBSTACLE_HEIGHT = 1;
const HIT_WIDTH = 2 * fl(0.8);
const MIN_TIMING_WINDOW = fl(0.2);

/** Validates settings text. A leading byte-order mark is removed, and the returned text is without it. */
export function validateSettings(input: string): SettingsResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return fail(`settings: not valid JSON (${e instanceof Error ? e.message : "unreadable"})`);
  }
  if (!isObject(parsed)) return fail("settings: not valid JSON (expected an object)");

  const error = validate(parsed);
  return error === null ? { ok: true, settings: parsed as unknown as GameSettings, text } : fail(error);
}

/** The distinct file names the roles point at, in the order hero, obstacle, collectible. */
export function rolesNeeded(s: GameSettings): string[] {
  return [...new Set(ROLES.map((role) => s.roles[role]))];
}

/** Every file a run must have besides settings.json: the role files, then the scenery files, then the world's three, each name once. */
export function filesNeeded(s: GameSettings): string[] {
  return [...new Set([...rolesNeeded(s), ...(s.environment?.scenery ?? []), ...(s.environment?.world ? WORLD_FILES : [])])];
}

function fail(error: string): SettingsResult {
  return { ok: false, error };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validate(s: Record<string, unknown>): string | null {
  const version = typeof s.schemaVersion === "number" ? s.schemaVersion : 0;
  if (version !== SUPPORTED_VERSION)
    return `settings.schemaVersion: ${version} is not supported (expected ${SUPPORTED_VERSION})`;
  const template = typeof s.template === "string" ? s.template : "";
  if (template !== "runner") return `settings.template: "${template}" is not supported (expected "runner")`;

  const paletteError = checkPalette(s.palette);
  if (paletteError) return paletteError;

  if (!isObject(s.roles)) return "settings.roles: missing";
  for (const role of ROLES) {
    const roleError = checkRole(role, s.roles[role]);
    if (roleError) return roleError;
  }

  if (!isObject(s.tuning)) return "settings.tuning: missing";
  const t = s.tuning;
  const tuningError =
    checkRange("speed", t.speed, 1, 20) ??
    checkRange("jumpHeight", t.jumpHeight, 1.5, 5) ??
    checkRange("obstacleSpacing", t.obstacleSpacing, 4, 40) ??
    winnabilityError(t.speed as number, t.jumpHeight as number, t.obstacleSpacing as number);
  if (tuningError) return tuningError;

  const lookError = Object.hasOwn(s, "look") ? checkLook(s.look) : null;
  if (lookError) return lookError;

  return Object.hasOwn(s, "environment") ? checkEnvironment(s.environment) : null;
}

function checkLook(value: unknown): string | null {
  if (typeof value === "string" && (LOOKS as readonly string[]).includes(value)) return null;
  return `settings.look: ${shown(value)} must be ${LOOKS.slice(0, -1).join(", ")} or ${LOOKS[LOOKS.length - 1]}`;
}

// A value in a message: as JSON, cut short, so a long or odd value cannot flood it.
function shown(value: unknown): string {
  return JSON.stringify(value)?.slice(0, 40) ?? "missing";
}

function checkEnvironment(e: unknown): string | null {
  if (!isObject(e)) return "settings.environment: must be an object";
  return (
    checkPaletteIndex("sky", e.sky) ??
    checkPaletteIndex("field", e.field) ??
    checkPaletteIndex("stripe", e.stripe) ??
    checkDensity(e.density) ??
    checkScenery(e.scenery) ??
    (Object.hasOwn(e, "world") ? checkWorld(e.world) : null)
  );
}

// The world is exactly { style }: nothing else is read from it, so nothing else is let in.
function checkWorld(world: unknown): string | null {
  if (!isObject(world)) return "settings.environment.world: must be an object with a style";
  for (const key of Object.keys(world)) if (key !== "style") return `settings.environment.world: unknown field ${shown(key)} (only style is allowed)`;
  const style = world.style;
  if (typeof style === "string" && (WORLD_STYLES as readonly string[]).includes(style)) return null;
  return `settings.environment.world.style: ${shown(style)} must be ${WORLD_STYLES.slice(0, -1).join(", ")} or ${WORLD_STYLES[WORLD_STYLES.length - 1]}`;
}

function checkPaletteIndex(name: string, value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4) return null;
  return `settings.environment.${name}: ${shown(value)} is not a palette index (0 to 4)`;
}

function checkDensity(value: unknown): string | null {
  if (typeof value === "string" && (DENSITIES as readonly string[]).includes(value)) return null;
  return `settings.environment.density: ${shown(value)} must be ${DENSITIES.slice(0, -1).join(", ")} or ${DENSITIES[DENSITIES.length - 1]}`;
}

function checkScenery(files: unknown): string | null {
  if (!Array.isArray(files)) return "settings.environment.scenery: must be a list of file names";
  if (files.length > MAX_SCENERY) return `settings.environment.scenery: at most ${MAX_SCENERY} files, found ${files.length}`;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (typeof file !== "string" || !GLB_FILE_NAME.test(file))
      return `settings.environment.scenery[${i}]: ${shown(file)} must be a plain file name like scenery1.glb (letters, digits, - and _ only)`;
  }
  return null;
}

function checkPalette(palette: unknown): string | null {
  const count = Array.isArray(palette) ? palette.length : 0;
  if (!Array.isArray(palette) || count !== 5) return `settings.palette: expected 5 colors like #rrggbb, found ${count}`;
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    if (typeof color !== "string" || !HEX_COLOR.test(color))
      return `settings.palette[${i}]: "${typeof color === "string" ? color : ""}" is not a #rrggbb color`;
  }
  return null;
}

function checkRole(role: string, file: unknown): string | null {
  if (typeof file !== "string" || file === "") return `settings.roles.${role}: missing`;
  if (!GLB_FILE_NAME.test(file))
    return `settings.roles.${role}: "${file}" must be a plain file name like ${role}.glb (letters, digits, - and _ only)`;
  return null;
}

function checkRange(name: string, value: unknown, min: number, max: number): string | null {
  if (typeof value !== "number") return `settings.tuning.${name}: must be a number`;
  if (fl(value) >= min && fl(value) <= max) return null; // Unity reads the number as a float
  return `settings.tuning.${name}: ${value} is outside ${min} to ${max}`;
}

/**
 * Each value is in range, but together they must make a game that can be won (see Winnability.cs). Null when the
 * tuning is playable, otherwise the settings error.
 */
export function winnabilityError(speedValue: number, jumpHeightValue: number, obstacleSpacingValue: number): string | null {
  const speed = fl(speedValue);
  const jumpHeight = fl(jumpHeightValue);
  const obstacleSpacing = fl(obstacleSpacingValue);

  // Seconds one jump spends above the top of an obstacle, against what the hit window and the margin need.
  const excess = Math.max(0, jumpHeight - OBSTACLE_HEIGHT);
  const above = 2 * Math.sqrt((2 * excess) / GRAVITY);
  const needed = HIT_WIDTH / speed + MIN_TIMING_WINDOW;
  if (above < needed) {
    const minHeight = OBSTACLE_HEIGHT + (GRAVITY * needed * needed) / 8;
    return (
      `settings.tuning.jumpHeight: ${f(jumpHeight)} m is too low to jump an obstacle at ${f(speed)} m/s ` +
      `with a ${f(MIN_TIMING_WINDOW * 1000)} ms timing margin; use at least ${f(roundUp(minHeight))} m or a higher speed`
    );
  }

  // One jump per obstacle: the hero must be back on the ground, with the margin to spare, before the next take-off.
  const minSpacing = requiredSpacing(speed, jumpHeight);
  if (obstacleSpacing < minSpacing) {
    return (
      `settings.tuning.obstacleSpacing: ${f(obstacleSpacing)} m is too short at ${f(speed)} m/s, the hero needs ` +
      `room to land and jump again; use at least ${f(roundUp(minSpacing))} m or a lower speed`
    );
  }
  return null;
}

// The hero must be back on the ground, with the timing margin to spare, before the next take-off: the time in the air at this
// jump height plus the margin, at this speed. (Both numbers are already floats, as Unity reads them.)
function requiredSpacing(speed: number, jumpHeight: number): number {
  const airTime = 2 * Math.sqrt((2 * jumpHeight) / GRAVITY);
  return speed * (airTime + MIN_TIMING_WINDOW);
}

/** The smallest obstacle spacing, to 0.1 m, that the rule above accepts for this speed and jump height. */
export function minPlayableSpacing(speedValue: number, jumpHeightValue: number): number {
  const required = requiredSpacing(fl(speedValue), fl(jumpHeightValue));
  let spacing = roundUp(required);
  // The check reads the spacing as a float, and a value that rounds to just under `required` once it is a float (4.1 m/s at a
  // 2.4 m jump) is refused: step up until it is not. (The message in winnabilityError keeps its own rounding, so that it says the same
  // thing as the Unity template; this is only for callers that must land on a value that passes.)
  while (fl(spacing) < required) spacing = Math.round((spacing + 0.1) * 10) / 10;
  return spacing;
}

// Rounded up to 0.1 so that the value in the message passes the check itself.
function roundUp(value: number): number {
  return Math.ceil(value * 10) / 10;
}

// Up to two decimals, no trailing zeros: the same as C#'s "0.##".
function f(value: number): string {
  return String(Number(value.toFixed(2)));
}
