// Saving the graph as it is edited: wait for a quiet moment, save the newest graph, show what is happening, and never
// loop on a failure. Pure apart from the timers, which are injected so a test controls time.
import type { Graph } from "@/lib/graph/types";

export type SaveResult = { ok: true } | { ok: false; message: string; retryable: boolean };

export type SaveState = { status: "idle" | "dirty" | "saving" | "saved" } | { status: "error"; message: string; retryable: boolean };

export interface Autosave {
  state(): SaveState;
  subscribe(listener: (state: SaveState) => void): () => void;
  /** Records the newest graph and (re)starts the quiet-moment timer. */
  edit(graph: Graph): void;
  /** Saves anything pending now and waits until nothing is on its way. True when everything is saved, false after a failure. */
  flush(): Promise<boolean>;
  /** Tries the newest graph again after a failure. */
  retry(): void;
  dispose(): void;
}

export interface AutosaveOptions {
  save: (graph: Graph) => Promise<SaveResult>;
  delayMs: number;
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

const sameState = (a: SaveState, b: SaveState) => a.status === b.status && (a.status !== "error" || (b.status === "error" && a.message === b.message));

export function createAutosave({ save, delayMs, timers }: AutosaveOptions): Autosave {
  const clock = timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const listeners = new Set<(state: SaveState) => void>();
  let state: SaveState = { status: "idle" };
  let latest: Graph | null = null;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  function setState(next: SaveState) {
    if (sameState(state, next)) return;
    state = next;
    for (const listener of listeners) listener(next);
  }

  function clearTimer() {
    if (timer !== null) clock.clear(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    timer = clock.set(() => {
      timer = null;
      if (!inFlight) void startSave(); // a save on its way schedules the next one itself when it ends
    }, delayMs);
  }

  function startSave(): Promise<void> {
    clearTimer();
    const graph = latest;
    if (!graph || inFlight) return inFlight ?? Promise.resolve();
    setState({ status: "saving" });
    inFlight = (async () => {
      let result: SaveResult;
      try {
        result = await save(graph);
      } catch {
        result = { ok: false, message: "Something went wrong on our side", retryable: true };
      }
      inFlight = null;
      if (disposed) return;
      if (!result.ok) return setState({ status: "error", message: result.message, retryable: result.retryable });
      if (latest !== graph) {
        setState({ status: "dirty" });
        schedule();
      } else {
        setState({ status: "saved" });
      }
    })();
    return inFlight;
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    edit(graph) {
      if (disposed) return;
      latest = graph;
      if (!inFlight) setState({ status: "dirty" });
      schedule();
    },
    async flush() {
      clearTimer();
      for (;;) {
        if (inFlight) {
          await inFlight;
          continue;
        }
        if (state.status === "error") return false;
        if (state.status === "dirty") {
          await startSave();
          continue;
        }
        return true;
      }
    },
    retry() {
      if (state.status === "error") void startSave();
    },
    dispose() {
      disposed = true;
      clearTimer();
      listeners.clear();
    },
  };
}
