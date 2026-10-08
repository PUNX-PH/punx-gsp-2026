// The playtest: three test players run the spec for a minute of game time, and the spec is rejected when it is clearly not a game. The
// reasons are sentences a person, or Claude on its one retry, can act on. Cap breaches are checkSpec's; the simulator's limits drop silently.
import { idleBot, randomBot, reactiveBot, type Bot } from "./bots";
import { createSim, type SimState } from "./sim";
import type { GameSpec } from "./spec";

export type PlaytestResult = { ok: true } | { ok: false; reason: string };

const MINUTE = 60 * 60;
const INSTANT = 30; // half a second
const THREE_SECONDS = 180;

function play(spec: GameSpec, bot: Bot): { state: SimState; endedAt: number } {
  const sim = createSim(spec);
  let state = sim.state();
  for (let i = 0; i < MINUTE && state.status === "running"; i++) {
    sim.step(bot.act(state));
    state = sim.state();
  }
  return { state, endedAt: state.step };
}

export function playtest(spec: GameSpec): PlaytestResult {
  const actions = spec.rules.flatMap((r) => r.do.map((a) => a.type));
  const canLose = Object.hasOwn(spec.counters, "lives") || actions.includes("lose") || (spec.ends.timeLimitMs > 0 && !spec.ends.winOnTime);
  const winsByTime = spec.ends.timeLimitMs > 0 && spec.ends.winOnTime;
  const canWin = winsByTime || spec.ends.scoreToWin > 0 || actions.includes("win");
  if (!canLose && !canWin) {
    return { ok: false, reason: "The game has no way to end: add a time limit, a score to win, lives, or a win or lose rule." };
  }

  const idle = play(spec, idleBot());
  if (idle.state.status === "lost" && idle.endedAt <= INSTANT) {
    return { ok: false, reason: "The player loses within half a second without doing anything: nothing may hit the hero at the start." };
  }

  const runs = [idle, play(spec, randomBot(spec.seed)), play(spec, reactiveBot(spec))];
  if (!runs.some((r) => r.state.status === "won" || r.state.status !== "lost" || r.endedAt > THREE_SECONDS)) {
    return { ok: false, reason: "Every test player loses within three seconds: make the hazards slower, fewer, or further apart." };
  }
  const winOnlyByScore = !winsByTime && !actions.includes("win");
  if (winOnlyByScore && !runs.some((r) => r.state.status === "won")) {
    return { ok: false, reason: "The game cannot be won: no test player reached the score to win in a minute. Lower the score to win or make pickups easier to get." };
  }
  return { ok: true };
}
