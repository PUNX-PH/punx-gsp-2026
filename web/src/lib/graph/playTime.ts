// Play's clock. Play runs the steps one after another inside one request, which Vercel stops at the route's maxDuration, so Play
// sets a deadline and the slow steps (Blender, Describe Game) shape their calls to what is left: they never start a call that
// could not finish, and a call's own timeout is never longer than the time that remains. Finished steps are cached, so a second
// Play carries on from where the first one stopped.

/** Play's deadline, from its start. The route's limit is 300 s: the rest is the margin for decoding, storage and the response. */
export const PLAY_BUDGET_MS = 270_000;
/** A slow step that would start with less than this left fails at once instead. */
export const MIN_START_MS = 10_000;
/** The longest a call to the Blender worker may take: the worker's own limit and a margin, so its sentence arrives first. */
export const CALL_TIMEOUT_MS = 65_000;
/** The worker kills a Blender job at this age. */
export const WORKER_JOB_LIMIT_MS = 60_000;

/** What a step says (after its name and a colon) when it cannot start for lack of time. */
export const RAN_OUT_OF_TIME = "Play ran out of time. Press Play again; finished steps are kept, so it carries on.";

/** Milliseconds from `now` to `deadline`, never below zero. */
export const timeLeft = (deadline: number, now: number): number => Math.max(0, deadline - now);
