import { describe, expect, it } from "vitest";
import { createAutosave, type SaveResult, type SaveState } from "@/lib/canvas/autosave";
import { starterGraph } from "@/lib/graph/starter";
import type { Graph } from "@/lib/graph/types";

const DELAY = 800;

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set(fn: () => void, ms: number) {
        const id = nextId++;
        pending.set(id, { at: now + ms, fn });
        return id;
      },
      clear(handle: unknown) {
        pending.delete(handle as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
    count: () => pending.size,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const graphWith = (x: number): Graph => ({ ...starterGraph(), nodes: starterGraph().nodes.map((n, i) => (i === 0 ? { ...n, position: { x, y: 0 } } : n)) });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const clock = fakeTimers();
  const calls: Graph[] = [];
  const answers: ReturnType<typeof deferred<SaveResult>>[] = [];
  const autosave = createAutosave({
    delayMs: DELAY,
    timers: clock.timers,
    save: (graph) => {
      calls.push(graph);
      const answer = deferred<SaveResult>();
      answers.push(answer);
      return answer.promise;
    },
  });
  const states: string[] = [];
  autosave.subscribe((s) => states.push(s.status));
  return { autosave, clock, calls, answers, states };
}

describe("autosave", () => {
  it("saves once, with the last graph, after edits stop for the delay", async () => {
    const { autosave, clock, calls, answers, states } = setup();
    autosave.edit(graphWith(1));
    autosave.edit(graphWith(2));
    autosave.edit(graphWith(3));

    clock.advance(DELAY - 1);
    expect(calls).toHaveLength(0);
    clock.advance(1);
    expect(calls).toEqual([graphWith(3)]);

    answers[0].resolve({ ok: true });
    await tick();
    expect(autosave.state()).toEqual({ status: "saved" });
    expect(states).toEqual(["dirty", "saving", "saved"]);
  });

  it("does not start a second save while one is on its way, and saves the newest graph after it", async () => {
    const { autosave, clock, calls, answers } = setup();
    autosave.edit(graphWith(1));
    clock.advance(DELAY);
    expect(calls).toHaveLength(1);

    autosave.edit(graphWith(2));
    clock.advance(DELAY);
    expect(calls).toHaveLength(1); // still waiting for the first
    expect(autosave.state().status).toBe("saving");

    answers[0].resolve({ ok: true });
    await tick();
    expect(autosave.state().status).toBe("dirty");
    clock.advance(DELAY);
    expect(calls).toEqual([graphWith(1), graphWith(2)]);

    answers[1].resolve({ ok: true });
    await tick();
    expect(autosave.state()).toEqual({ status: "saved" });
  });

  it("shows the failure, and does not try again until there is a new edit or a retry", async () => {
    const { autosave, clock, calls, answers } = setup();
    autosave.edit(graphWith(1));
    clock.advance(DELAY);
    answers[0].resolve({ ok: false, message: "The graph is larger than 64 KB", retryable: false });
    await tick();
    expect(autosave.state()).toEqual({ status: "error", message: "The graph is larger than 64 KB", retryable: false });

    clock.advance(60_000);
    expect(calls).toHaveLength(1);

    autosave.edit(graphWith(2));
    clock.advance(DELAY);
    expect(calls).toHaveLength(2);
  });

  it("retries the latest graph on request", async () => {
    const { autosave, clock, calls, answers } = setup();
    autosave.edit(graphWith(1));
    clock.advance(DELAY);
    answers[0].resolve({ ok: false, message: "Couldn't reach the server.", retryable: true });
    await tick();

    autosave.retry();
    expect(calls).toEqual([graphWith(1), graphWith(1)]);
    answers[1].resolve({ ok: true });
    await tick();
    expect(autosave.state()).toEqual({ status: "saved" });
  });

  it("treats a save that throws as a retryable failure", async () => {
    const clock = fakeTimers();
    const autosave = createAutosave({ delayMs: DELAY, timers: clock.timers, save: () => Promise.reject(new Error("boom")) });
    autosave.edit(graphWith(1));
    clock.advance(DELAY);
    await tick();
    expect(autosave.state()).toEqual({ status: "error", message: "Something went wrong on our side", retryable: true });
  });
});

describe("autosave.flush", () => {
  it("saves a pending edit now, without waiting for the delay", async () => {
    const { autosave, calls, answers } = setup();
    autosave.edit(graphWith(1));

    const flushed = autosave.flush();
    expect(calls).toEqual([graphWith(1)]);
    answers[0].resolve({ ok: true });
    expect(await flushed).toBe(true);
    expect(autosave.state()).toEqual({ status: "saved" });
  });

  it("waits for a save that is on its way, and then saves anything newer", async () => {
    const { autosave, clock, calls, answers } = setup();
    autosave.edit(graphWith(1));
    clock.advance(DELAY);
    autosave.edit(graphWith(2));

    let finished = false;
    const flushed = autosave.flush().then((ok) => {
      finished = true;
      return ok;
    });
    await tick();
    expect(finished).toBe(false);

    answers[0].resolve({ ok: true });
    await tick();
    expect(calls).toEqual([graphWith(1), graphWith(2)]);
    expect(finished).toBe(false);

    answers[1].resolve({ ok: true });
    expect(await flushed).toBe(true);
  });

  it("is true at once when there is nothing to save, and false after a failure", async () => {
    const idle = setup();
    expect(await idle.autosave.flush()).toBe(true);
    expect(idle.calls).toHaveLength(0);

    const failing = setup();
    failing.autosave.edit(graphWith(1));
    const flushed = failing.autosave.flush();
    failing.answers[0].resolve({ ok: false, message: "x", retryable: true });
    expect(await flushed).toBe(false);
    expect(await failing.autosave.flush()).toBe(false);
  });
});

describe("autosave.subscribe and dispose", () => {
  it("stops telling a listener that unsubscribed", () => {
    const { autosave } = setup();
    const heard: SaveState[] = [];
    const stop = autosave.subscribe((s) => heard.push(s));
    autosave.edit(graphWith(1));
    stop();
    autosave.edit(graphWith(2));
    expect(heard).toEqual([{ status: "dirty" }]);
  });

  it("saves nothing after it is disposed", () => {
    const { autosave, clock, calls } = setup();
    autosave.edit(graphWith(1));
    autosave.dispose();
    clock.advance(DELAY * 10);
    expect(calls).toHaveLength(0);
    expect(clock.count()).toBe(0);
  });
});
