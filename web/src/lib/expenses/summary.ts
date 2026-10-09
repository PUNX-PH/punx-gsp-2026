// What the site's Claude calls cost, worked out from the answers it stored (each keeps its model, time and token counts). Pure: the page and the tests give it records.
// Only answers that were stored are counted: a call that failed, or whose answer was thrown away, left no record and is not in these numbers.

export interface UsageRecord {
  /** What the call was for: one of the names in KINDS. */
  kind: string;
  /** Milliseconds since the epoch. */
  at: number;
  inputTokens: number;
  outputTokens: number;
}

/** Dollars for a million tokens, in and out. */
export interface Prices {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface Totals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Dollars, or null when no prices are set. */
  cost: number | null;
}

export interface DayRow extends Totals {
  day: string; // YYYY-MM-DD, UTC
}

export interface KindRow extends Totals {
  kind: string;
}

export interface Summary {
  days: DayRow[]; // newest first, only days with calls
  kinds: KindRow[]; // dearest first
  total: Totals;
}

const DAY_MS = 86_400_000;

/** The prices from the environment, or null unless both are set to numbers. The studio sets its own rates: they are not guessed here. */
export function pricesFromEnv(env: Record<string, string | undefined>): Prices | null {
  const inputPerMillion = Number(env.AI_PRICE_INPUT_PER_MTOK);
  const outputPerMillion = Number(env.AI_PRICE_OUTPUT_PER_MTOK);
  if (!env.AI_PRICE_INPUT_PER_MTOK?.trim() || !env.AI_PRICE_OUTPUT_PER_MTOK?.trim()) return null;
  if (!Number.isFinite(inputPerMillion) || !Number.isFinite(outputPerMillion) || inputPerMillion < 0 || outputPerMillion < 0) return null;
  return { inputPerMillion, outputPerMillion };
}

export function costOf(inputTokens: number, outputTokens: number, prices: Prices | null): number | null {
  if (!prices) return null;
  return (inputTokens / 1_000_000) * prices.inputPerMillion + (outputTokens / 1_000_000) * prices.outputPerMillion;
}

const empty = (): Omit<Totals, "cost"> => ({ calls: 0, inputTokens: 0, outputTokens: 0 });

function bucket(map: Map<string, Omit<Totals, "cost">>, key: string): Omit<Totals, "cost"> {
  let found = map.get(key);
  if (!found) map.set(key, (found = empty()));
  return found;
}

/** The records of the last `windowDays` days (ending at `now`), added up by day and by kind. */
export function summarize(records: readonly UsageRecord[], prices: Prices | null, now: number, windowDays = 30): Summary {
  const since = now - windowDays * DAY_MS;
  const byDay = new Map<string, Omit<Totals, "cost">>();
  const byKind = new Map<string, Omit<Totals, "cost">>();
  const all = empty();
  for (const r of records) {
    if (!(r.at >= since) || !Number.isFinite(r.inputTokens) || !Number.isFinite(r.outputTokens)) continue;
    for (const t of [bucket(byDay, new Date(r.at).toISOString().slice(0, 10)), bucket(byKind, r.kind), all]) {
      t.calls += 1;
      t.inputTokens += r.inputTokens;
      t.outputTokens += r.outputTokens;
    }
  }
  const withCost = <T extends Omit<Totals, "cost">>(row: T): T & { cost: number | null } => ({ ...row, cost: costOf(row.inputTokens, row.outputTokens, prices) });
  const days = [...byDay].map(([day, t]) => ({ day, ...withCost(t) })).sort((a, b) => (a.day < b.day ? 1 : -1));
  const kinds = [...byKind].map(([kind, t]) => ({ kind, ...withCost(t) })).sort((a, b) => b.outputTokens + b.inputTokens - (a.outputTokens + a.inputTokens));
  return { days, kinds, total: withCost(all) };
}
