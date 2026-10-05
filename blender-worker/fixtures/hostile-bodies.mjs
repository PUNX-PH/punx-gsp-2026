// Bodies a hostile caller might send to POST /build, built from the default biped. Shared by the check's tests and the server's tests:
// every one must be refused by checkBuildBody and answered 422 bad-recipe, with Blender never started.
import { readFileSync } from "node:fs";

const biped = () => JSON.parse(readFileSync(new URL("./recipes/biped-default.json", import.meta.url), "utf8"));

export function hostileBodies() {
  const list = [];
  const add = (name, value) => list.push([name, value]);
  let b;
  add("an extra __proto__ key in build", JSON.parse(JSON.stringify(biped()).replace('"headSize"', '"__proto__":1,"headSize"')));
  b = biped(); b.motions.motions.run.tracks[0].joint = "constructor"; add("a track joint named constructor", b);
  b = biped(); b.motions.motions.run.tracks[0].joint = "../hips"; add("a track joint that is a path", b);
  b = biped(); b.motions.motions.run.tracks[0].joint = "hips; rm -rf /"; add("a track joint that is a command", b);
  b = biped(); b.motions.motions.run.tracks[0].amplitude = 1e308; add("an amplitude of 1e308", b);
  add("seconds as a string", JSON.parse(JSON.stringify(biped()).replace('"seconds": 0.6', '"seconds": "0.6"').replace('"seconds":0.6', '"seconds":"0.6"')));
  b = biped(); b.script = "import os"; add("an extra top-level script key", b);
  b = biped(); b.palette = b.palette.slice(0, 4); add("a palette of four", b);
  b = biped(); b.palette[1] = "red"; add("a palette entry that is not hex", b);
  b = biped(); b.recipe.build.headSize = "NaN"; add("a build value that is a string", b);
  b = biped(); b.recipe.extras = ["constructor"]; add("an extra named constructor", b);
  b = biped(); b.recipe.kind = "__proto__"; add("a kind named __proto__", b);
  add("null", null);
  add("an array", []);
  add("a number", 4);
  return list;
}
