// A Google ID token for the Blender worker, from the invoker-only service account's key. The worker is a private Cloud Run service:
// it answers only a call that carries a token for its own address from an account allowed to invoke it. First exercised on the
// deployment.
import { GoogleAuth } from "google-auth-library";
import { BlenderUnavailableError } from "@/lib/blender/types";

/** `keyJson` is the service account's key as one line of JSON; `audience` is the worker's address. An unreadable key is "not available". */
export function makeIdTokenSource(keyJson: string, audience: string): () => Promise<string> {
  let credentials: unknown;
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    throw new BlenderUnavailableError(); // nothing of the key is kept in the error
  }
  const auth = new GoogleAuth({ credentials: credentials as { client_email: string; private_key: string } });
  return async () => {
    const client = await auth.getIdTokenClient(audience);
    return client.idTokenProvider.fetchIdToken(audience);
  };
}
