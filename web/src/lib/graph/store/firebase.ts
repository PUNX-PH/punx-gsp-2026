// The real GraphRecords (Firestore) and GraphFiles (Cloud Storage), both through the Admin SDK, which is the only way
// anything reaches them: the security rules deny all client access. Thin on purpose; the rules about graphs live in
// service.ts and are tested there against the in-memory fakes. These are first exercised on the deployment.
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/lib/auth/firebaseAdmin";
import type { GraphFiles, GraphRecords } from "@/lib/graph/store/ports";
import { type AssetInfo, type Graph, GraphError, type GraphRecord } from "@/lib/graph/types";

const COLLECTION = "graphs";
const NOT_FOUND = 404;
const FIRESTORE_NOT_FOUND = 5;

// Firestore refuses `undefined` field values, and an asset has optional fields (a model has no width). A JSON round
// trip drops them. Everything stored here is plain JSON data.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class FirestoreGraphRecords implements GraphRecords {
  private db = () => getFirestore(adminApp());
  private collection = () => this.db().collection(COLLECTION);

  async create(record: GraphRecord): Promise<void> {
    await this.collection().doc(record.id).create(plain(record));
  }

  async get(id: string): Promise<GraphRecord | null> {
    const snapshot = await this.collection().doc(id).get();
    return snapshot.exists ? (snapshot.data() as GraphRecord) : null;
  }

  // Filtering on the owner alone needs no composite index; the service sorts the few results itself.
  async listByOwner(uid: string): Promise<GraphRecord[]> {
    const snapshot = await this.collection().where("ownerUid", "==", uid).get();
    return snapshot.docs.map((doc) => doc.data() as GraphRecord);
  }

  async update(id: string, change: { name?: string; graph?: Graph; removeAssets?: string[]; updatedAt: number }): Promise<GraphRecord> {
    const reference = this.collection().doc(id);
    return this.db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new GraphError(404, "Not found");
      const record = snapshot.data() as GraphRecord;

      const assets = { ...record.assets };
      for (const sha of change.removeAssets ?? []) delete assets[sha];
      const updated: GraphRecord = {
        ...record,
        name: change.name ?? record.name,
        graph: change.graph ?? record.graph,
        assets,
        updatedAt: change.updatedAt,
      };
      // Whole fields are replaced: a graph is one value, and the assets map is rewritten as a whole.
      transaction.update(reference, plain({ name: updated.name, graph: updated.graph, assets: updated.assets, updatedAt: updated.updatedAt }));
      return updated;
    });
  }

  async addAsset(id: string, sha256: string, info: AssetInfo, max: number): Promise<GraphRecord> {
    const reference = this.collection().doc(id);
    return this.db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new GraphError(404, "Not found");
      const record = snapshot.data() as GraphRecord;
      if (Object.hasOwn(record.assets, sha256)) return record;
      if (Object.keys(record.assets).length >= max) throw new GraphError(409, `This graph has ${max} files. Remove one first.`);

      const assets = { ...record.assets, [sha256]: info };
      transaction.update(reference, { assets: plain(assets) });
      return { ...record, assets };
    });
  }

  async setLastRunId(id: string, runId: string | null): Promise<void> {
    try {
      await this.collection().doc(id).update({ lastRunId: runId });
    } catch (error) {
      if ((error as { code?: number }).code === FIRESTORE_NOT_FOUND) throw new GraphError(404, "Not found");
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.collection().doc(id).delete();
  }
}

export class CloudGraphFiles implements GraphFiles {
  private bucket = () => getStorage(adminApp()).bucket();
  private path = (graphId: string, sha256: string) => `graphs/${graphId}/assets/${sha256}`;

  // No "only if absent" precondition: the name is the file's own hash, so a second put stores the same bytes.
  async put(graphId: string, sha256: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.bucket().file(this.path(graphId, sha256)).save(Buffer.from(bytes), { contentType, resumable: false });
  }

  async get(graphId: string, sha256: string): Promise<Uint8Array | null> {
    try {
      const [contents] = await this.bucket().file(this.path(graphId, sha256)).download();
      return new Uint8Array(contents);
    } catch (error) {
      if ((error as { code?: number }).code === NOT_FOUND) return null;
      throw error;
    }
  }

  async delete(graphId: string, sha256: string): Promise<void> {
    await this.bucket().file(this.path(graphId, sha256)).delete({ ignoreNotFound: true });
  }

  async deleteGraph(graphId: string): Promise<void> {
    await this.bucket().deleteFiles({ prefix: `graphs/${graphId}/` });
  }
}
