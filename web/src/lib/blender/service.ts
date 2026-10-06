// The Blender service: the rules around the worker. It answers from the cache when it can, watches Play's clock, counts a new job
// against the daily limits before the call, asks the worker, keeps the GLB it gets in the graph's folder, remembers it, and says in
// plain words (as a NodeError) when it cannot. It knows nothing about Firestore, Cloud Run or Blender: those are the ports it is
// given, so every rule here is tested with fakes.
import { dayOf } from "@/lib/ai/key";
import type { UsageLimits } from "@/lib/ai/ports";
import { buildKey, prepareKey, shapeKey } from "@/lib/blender/key";
import type { CachedJob, JobCache } from "@/lib/blender/ports";
import {
  type BlenderJob,
  BlenderNotSetUpError,
  BlenderRefusedError,
  type BlenderService,
  type BlenderWorker,
  BlenderUnavailableError,
  type BuildLabel,
  type MadeResult,
} from "@/lib/blender/types";
import type { ClipName } from "@/lib/builder/kinds";
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
const NOT_SET_UP = "The Blender service is not set up on this site yet.";

// What a person is told when Blender ran and refused the file. (An uploaded file is at most 4 MB, so "too-big" is a guard.)
const REFUSED = {
  empty: "This file has no 3D shape in it.",
  "bad-format": "This file could not be read as a GLB, FBX or OBJ.",
  "too-big": "This file is larger than 32 MB.",
  timeout: "This model took longer than 60 seconds. Try a simpler one.",
  failed: "This file could not be prepared. Try another one.",
} as const;

interface Kind {
  step: "prepare-model" | "make-shape" | "build-model" | "build-environment";
  label: "Prepare Model" | "Make Shape" | BuildLabel;
  /** A refusal of a file used the worker's time, so it stays counted. Anything else Blender refuses is the service's fault and is given back. */
  keepsCountOnRefusal: boolean;
  /** What a refusal with this code says, or null for the plain "did not answer" (which is also what any other failure says). */
  refusal(code: BlenderRefusedError["code"]): string | null;
}
const PREPARE: Kind = {
  step: "prepare-model",
  label: "Prepare Model",
  keepsCountOnRefusal: true,
  refusal: (code) => (code === "bad-recipe" ? null : REFUSED[code]),
};
const SHAPE: Kind = { step: "make-shape", label: "Make Shape", keepsCountOnRefusal: false, refusal: () => null };
// A build has no file of the person's to blame: its words came from Claude or from defaults, so every refusal is given back, and only
// two of them say more than "did not answer".
const buildKind = (label: BuildLabel): Kind => ({
  step: label === "Build Model" ? "build-model" : "build-environment",
  label,
  keepsCountOnRefusal: false,
  refusal: (code) =>
    code === "bad-recipe"
      ? "The Blender service could not build this. Try different words."
      : code === "timeout"
        ? "This took longer than 60 seconds. Try a simpler one."
        : null,
});

/** What a worker call gives back, whichever job it was: a GLB and its counts (a build also has its parts and clips). */
interface Made {
  bytes: Uint8Array;
  trianglesBefore: number | null;
  trianglesAfter: number;
  parts?: number;
  clips?: ClipName[];
}

/** What is stored for a job and handed on. */
interface Stored {
  sha256: string;
  size: number;
  trianglesBefore: number | null;
  trianglesAfter: number;
  parts?: number;
  clips?: ClipName[];
  reused: boolean;
}

export function makeBlenderService(deps: BlenderDeps): BlenderService {
  const log = deps.log ?? (() => {});

  async function run(
    kind: Kind,
    key: string,
    job: BlenderJob,
    call: (timeoutMs: number) => Promise<Made>,
    /** Whether a cached record has everything this job needs from it (a build needs its parts and clips). */
    usable: (found: CachedJob) => boolean = () => true,
  ): Promise<Stored> {
    const say = (message: string) => new NodeError(`${kind.label}: ${message}`);

    // A cache hit needs no time and no count, but only if the file it points at is still there.
    const found = await deps.cache.get(key);
    if (found && usable(found) && (await job.derived.recall(found.sha256))) {
      log({ step: kind.step, outcome: "reused" });
      return {
        sha256: found.sha256,
        size: found.size,
        trianglesBefore: found.trianglesBefore,
        trianglesAfter: found.trianglesAfter,
        ...(found.parts === undefined ? {} : { parts: found.parts }),
        ...(found.clips === undefined ? {} : { clips: found.clips }),
        reused: true,
      };
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

    let made: Made;
    try {
      made = await call(Math.min(CALL_TIMEOUT_MS, left));
    } catch (error) {
      if (error instanceof BlenderRefusedError) {
        log({ step: kind.step, outcome: "refused", code: error.code });
        const sentence = kind.refusal(error.code);
        if (sentence !== null) {
          if (!kind.keepsCountOnRefusal) await giveBack();
          throw say(sentence);
        }
      } else if (error instanceof BlenderNotSetUpError) {
        // Retrying cannot help, so the person is told what it is. (Nothing in the error says more than that the address or key is missing.)
        log({ step: kind.step, outcome: "not-set-up" });
        await giveBack();
        throw say(NOT_SET_UP);
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
    const extra = { ...(made.parts === undefined ? {} : { parts: made.parts }), ...(made.clips === undefined ? {} : { clips: made.clips }) };
    try {
      await deps.cache.put(key, { sha256, size, trianglesBefore: made.trianglesBefore, trianglesAfter: made.trianglesAfter, ...extra, createdAt: deps.now() });
    } catch {
      log({ step: kind.step, outcome: "cache-write-failed" }); // the model is good and was paid for: give it, even if it cannot be remembered
    }
    log({ step: kind.step, outcome: "made", trianglesAfter: made.trianglesAfter, size });
    return { sha256, size, trianglesBefore: made.trianglesBefore, trianglesAfter: made.trianglesAfter, ...extra, reused: false };
  }

  // What prepare and shape hand on: the counts, with no parts or clips.
  const asMade = ({ sha256, size, trianglesBefore, trianglesAfter, reused }: Stored): MadeResult => ({ sha256, size, trianglesBefore, trianglesAfter, reused });

  return {
    async prepare(job, input) {
      const key = await prepareKey({ graphId: job.graphId, inputSha: input.sha256, triangles: input.triangles, color: input.color });
      return asMade(
        await run(PREPARE, key, job, (timeoutMs) =>
          deps.worker.prepare({ bytes: input.bytes, format: input.format, triangles: input.triangles, color: input.color, timeoutMs }),
        ),
      );
    },

    async shape(job, input) {
      const key = await shapeKey({ graphId: job.graphId, shape: input.shape, color: input.color });
      return asMade(await run(SHAPE, key, job, (timeoutMs) => deps.worker.shape({ shape: input.shape, color: input.color, timeoutMs })));
    },

    async build(job, input) {
      const key = await buildKey({ graphId: job.graphId, body: input.body });
      const done = await run(
        buildKind(input.label),
        key,
        job,
        async (timeoutMs) => {
          const built = await deps.worker.build({ body: input.body, timeoutMs });
          return { bytes: built.bytes, trianglesBefore: null, trianglesAfter: built.triangles, parts: built.parts, clips: built.clips };
        },
        (found) => found.parts !== undefined && found.clips !== undefined, // a record without them came from another kind of job: a miss
      );
      return { sha256: done.sha256, size: done.size, triangles: done.trianglesAfter, parts: done.parts ?? 0, clips: done.clips ?? [], reused: done.reused };
    },
  };
}
