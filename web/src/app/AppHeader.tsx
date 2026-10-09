import Link from "next/link";
import styles from "@/app/shell.module.css";
import { isOwner } from "@/lib/expenses/owner";
import { SignOutButton } from "./SignOutButton";

/** The mark: three steps joined by two wires, in the colors the editor draws its own wires with. */
export function Mark() {
  return (
    <svg className={styles.mark} viewBox="0 0 30 20" aria-hidden="true">
      <path d="M5 14 C 12 14, 12 6, 17 6" fill="none" stroke="var(--wire-palette)" strokeWidth="2" strokeLinecap="round" />
      <path d="M17 6 C 22 6, 22 14, 26 14" fill="none" stroke="var(--wire-settings)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="5" cy="14" r="3.2" fill="var(--wire-image)" />
      <circle cx="17" cy="6" r="3.2" fill="var(--wire-palette)" />
      <circle cx="26" cy="14" r="3.2" fill="var(--accent)" />
    </svg>
  );
}

/** The bar every signed-in page of the site has: where you are, and who you are. */
export function AppHeader({ email, current }: { email: string; current: "games" | "runs" | "expenses" }) {
  return (
    <header className={styles.header}>
      <Link href="/graphs" className={styles.brand}>
        <Mark />
        Game Studio
      </Link>
      <nav className={styles.nav} aria-label="Main">
        <Link href="/graphs" aria-current={current === "games" ? "page" : undefined}>
          Games
        </Link>
        <Link href="/runs" aria-current={current === "runs" ? "page" : undefined}>
          Runs
        </Link>
        {isOwner(email) && (
          <Link href="/expenses" aria-current={current === "expenses" ? "page" : undefined}>
            Expenses
          </Link>
        )}
      </nav>
      <span className={styles.spacer} />
      <span className={styles.who}>{email}</span>
      <SignOutButton />
    </header>
  );
}
