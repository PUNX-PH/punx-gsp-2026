// The packager as the web app sees it: one POST to the private Cloud Run service (see packager/server.mjs), with a Google ID token. The files go as
// base64 in a JSON body; the packed file comes back as the body. Everything that comes back is untrusted: a refusal is only ever one of the
// packager's codes on the status that code comes with, and anything else is just "did not answer" (plus the HTTP status).
import { type PackedGame, type Packager, PackagerRefusedError, PackagerUnavailableError, type Platform } from "@/lib/export/types";

export interface PackagerClientDeps {
  /** The packager's address, for example https://packager-xxxx.a.run.app (a slash at the end is fine). */
  baseUrl: string;
  /** A Google ID token for that address, from the invoker-only service account. */
  getIdToken: () => Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const REFUSALS = { "bad-request": 400, "too-big": 413, "bad-files": 422, "not-set-up": 503, failed: 500 } as const;
type Code = keyof typeof REFUSALS;
const isCode = (value: unknown): value is Code => typeof value === "string" && Object.hasOwn(REFUSALS, value);

const KINDS: Record<Platform, { type: string; fileName: string }> = {
  windows: { type: "application/zip", fileName: "game-windows.zip" },
  android: { type: "application/vnd.android.package-archive", fileName: "game-android.apk" },
};
const ZIP_MAGIC = [0x50, 0x4b];
const MAX_PACKED_BYTES = 200 * 1024 * 1024;

export function makePackager(deps: PackagerClientDeps): Packager {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const doFetch = deps.fetch ?? fetch;
  return {
    async pack(platform, files) {
      let response: Response;
      let bytes: Uint8Array;
      try {
        const token = await deps.getIdToken();
        response = await doFetch(`${base}/package?platform=${platform}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ files: files.map((f) => ({ name: f.name, data: Buffer.from(f.bytes).toString("base64") })) }),
          signal: AbortSignal.timeout(deps.timeoutMs ?? 90_000),
        });
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new PackagerUnavailableError(); // nothing the error says is kept: it could quote the address or the token
      }
      if (response.status === 200) {
        const kind = KINDS[platform];
        const good = response.headers.get("content-type") === kind.type && bytes.length > 22 && bytes.length <= MAX_PACKED_BYTES && ZIP_MAGIC.every((b, i) => bytes[i] === b);
        if (!good) throw new PackagerUnavailableError(200);
        return { bytes, fileName: kind.fileName, contentType: kind.type } satisfies PackedGame;
      }
      let code: unknown;
      try {
        code = (JSON.parse(new TextDecoder().decode(bytes)) as { code?: unknown }).code;
      } catch {
        code = undefined;
      }
      if (isCode(code) && REFUSALS[code] === response.status) throw new PackagerRefusedError(code);
      throw new PackagerUnavailableError(response.status);
    },
  };
}
