// The real RunRecords (Firestore) and FileStore (Cloud Storage), both through the Admin SDK, which is the only way
// anything reaches them: the security rules deny all client access. These adapters are thin on purpose; the rules
// about runs live in service.ts and are tested there. They are first exercised on the deployment.
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/lib/auth/firebaseAdmin";
import { makeRunService } from "@/lib/runs/service";
import { type FileMeta, FileExistsError, type FileStore, type Run, RunError, type RunRecords, type RunService } from "@/lib/runs/types";

const COLLECTION = "runs";
const PRECONDITION_FAILED = 412;
const NOT_FOUND = 404;

export class FirestoreRunRecords implements RunRecords {
  private collection = () => getFirestore(adminApp()).collection(COLLECTION);

  async create(run: Run): Promise<void> {
    await this.collection().doc(run.id).create(run);
  }

  async get(id: string): Promise<Run | null> {
    const snapshot = await this.collection().doc(id).get();
    return snapshot.exists ? (snapshot.data() as Run) : null;
  }

  // Filtering on the owner alone needs no composite index; the service sorts the few results itself.
  async listByOwner(uid: string): Promise<Run[]> {
    const snapshot = await this.collection().where("ownerUid", "==", uid).get();
    return snapshot.docs.map((doc) => doc.data() as Run);
  }

  async recordFile(id: string, name: string, meta: FileMeta): Promise<Run> {
    const reference = this.collection().doc(id);
    return getFirestore(adminApp()).runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new RunError(404, "Not found");
      const run = snapshot.data() as Run;
      if (run.files[name]) throw new RunError(409, `${name} was already uploaded`);

      // The whole map is replaced: file names contain dots, which a "files.<name>" field path would read as nesting.
      const files = { ...run.files, [name]: meta };
      const status = run.needed.every((needed) => files[needed]) ? "ready" : "pending";
      transaction.update(reference, { files, status });
      return { ...run, files, status };
    });
  }

  async delete(id: string): Promise<void> {
    await this.collection().doc(id).delete();
  }
}

export class CloudFileStore implements FileStore {
  private bucket = () => getStorage(adminApp()).bucket();
  private path = (runId: string, name: string) => `runs/${runId}/${name}`;

  async put(runId: string, name: string, bytes: Uint8Array, contentType: string): Promise<void> {
    try {
      // ifGenerationMatch: 0 means "only if no object exists yet", so the first of two simultaneous uploads wins.
      await this.bucket()
        .file(this.path(runId, name))
        .save(Buffer.from(bytes), { contentType, resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (error) {
      if ((error as { code?: number }).code === PRECONDITION_FAILED) throw new FileExistsError(name);
      throw error;
    }
  }

  async get(runId: string, name: string): Promise<Uint8Array | null> {
    try {
      const [contents] = await this.bucket().file(this.path(runId, name)).download();
      return new Uint8Array(contents);
    } catch (error) {
      if ((error as { code?: number }).code === NOT_FOUND) return null;
      throw error;
    }
  }

  async deleteRun(runId: string): Promise<void> {
    await this.bucket().deleteFiles({ prefix: `runs/${runId}/` });
  }
}

/** The run service wired to Firestore and Cloud Storage. */
export function getRunService(): RunService {
  return makeRunService({ records: new FirestoreRunRecords(), files: new CloudFileStore(), now: Date.now });
}
