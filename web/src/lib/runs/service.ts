// The run service: the rules about runs, over two ports (records and files) so that it is tested with in-memory
// fakes. A run is created from validated settings, receives the GLBs those settings name, and becomes ready when
// the last one is stored. Everything about who may see a run is decided here: a run that is not yours, does not
// exist, or has no such file all look the same ("Not found").
import type { User } from "@/lib/auth/ports";
import { checkGlb } from "@/lib/glb";
import { rolesNeeded, validateSettings } from "@/lib/settings";
import { FileExistsError, type FileStore, type Run, RunError, type RunRecords, type RunService } from "@/lib/runs/types";

const MAX_RUNS_PER_PERSON = 20;
const PENDING_RUN_TTL_MS = 60 * 60 * 1000;
const SETTINGS_FILE = "settings.json";
// What a run id looks like (ours are 22 URL-safe characters). Anything else is not a run, and is never passed on: a
// slash or a leading "__" would make Firestore throw, and the person should just see the uniform 404.
const RUN_ID = /^(?!__)[A-Za-z0-9_-]{1,64}$/;

export interface RunServiceDeps {
  records: RunRecords;
  files: FileStore;
  now: () => number;
  newId?: () => string;
}

export function makeRunService(deps: RunServiceDeps): RunService {
  const { records, files, now } = deps;
  const newId = deps.newId ?? randomId;
  const notFound = () => new RunError(404, "Not found");

  async function ownedRun(user: User, id: string): Promise<Run> {
    if (!RUN_ID.test(id)) throw notFound();
    const run = await records.get(id);
    if (!run || run.ownerUid !== user.uid) throw notFound();
    return run;
  }

  // Removes this person's pending runs that were abandoned (an upload that never finished), and returns the rest.
  async function ownRunsAfterCleanup(user: User): Promise<Run[]> {
    const runs = await records.listByOwner(user.uid);
    const kept: Run[] = [];
    for (const run of runs) {
      if (run.status === "pending" && now() - run.createdAt > PENDING_RUN_TTL_MS) {
        await files.deleteRun(run.id);
        await records.delete(run.id);
      } else {
        kept.push(run);
      }
    }
    return kept;
  }

  return {
    async createRun(user, settingsText) {
      const result = validateSettings(settingsText);
      if (!result.ok) throw new RunError(400, result.error);

      const existing = await ownRunsAfterCleanup(user);
      if (existing.length >= MAX_RUNS_PER_PERSON) throw new RunError(409, `You have ${MAX_RUNS_PER_PERSON} runs. Delete one first.`);

      const id = newId();
      const needed = rolesNeeded(result.settings);
      const settingsBytes = new TextEncoder().encode(result.text);
      // The record goes first: if storing the file fails, a pending run is left that cleanup removes after an hour.
      await records.create({
        id,
        ownerUid: user.uid,
        ownerEmail: user.email,
        status: "pending",
        createdAt: now(),
        needed,
        files: { [SETTINGS_FILE]: { size: settingsBytes.length, sha256: await sha256Hex(settingsBytes) } },
      });
      await files.put(id, SETTINGS_FILE, settingsBytes, contentTypeFor(SETTINGS_FILE));
      return { id, needed };
    },

    async putFile(user, id, name, bytes) {
      const run = await ownedRun(user, id);
      if (!run.needed.includes(name)) throw new RunError(400, `${name} is not one of this run's files`);
      if (Object.hasOwn(run.files, name)) throw new RunError(409, `${name} was already uploaded`);

      const checked = checkGlb(name, bytes);
      if (!checked.ok) throw new RunError(400, checked.error);

      const meta = { size: bytes.length, sha256: await sha256Hex(bytes) };
      try {
        // Storing refuses an existing name, so of two simultaneous uploads of the same file only one gets through.
        await files.put(id, name, bytes, contentTypeFor(name));
      } catch (error) {
        if (error instanceof FileExistsError) throw new RunError(409, `${name} was already uploaded`);
        throw error;
      }
      return records.recordFile(id, name, meta);
    },

    async readFile(user, id, name) {
      const run = await ownedRun(user, id);
      if (!Object.hasOwn(run.files, name)) throw notFound(); // not run.files[name]: "constructor" is truthy there
      const bytes = await files.get(id, name);
      if (!bytes) throw notFound();
      return { bytes, contentType: contentTypeFor(name) };
    },

    async listRuns(user) {
      const runs = await ownRunsAfterCleanup(user);
      return runs.sort((a, b) => b.createdAt - a.createdAt);
    },

    async deleteRun(user, id) {
      await ownedRun(user, id);
      await files.deleteRun(id);
      await records.delete(id);
    },
  };
}

function contentTypeFor(name: string): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".glb") return "model/gltf-binary";
  return "application/octet-stream";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// 128 random bits, URL-safe.
export function randomId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
}
