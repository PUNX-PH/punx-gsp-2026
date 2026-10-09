import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/app/AppHeader";
import { ThemedShell } from "@/app/graphs/ThemedShell";
import styles from "@/app/shell.module.css";
import { currentUser } from "@/lib/auth/server";
import { readUsage } from "@/lib/expenses/firebase";
import { isOwner } from "@/lib/expenses/owner";
import { pricesFromEnv, summarize, type Totals } from "@/lib/expenses/summary";
import table from "./expenses.module.css";

const WINDOW_DAYS = 30;
const money = (cost: number | null) => (cost === null ? "-" : `$${cost.toFixed(cost < 10 ? 2 : 0)}`);
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

function Row({ name, t }: { name: string; t: Totals }) {
  return (
    <tr>
      <th scope="row">{name}</th>
      <td>{t.calls}</td>
      <td>{tokens(t.inputTokens)}</td>
      <td>{tokens(t.outputTokens)}</td>
      <td>{money(t.cost)}</td>
    </tr>
  );
}

function Head() {
  return (
    <thead>
      <tr>
        <th scope="col" />
        <th scope="col">Answers</th>
        <th scope="col">Tokens in</th>
        <th scope="col">Tokens out</th>
        <th scope="col">Cost</th>
      </tr>
    </thead>
  );
}

export default async function ExpensesPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!isOwner(user.email)) notFound();

  const now = Date.now();
  const prices = pricesFromEnv(process.env);
  const summary = summarize(await readUsage(now - WINDOW_DAYS * 86_400_000), prices, now, WINDOW_DAYS);

  return (
    <ThemedShell>
      <div className={styles.shell}>
        <AppHeader email={user.email} current="expenses" />
        <main className={styles.main}>
          <h1 className={styles.title}>Expenses</h1>
          <p className={styles.lede}>
            What the site&apos;s Claude answers used in the last {WINDOW_DAYS} days (days are UTC). It counts the answers that were stored, so a call that failed, or was thrown away, is not in it:
            the Anthropic Console has the exact bill.
          </p>
          {prices ? null : (
            <p className={styles.lede}>Costs show a dash until AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK (dollars per million tokens) are set in Vercel.</p>
          )}

          <table className={table.table}>
            <Head />
            <tbody>
              <Row name={`Last ${WINDOW_DAYS} days`} t={summary.total} />
            </tbody>
          </table>

          <h2 className={table.heading}>By day</h2>
          {summary.days.length === 0 ? (
            <div className={styles.empty}>
              <strong>Nothing yet</strong>
              <span>No answers were stored in this time.</span>
            </div>
          ) : (
            <table className={table.table}>
              <Head />
              <tbody>
                {summary.days.map((d) => (
                  <Row key={d.day} name={d.day} t={d} />
                ))}
              </tbody>
            </table>
          )}

          <h2 className={table.heading}>By what it was for</h2>
          <table className={table.table}>
            <Head />
            <tbody>
              {summary.kinds.map((k) => (
                <Row key={k.kind} name={k.kind} t={k} />
              ))}
            </tbody>
          </table>
        </main>
      </div>
    </ThemedShell>
  );
}
