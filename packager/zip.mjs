// A small zip editor: read a zip's central directory, and rebuild it with some entries dropped and some added. Kept entries are copied byte for byte
// (their data is never recompressed), added ones are stored, and every offset is rewritten. No ZIP64: a player is tens of megabytes. Node built-ins only.
import { crc32 } from "node:zlib";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (46 << 9) | (1 << 5) | 1; // 2026-01-01: a fixed stamp, so the same game packs to the same bytes

/** The central directory of a zip: its entries (name, offset, raw length) and where the directory starts. Throws on anything it cannot read. */
export function listZip(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(end + 10);
  const size = buf.readUInt32LE(end + 12);
  const start = buf.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new Error("zip64 is not supported");
  if (start + size > end) throw new Error("bad zip directory");

  const entries = [];
  let at = start;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || buf.readUInt32LE(at) !== CENTRAL) throw new Error("bad zip directory");
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    if (offset >= start || buf.readUInt32LE(offset) !== LOCAL) throw new Error("bad zip entry");
    entries.push({ name: buf.toString("utf8", at + 46, at + 46 + nameLength), offset, central: buf.subarray(at, at + 46 + nameLength + extraLength + commentLength) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  // An entry's raw bytes run to the next entry's start (or to the directory): that includes its data descriptor, if it has one.
  const byOffset = [...entries].sort((a, b) => a.offset - b.offset);
  byOffset.forEach((entry, i) => {
    entry.rawLength = (i + 1 < byOffset.length ? byOffset[i + 1].offset : start) - entry.offset;
  });
  return { entries, start };
}

/** An empty zip, to add entries to. */
export const emptyZip = () => {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  return end;
};

/**
 * The zip with every entry for which `drop(name)` is true removed and the `add` entries ({ name, data }) added, stored uncompressed. An added
 * entry replaces any kept one of the same name.
 */
export function rebuildZip(bytes, { drop = () => false, add = [] }) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  const { entries } = listZip(bytes);
  const replaced = new Set(add.map((a) => a.name));
  const kept = entries.filter((e) => !drop(e.name) && !replaced.has(e.name));

  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of kept) {
    parts.push(buf.subarray(entry.offset, entry.offset + entry.rawLength));
    const head = Buffer.from(entry.central);
    head.writeUInt32LE(offset, 42);
    central.push(head);
    offset += entry.rawLength;
  }
  for (const { name, data } of add) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = Buffer.from(data);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, body);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(CENTRAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(DOS_TIME, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(body.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([head, nameBytes]));
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** The stored (uncompressed) content of an entry added by `rebuildZip`; null when there is none by that name. For tests and checks. */
export function readStored(bytes, name) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  const entry = listZip(bytes).entries.find((e) => e.name === name);
  if (!entry) return null;
  if (buf.readUInt16LE(entry.offset + 8) !== 0) throw new Error("entry is compressed");
  const size = buf.readUInt32LE(entry.offset + 22);
  const data = entry.offset + 30 + buf.readUInt16LE(entry.offset + 26) + buf.readUInt16LE(entry.offset + 28);
  return buf.subarray(data, data + size);
}
