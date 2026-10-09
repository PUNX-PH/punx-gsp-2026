// The one table of the script API: what a generated game may call and define, and the limits the player enforces. The prompt Claude is given, the
// server's script check and the docs are all built from it, so they cannot disagree. docs/superpowers/specs/2026-10-08-lua-games-design.md is the
// description; Runtime/Script/Pure/ScriptHost.cs holds the same limits in C# (a test keeps the two equal).

export const SCRIPT_VERSION = 8;

export const SCRIPT_FILE = "game.lua";

export const SCRIPT_LIMITS = {
  scriptBytes: 65_536,
  instructionsPerFrame: 200_000,
  objects: 300,
  spawnsPerSecond: 120,
  timers: 50,
  uiElements: 24,
  uiTextLength: 2_000,
  stringLength: 10_000,
  slowFrameMs: 250,
  slowFramesInARow: 3,
  assets: 6,
} as const;

/** The functions a script may define; the player calls them. At least one of REQUIRED_ONE_OF must be defined. */
export const CALLBACKS = [
  { name: "init", signature: "init()", doc: "Called once before the first frame: set up the camera and spawn the first objects." },
  { name: "update", signature: "update(dt)", doc: "Called every frame with the seconds since the last frame." },
  { name: "on_tap", signature: "on_tap(x, y)", doc: "The player tapped (or clicked) at field position x, y." },
  { name: "on_hold", signature: "on_hold(x, y)", doc: "Called every frame while the finger is down." },
  { name: "on_release", signature: "on_release(x, y)", doc: "The finger was lifted." },
  { name: "on_drag", signature: "on_drag(x, y, dx, dy)", doc: "The finger moved while down, by dx, dy." },
  { name: "on_collide", signature: "on_collide(a, b)", doc: "Two solid objects began to overlap." },
  { name: "on_exit", signature: "on_exit(obj)", doc: "An object left the field." },
] as const;

export const REQUIRED_ONE_OF = ["init", "update", "on_tap", "on_drag"] as const;

export const CAMERA_MODES = ["side", "top", "chase", "fixed", "side2d", "top2d", "first"] as const;

export const PRIMITIVE_KINDS = ["box", "sphere", "capsule", "cylinder", "cone", "plane", "quad"] as const;

/** Names a script may not use as identifiers: the player does not have them, and some are how a sandbox is escaped. */
export const REMOVED_NAMES = ["os", "io", "debug", "require", "load", "loadstring", "loadfile", "dofile", "collectgarbage", "coroutine", "setmetatable", "getmetatable", "luanet", "clr", "UnityEngine", "System", "loadsafe"] as const;

export interface ApiEntry {
  /** The name as a script writes it. */
  name: string;
  signature: string;
  doc: string;
}

