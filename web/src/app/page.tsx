import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";

// Home is the list of games; the runs have a page of their own.
export default async function Home() {
  const user = await currentUser();
  redirect(user ? "/graphs" : "/sign-in");
}
