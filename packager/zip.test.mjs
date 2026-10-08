import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { emptyZip, listZip, readStored, rebuildZip } from "./zip.mjs";

/** A zip as another tool would write it: deflated entries, a data descriptor on one, and an extra field on another. */
function foreignZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  files.forEach(({ name, data, descriptor, extra }, index) => {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(data);
    const packed = deflateRawSync(raw);
    const extraBytes = extra ? Buffer.from([0xaa, 0xbb, 0x02, 0x00, 1, 2]) : Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(descriptor ? 8 : 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(descriptor ? 0 : crc32(raw), 14);
    local.writeUInt32LE(descriptor ? 0 : packed.length, 18);
    local.writeUInt32LE(descriptor ? 0 : raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extraBytes.length, 28);
    const dd = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor) {
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(crc32(raw), 4);
      dd.writeUInt32LE(packed.length, 8);
      dd.writeUInt32LE(raw.length, 12);
    }
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(descriptor ? 8 : 0, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc32(raw), 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt16LE(extraBytes.length, 30);
    head.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([head, nameBytes, extraBytes]));
    parts.push(local, nameBytes, extraBytes, packed, dd);
    offset += 30 + nameBytes.length + extraBytes.length + packed.length + dd.length;
    void index;
  });
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const names = (zip) => listZip(zip).entries.map((e) => e.name);

test("an empty zip lists nothing, and entries added to it are stored and read back", () => {
  assert.deepEqual(listZip(emptyZip()).entries, []);
  const zip = rebuildZip(emptyZip(), { add: [{ name: "a/settings.json", data: Buffer.from('{"x":1}') }, { name: "b.glb", data: Buffer.from("glTF....") }] });
  assert.deepEqual(names(zip), ["a/settings.json", "b.glb"]);
  assert.equal(readStored(zip, "a/settings.json").toString(), '{"x":1}');
  assert.equal(readStored(zip, "b.glb").toString(), "glTF....");
  assert.equal(readStored(zip, "nope"), null);
});

test("kept entries are copied byte for byte, with a data descriptor or an extra field, and their offsets are rewritten", () => {
  const original = foreignZip([
    { name: "META-INF/CERT.RSA", data: "old signature" },
    { name: "classes.dex", data: "x".repeat(500), descriptor: true },
    { name: "AndroidManifest.xml", data: "manifest", extra: true },
  ]);
  const built = rebuildZip(original, { drop: (name) => name.startsWith("META-INF/"), add: [{ name: "assets/game/settings.json", data: Buffer.from("{}") }] });
  assert.deepEqual(names(built), ["classes.dex", "AndroidManifest.xml", "assets/game/settings.json"]);
  const before = listZip(original).entries;
  const after = listZip(built).entries;
  for (const name of ["classes.dex", "AndroidManifest.xml"]) {
    const a = before.find((e) => e.name === name);
    const b = after.find((e) => e.name === name);
    assert.equal(a.rawLength, b.rawLength);
    assert.ok(Buffer.from(original).subarray(a.offset, a.offset + a.rawLength).equals(Buffer.from(built).subarray(b.offset, b.offset + b.rawLength)));
  }
  assert.equal(readStored(built, "assets/game/settings.json").toString(), "{}");
});

test("an added entry replaces a kept one of the same name, and the same input gives the same bytes", () => {
  const original = foreignZip([{ name: "game/settings.json", data: "old" }]);
  const add = [{ name: "game/settings.json", data: Buffer.from("new") }];
  const a = rebuildZip(original, { add });
  assert.deepEqual(names(a), ["game/settings.json"]);
  assert.equal(readStored(a, "game/settings.json").toString(), "new");
  assert.ok(a.equals(rebuildZip(original, { add })));
});

test("a stored entry's crc is the real one", () => {
  const zip = rebuildZip(emptyZip(), { add: [{ name: "f", data: Buffer.from("hello") }] });
  assert.equal(zip.readUInt32LE(14), crc32(Buffer.from("hello")));
});

test("refuses what is not a zip, a damaged directory, and zip64", () => {
  assert.throws(() => listZip(Buffer.from("not a zip at all, just text")), /not a zip/);
  const good = rebuildZip(emptyZip(), { add: [{ name: "f", data: Buffer.from("x") }] });
  const damaged = Buffer.from(good);
  damaged.writeUInt32LE(0xdeadbeef, damaged.length - 22 + 16); // the directory offset points nowhere
  assert.throws(() => listZip(damaged), /bad zip/);
  const sixtyFour = Buffer.from(good);
  sixtyFour.writeUInt32LE(0xffffffff, sixtyFour.length - 22 + 16);
  assert.throws(() => listZip(sixtyFour), /zip64/);
});
