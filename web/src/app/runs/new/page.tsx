import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { UploadForm } from "./UploadForm";

export default async function NewRunPage() {
  if (!(await currentUser())) redirect("/sign-in");
  return <UploadForm />;
}
