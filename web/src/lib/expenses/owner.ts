// Who may see the site's costs: the emails listed in OWNER_EMAILS (comma separated, any case). Unset or empty means nobody, so a missing setting hides the page.
export function isOwner(email: string, env: Record<string, string | undefined> = process.env): boolean {
  const owners = (env.OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "");
  return owners.includes(email.trim().toLowerCase());
}
