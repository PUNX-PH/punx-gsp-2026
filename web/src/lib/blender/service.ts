// The Blender service: the rules around the worker. It answers from the cache when it can, watches Play's clock, counts a new job
// against the daily limits before the call, asks the worker, keeps the GLB it gets in the graph's folder, remembers it, and says in
// plain words (as a NodeError) when it cannot. It knows nothing about Firestore, Cloud Run or Blender: those are the ports it is
// given, so every rule here is tested with fakes.
import { dayOf } from "@/lib/ai/key";
import type { UsageLimits } from "@/lib/ai/ports";
import { prepareKey, shapeKey } from "@/lib/blender/key";
import type { JobCache } from "@/lib/blender/ports";
import {
  type BlenderJob,
  BlenderRefusedError,
  type BlenderService,
  type BlenderWorker,
  BlenderUnavailableError,
  type MadeModel,
  type MadeResult,
} from "@/lib/blender/types";
import { CALL_TIMEOUT_MS, MIN_START_MS, RAN_OUT_OF_TIME, timeLeft } from "@/lib/graph/playTime";
import { NodeError } from "@/lib/graph/types";

export interface BlenderDeps {
  cache: JobCache;
  limits: UsageLimits;
  worker: BlenderWorker;
  perPerson: number;
  total: number;
  now: () => number;
  /** Where outcomes are logged: the step, the outcome, a code, a status, a kind of error and numbers; never bytes, a name or a message. */
  log?: (info: object) => void;
}

const DID_NOT_ANSWER = "The Blender service did not answer. Try again.";

// What a person is told when Blender ran and refused the file. (An uploaded file is at most 4 MB, so "too-big" is a guard.)
const REFUSED = {
  empty: "This file has no 3D shape in it.",
  "bad-format": "This file could not be read as a GLB, FBX or OBJ.",
  "too-big": "This file is larger than 32 MB.",
  timeout: "This model took longer than 60 seconds. Try a simpler one.",
  failed: "This file could not be prepared. Try another one.",
} as const;

interface Kind {
  step: "prepare-model" | "make-shape";
  label: "Prepare Model" | "Make Shape";
  /** A refusal of a file used the worker's time, so it stays counted. A shape has no file to refuse: any refusal is the service's fault. */
  keepsCountOnRefusal: boolean;
}
const PREPARE: Kind = { step: "prepare-model", label: "Prepare Model", keepsCountOnRefusal: true };
const SHAPE: Kind = { step: "make-shape", label: "Make Shape", keepsCountOnRefusal: false };

export function makeBlenderService(deps: BlenderDeps): BlenderService {
  const log = deps.log ?? (() => {});

  async function run(kind: Kind, key: string, job: BlenderJob, call: (timeoutMs: number) => Promise<MadeModel>): Promise<MadeResult> {
    const say = (message: string) => new NodeError(`${kind.label}: ${message}`);

    // A cache hit needs no time and no count, but only if the file it points at is still there.
    const found = await deps.cache.get(key);
    if (found && (await job.derived.recall(found.sha256))) {
      log({ step: kind.step, outcome: "reused" });
      return { sha256: found.sha256, size: found.size, trianglesBefore: found.trianglesBefore, trianglesAfter: found.trianglesAfter, reused: true };
    }

    const left = timeLeft(job.deadline, deps.now());
    if (left < MIN_START_MS) {
      log({ step: kind.step, outcome: "no-time" });
      throw say(RAN_OUT_OF_TIME);
    }

    // Counted before the call, so simultaneous requests cannot all slip under the limit.
    const day = dayOf(deps.now());
    const taken = await deps.limits.take(job.user.uid, day, { perPerson: deps.perPerson, total: deps.total });
    if (taken !== "ok") {
      log({ step: kind.step, outcome: taken });
      throw say(taken === "person-limit" ? `You have used today's ${deps.perPerson} Blender jobs. Try again tomorrow.` : "Blender is busy today. Try again tomorrow.");
    }
    // Giving a count back must never hide the sentence the person needs.
    const giveBack = async () => {
      try {
        await deps.limits.give(job.user.uid, day);
      } catch {
        // the count stays; the person still gets the plain sentence
      }
    };

    let made: MadeModel;
    try {
      made = await call(Math.min(CALL_TIMEOUT_MS, left));
    } catch (error) {
      if (error instanceof BlenderRefusedError) {
        log({ step: kind.step, outcome: "refused", code: error.code });
        if (kind.keepsCountOnRefusal) throw say(REFUSED[error.code]);
      } else if (error instanceof BlenderUnavailableError) {
        log({ step: kind.step, outcome: "unavailable", ...(error.status === undefined ? {} : { status: error.status }) });
      } else {
        log({ step: kind.step, outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
      }
      await giveBack();
      throw say(DID_NOT_ANSWER);
    }

    let sha256: string;
    try {
      sha256 = await job.derived.put(made.bytes);
    } catch (error) {
      log({ step: kind.step, outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
      await giveBack();
      throw say(DID_NOT_ANSWER);
    }

    const size = made.bytes.length;
    try {
      await deps.cache.put(key, { sha256, size, trianglesBefore: made.trianglesBefore, trianglesAfter: made.trianglesAfter, createdAt: deps.now() });
    } catch {
      log({ step: kind.step, outcome: "cache-write-failed" }); // the model is good and was paid for: give it, even if it cannot be remembered
    }
    log({ step: kind.step, outcome: "made", trianglesAfter: made.trianglesAfter, size });
    return { sha256, size, trianglesBefore: made.trianglesBefore, trianglesAfter: made.trianglesAfter, reused: false };
  }

  return {
    async prepare(job, input) {
      const key = await prepareKey({ graphId: job.graphId, inputSha: input.sha256, triangles: input.triangles, color: input.color });
      return run(PREPARE, key, job, (timeoutMs) =>
        deps.worker.prepare({ bytes: input.bytes, format: input.format, triangles: input.triangles, color: input.color, timeoutMs }),
      );
    },

    async shape(job, input) {
      const key = await shapeKey({ graphId: job.graphId, shape: input.shape, color: input.color });
      return run(SHAPE, key, job, (timeoutMs) => deps.worker.shape({ shape: input.shape, color: input.color, timeoutMs }));
    },
  };
}
