// The run domain: what a run is, the two ports the service stores things through, and its errors.
import type { User } from "@/lib/auth/ports";

export interface FileMeta {
  size: number;
  sha256: string;
}

export interface Run {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  status: "pending" | "ready";
  createdAt: number; // milliseconds since the epoch
  needed: string[]; // the distinct GLB file names the settings point at
  files: Record<string, FileMeta>; // what is stored so far, settings.json included
}

/** Run records (Firestore in production). */
export interface RunRecords {
  create(run: Run): Promise<void>;
  get(id: string): Promise<Run | null>;
  listByOwner(uid: string): Promise<Run[]>;
  /**
   * Atomically adds a file to a run, sets the status to "ready" when every needed name is present, and returns the
   * updated run. Throws RunError(404) for a missing run and RunError(409) if the name is already recorded.
   */
  recordFile(id: string, name: string, meta: FileMeta): Promise<Run>;
  delete(id: string): Promise<void>;
}

/** Run files (Cloud Storage in production). */
export interface FileStore {
  /** Stores a file only if there is none under that name; throws FileExistsError otherwise. */
  put(runId: string, name: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(runId: string, name: string): Promise<Uint8Array | null>;
  /** Removes every file of a run. */
  deleteRun(runId: string): Promise<void>;
}

export class FileExistsError extends Error {
  constructor(name: string) {
    super(`${name} already exists`);
    this.name = "FileExistsError";
  }
}

/** A failure with a status and a message that is safe to show the person. */
export class RunError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "RunError";
  }
}

export interface RunService {
  createRun(user: User, settingsText: string): Promise<{ id: string; needed: string[] }>;
  putFile(user: User, id: string, name: string, bytes: Uint8Array): Promise<Run>;
  readFile(user: User, id: string, name: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  listRuns(user: User): Promise<Run[]>;
  deleteRun(user: User, id: string): Promise<void>;
}
