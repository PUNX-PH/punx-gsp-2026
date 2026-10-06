// Writes the High tier (tiers-table.mjs) into blender-worker/scripts/kit.json, and mirrors kit.json's scenery and tiers into the typed KIT
// literal of web/src/lib/builder/kinds.ts. Idempotent. Run after editing tiers-table.mjs or the scenery part of kit.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TIERS } from "./tiers-table.mjs";

const kitPath = fileURLToPath(new URL("../scripts/kit.json", import.meta.url));
const kindsPath = fileURLToPath(new URL("../../web/src/lib/builder/kinds.ts", import.meta.url));

const primitive = (v) => v === null || typeof v !== "object";
function fmt(value, depth) {
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  if (primitive(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.every(primitive)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    return `[\n${value.map((v) => inner + fmt(v, depth + 1)).join(",\n")}\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (entries.every(([, v]) => primitive(v))) return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${fmt(v, depth + 1)}`).join(",\n")}\n${pad}}`;
}

// ---- kit.json: everything before "tiers" stays as it is
let kit = readFileSync(kitPath, "utf8");
const at = kit.indexOf(',\n  "tiers": ');
kit = at >= 0 ? kit.slice(0, at) : kit.slice(0, kit.lastIndexOf("\n}"));
kit += `,\n  "tiers": ${fmt(TIERS, 1)}\n}\n`;
writeFileSync(kitPath, kit);
const parsed = JSON.parse(kit); // must stay valid JSON

// ---- kinds.ts: the typed literal's scenery and tiers
const line = (v) => JSON.stringify(v).replace(/,/g, ", ").replace(/":/g, '": ').replace(/\{/g, "{ ").replace(/\}/g, " }");
const track = (t) => `          ${line(t)}`;
const sceneryEntries = Object.entries(parsed.scenery).map(([name, e]) => {
  const loop = e.loop
    ? `{\n        "seconds": ${e.loop.seconds},\n        "tracks": [\n${e.loop.tracks.map(track).join(",\n")}\n        ]\n      }`
    : "null";
  return `    "${name}": {
      "joints": ${line(e.joints)},
      "slots": ${line(e.slots)},
      "height": ${e.height},
      "count": ${line(e.count)},
      "loop": ${loop}
    }`;
});
const section = `  "scenery": {\n${sceneryEntries.join(",\n")}\n  },\n  "tiers": ${fmt(parsed.tiers, 1)}\n};\n`;
const source = readFileSync(kindsPath, "utf8");
const marker = source.indexOf('  "scenery": ');
if (marker < 0) throw new Error("no scenery section in kinds.ts");
const end = source.indexOf("\n};\n", marker) + 4; // the literal ends at the first closing brace in column 0; whatever follows it is kept
writeFileSync(kindsPath, source.slice(0, marker) + section + source.slice(end));
console.log("tiers written to kit.json and kinds.ts");
