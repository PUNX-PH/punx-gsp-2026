import luaparse, { type LuaNode } from "luaparse";
import { CALLBACKS, REMOVED_NAMES, REQUIRED_ONE_OF, SCRIPT_LIMITS } from "./api";

export type ScriptCheck = { ok: true } | { ok: false; reason: string };

const CALLBACK_NAMES: ReadonlySet<string> = new Set(CALLBACKS.map((c) => c.name));
const REMOVED: ReadonlySet<string> = new Set(REMOVED_NAMES);

/**
 * Checks a game script before it is stored or sent to a player: its size, its syntax, that it does not use a name the player removed, and that it
 * defines a callback the player can run. The text is only parsed here, never run. A failure is one message Claude can act on. A name inside a
 * string or a comment is fine, because the check reads the parse tree and not the text.
 */
export function checkScript(text: string): ScriptCheck {
  if (text.trim() === "") return fail("The script is empty. Write a game that defines at least one callback.");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > SCRIPT_LIMITS.scriptBytes) return fail(`The script is ${bytes} bytes; the most allowed is ${SCRIPT_LIMITS.scriptBytes} bytes. Make the game smaller.`);
  if (text.includes("\0")) return fail("The script contains a NUL character. Remove it.");

  let chunk;
  try {
    chunk = luaparse.parse(text, { luaVersion: "5.2", locations: true, comments: false });
  } catch (e) {
    const error = e as { line?: number; message?: string };
    const message = (error.message ?? "invalid script").replace(/^\[\d+:\d+\]\s*/, "");
    return fail(`Syntax error${error.line ? ` on line ${error.line}` : ""}: ${message}. Fix the syntax; the script must be valid Lua.`);
  }

  const problems: string[] = [];

  const seen = new Set<string>();
  walk(chunk, (node) => {
    if (node.type !== "Identifier" || !node.name || !REMOVED.has(node.name) || seen.has(node.name)) return;
    seen.add(node.name);
    const line = node.loc?.start.line;
    problems.push(`The script uses \`${node.name}\`${line ? ` (line ${line})` : ""}, which the player does not have. Remove it and use only the game API.`);
  });

  const defined = new Map<string, number>();
  for (const statement of chunk.body) {
    for (const name of callbackDefinitions(statement)) defined.set(name, (defined.get(name) ?? 0) + 1);
  }
  for (const [name, count] of defined) {
    if (count > 1) problems.push(`The callback \`${name}\` is defined more than once. Define each callback once.`);
  }
  if (!REQUIRED_ONE_OF.some((name) => defined.has(name))) {
    problems.push(`The script defines no callback, so nothing would happen: define at least one of ${REQUIRED_ONE_OF.join(", ")} as a global function.`);
  }

  return problems.length === 0 ? { ok: true } : fail(problems.slice(0, 5).join(" "));
}

function fail(reason: string): ScriptCheck {
  return { ok: false, reason };
}

/** The callback names a top-level statement defines as globals: `function update() end` or `update = function() end`. */
function callbackDefinitions(statement: LuaNode): string[] {
  const names: string[] = [];
  if (statement.type === "FunctionDeclaration" && statement.isLocal !== true) {
    const id = statement.identifier as LuaNode | null;
    if (id?.type === "Identifier" && id.name && CALLBACK_NAMES.has(id.name)) names.push(id.name);
  } else if (statement.type === "AssignmentStatement") {
    const variables = (statement.variables as LuaNode[]) ?? [];
    const values = (statement.init as LuaNode[]) ?? [];
    variables.forEach((variable, i) => {
      if (variable.type === "Identifier" && variable.name && CALLBACK_NAMES.has(variable.name) && values[i]?.type === "FunctionDeclaration") names.push(variable.name);
    });
  }
  return names;
}

function walk(node: unknown, visit: (node: LuaNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (node && typeof node === "object") {
    const n = node as LuaNode;
    if (typeof n.type === "string") visit(n);
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "range") continue;
      const value = n[key];
      if (value && typeof value === "object") walk(value, visit);
    }
  }
}
