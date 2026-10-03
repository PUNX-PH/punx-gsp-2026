// The two ports the graph service stores things through, so that its rules are tested with in-memory fakes: graph
// records (Firestore in production) and graph files (Cloud Storage in production).
import type { AssetInfo, Graph, GraphRecord } from "@/lib/graph/types";

export interface GraphRecords {
  create(record: GraphRecord): Promise<void>;
  get(id: string): Promise<GraphRecord | null>;
  listByOwner(uid: string): Promise<GraphRecord[]>;
  /**
   * Atomically changes the fields given, removes the listed assets, and returns the updated record.
   * Throws GraphError(404) for a missing graph.
   */
  update(id: string, change: { name?: string; graph?: Graph; removeAssets?: string[]; updatedAt: number }): Promise<GraphRecord>;
  /**
   * Atomically records an uploaded file and returns the updated record. A hash that is already recorded changes
   * nothing. Throws GraphError(404) for a missing graph and GraphError(409) when `max` files are already recorded.
   */
  addAsset(id: string, sha256: string, info: AssetInfo, max: number): Promise<GraphRecord>;
  /** Throws GraphError(404) for a missing graph. */
  setLastRunId(id: string, runId: string | null): Promise<void>;
  /** Deleting a graph that is not there is not an error. */
  delete(id: string): Promise<void>;
}

/** Files are stored under their SHA-256, so storing the same file twice is harmless. */
export interface GraphFiles {
  put(graphId: string, sha256: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(graphId: string, sha256: string): Promise<Uint8Array | null>;
  delete(graphId: string, sha256: string): Promise<void>;
  /** Removes every file of a graph. */
  deleteGraph(graphId: string): Promise<void>;
}
