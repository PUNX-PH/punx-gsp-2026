// A stand-in for Blender, for the wrapper's tests. It is started the way the wrapper starts Blender (node fake-blender.mjs [test
// options] -b ... -P script -- --in .. --out .. --stats ..), and what it does depends on markers in its input file:
//   EMPTY exits 3 (no 3D shape), BROKEN exits 4 (unreadable), CRASH exits 1, SLEEP hangs, NOOUT exits 0 without an output file.
// It also exits 7 if it can see an environment variable with SECRET in its name (the wrapper must not pass its own environment on).
import fs from "node:fs";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const before = split === -1 ? argv : argv.slice(0, split);
const after = split === -1 ? [] : argv.slice(split + 1);
const option = (list, name) => {
  const at = list.indexOf(name);
  return at === -1 ? null : list[at + 1];
};

const startedFile = option(before, "--startedfile");
if (startedFile) fs.writeFileSync(startedFile, "started");
const pidFile = option(before, "--pidfile");
if (pidFile) fs.writeFileSync(pidFile, String(process.pid));

if (Object.keys(process.env).some((name) => name.includes("SECRET"))) process.exit(7);

const input = option(after, "--in");
const text = input ? fs.readFileSync(input, "latin1") : "";
if (text.includes("EMPTY")) process.exit(3);
if (text.includes("BROKEN")) process.exit(4);
if (text.includes("CRASH")) process.exit(1);
if (text.includes("SLEEP")) {
  setTimeout(() => {}, 60_000); // hang until killed
} else {
  if (!text.includes("NOOUT")) {
    fs.writeFileSync(option(after, "--out"), Buffer.concat([Buffer.from("glTF"), Buffer.alloc(8)]));
    fs.writeFileSync(option(after, "--stats"), JSON.stringify(input ? { before: 9400, after: 2000 } : { after: 80 }));
  }
  process.exit(0);
}
