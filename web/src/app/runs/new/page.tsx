import { redirect } from "next/navigation";
import { AppHeader } from "@/app/AppHeader";
import styles from "@/app/shell.module.css";
import { ThemedShell } from "@/app/graphs/ThemedShell";
import { currentUser } from "@/lib/auth/server";
import { UploadForm } from "./UploadForm";

export default async function NewRunPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return (
    <ThemedShell>
      <div className={styles.shell}>
        <AppHeader email={user.email} current="runs" />
        <UploadForm />
      </div>
    </ThemedShell>
  );
}