/** What the player provides. Units are game units, y up, z away from the screen; colors are palette slots 1 to 5 or "#rrggbb". */
export const SCRIPT_API: readonly ApiEntry[] = [
  { name: "game.win", signature: "game.win(message)", doc: "End the game as won, with an optional message." },
  { name: "game.lose", signature: "game.lose(message)", doc: "End the game as lost, with an optional message." },
  { name: "game.score", signature: "game.score", doc: "A number you read and write. Shown by the player's score line." },
  { name: "game.lives", signature: "game.lives", doc: "A number you read and write; starts at 3." },
  { name: "game.time", signature: "game.time", doc: "Seconds played so far (read only)." },
  { name: "game.width", signature: "game.width", doc: "The field's width in units (read only)." },
  { name: "game.height", signature: "game.height", doc: "The field's height in units (read only)." },
  { name: "game.over", signature: "game.over", doc: "True once the game has ended (read only)." },
  { name: "world.spawn", signature: "world.spawn(kind, props)", doc: "Make an object and return it. kind is an asset name or a primitive; props is a table: x y z w h d color vx vy vz gravity solid tag life spin." },
  { name: "world.find", signature: "world.find(tag)", doc: "A list of the live objects with this tag." },
  { name: "world.count", signature: "world.count(tag)", doc: "How many live objects have this tag (0 without a tag)." },
  { name: "world.clear", signature: "world.clear()", doc: "Remove every object." },
  { name: "world.gravity", signature: "world.gravity(g)", doc: "Set the downward pull (units per second squared, 20 by default) for objects with gravity = true." },
  { name: "world.bounds", signature: "world.bounds(w, h)", doc: "Set the field's width and height in units (9 by 16 by default)." },
  { name: "world.camera", signature: "world.camera{ mode, follow, x, y, z, zoom }", doc: "Choose the view and call it again with only the fields to change. side and fixed (3D) see the field head on: x right, y up, z depth away from you. top and chase (3D) see the field as the ground: x right, y running away from you, z height; chase follows the object given as follow from behind and above. first is the first-person view: the camera sits at the eyes of the object given as follow (which is not drawn) and looks the way its angle points: a view toward angle a (degrees) looks along (-sin a, cos a) in x and y, angle 0 looks along +y, a positive angle turns left; to move or shoot forward set vx = -math.sin(math.rad(a)) * speed and vy = math.cos(math.rad(a)) * speed. In the first view input.x and input.y are a point ahead of you in the view, left or right of the middle by where the pointer is across the screen, so turn toward it with math.atan2(input.x - me.x, input.y - me.y) (negated, to get the angle) at a limited speed. (The player also has two flat cameras, side2d and top2d; do not use them: every game is 3D for now.) zoom above 1 moves in. follow = false stops following." },
  { name: "obj.destroy", signature: "obj:destroy()", doc: "Remove the object." },
  { name: "obj.set_color", signature: "obj:set_color(c)", doc: "Change its color." },
  { name: "obj.play", signature: "obj:play(animation)", doc: "Play one of its animations." },
  { name: "obj.distance", signature: "obj:distance(other)", doc: "The distance to another object." },
  { name: "obj.fields", signature: "obj.x obj.y obj.z obj.vx obj.vy obj.vz obj.w obj.h obj.d obj.angle obj.spin obj.life obj.tag obj.color obj.gravity obj.solid obj.alive obj.kind obj.id obj.data", doc: "Position, velocity, size, turn, tag and flags, which you read and write (alive, kind and id are read only). Any other field you set, such as obj.hp = 3, is kept in obj.data." },
  { name: "input", signature: "input.x input.y input.down input.dx input.dy", doc: "The pointer's field position, whether it is down, and how far it moved this frame." },
  { name: "ui.text", signature: "ui.text(id, string, { x, y, size, color, align })", doc: "Show or update a line of text (a string or a number, at most 2000 characters). Positions and sizes are fractions of the screen: x, y from 0 (left, top) to 1 (right, bottom), size the text height as a fraction of the screen height (0.04 by default); align is left, center or right. Options you leave out keep their last value." },
  { name: "ui.bar", signature: "ui.bar(id, value, max, { x, y, w, h, color })", doc: "Show or update a bar such as a health bar, filled to value out of max. x, y, w, h are fractions of the screen." },
  { name: "ui.clear", signature: "ui.clear(id)", doc: "Remove a text or bar; with no id, remove them all." },
  { name: "timer.after", signature: "timer.after(seconds, fn)", doc: "Run fn once later; returns an id." },
  { name: "timer.every", signature: "timer.every(seconds, fn)", doc: "Run fn repeatedly; returns an id." },
  { name: "timer.cancel", signature: "timer.cancel(id)", doc: "Stop a timer." },
  { name: "rand", signature: "rand()", doc: "A number from 0 to 1, from a seeded generator: the same game plays the same." },
  { name: "rand_int", signature: "rand_int(a, b)", doc: "A whole number from a to b, both included." },
  { name: "print", signature: "print(...)", doc: "Write to the developer log." },
];

/** The libraries a script may use besides the API above. math.random is not among them: use rand(). */
export const ALLOWED_LIBRARIES = ["math (without random)", "string", "table"] as const;

/** How the field and the objects behave, for the prompt (the player's ScriptWorld does exactly this). */
export const FIELD_TEXT = [
  "The field is centered on 0, 0: x runs from -width/2 to width/2 and y from -height/2 to height/2, y up. z is depth and is ignored by collisions and by the 2d cameras.",
  "Objects move by their velocity every frame. Two objects with solid = true raise on_collide once when they begin to overlap (boxes by x, y, w, h; a sphere counts as a circle).",
  "on_exit(obj) is raised once when an object that was inside the field has fully left it; the object is not removed, so call obj:destroy() if it should go.",
  "In the 2d cameras objects are drawn by depth, not in the order they were made: an object with a smaller z is in front. Give things that overlap different z values (a background at z = 1, the action at 0, effects at -1) and keep d small, such as 0.05, so they do not cut through each other.",
  "An object with life = seconds is removed when it runs out. A spawn over the object or spawn-rate limit returns a dead object and does nothing.",
].join("\n");

/** The API as text for the prompt: one line per entry, in table order. */
export function apiText(): string {
  const lines = [
    "Callbacks you may define (define at least one of " + REQUIRED_ONE_OF.join(", ") + "):",
    ...CALLBACKS.map((c) => `- ${c.signature}: ${c.doc}`),
    "",
    "What the player provides (global tables and functions):",
    ...SCRIPT_API.map((a) => `- ${a.signature}: ${a.doc}`),
    "",
    FIELD_TEXT,
    "",
    "Camera modes: " + CAMERA_MODES.filter((mode) => !mode.endsWith("2d")).join(", ") + ". Primitive kinds: " + PRIMITIVE_KINDS.join(", ") + ".",
    "Libraries: " + ALLOWED_LIBRARIES.join(", ") + ".",
    "Not available (using any of these as a name is refused): " + REMOVED_NAMES.join(", ") + ".",
  ];
  return lines.join("\n");
}

/** The limits as text for the prompt. */
export function limitsText(): string {
  const l = SCRIPT_LIMITS;
  return [
    `The script is at most ${l.scriptBytes} bytes.`,
    `One frame may run at most ${l.instructionsPerFrame} Lua instructions: a loop that does too much stops the game.`,
    `At most ${l.objects} objects alive, ${l.spawnsPerSecond} spawns a second, ${l.timers} timers and ${l.uiElements} ui elements; text at most ${l.uiTextLength} characters; no string longer than ${l.stringLength} characters.`,
    "A Lua error stops the game and shows its message to the player.",
  ].join("\n");
}
