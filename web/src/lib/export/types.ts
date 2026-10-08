// The vocabulary of export: a finished engine game packed into something a person can install. The packager (packager/server.mjs) is behind the
// `Packager` port; the rules (what may be exported, the daily count, the sentences) are in service.ts and are tested with fakes.

import type { User } from "@/lib/auth/ports";

export const PLATFORMS = ["windows", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_NAMES: Record<Platform, string> = { windows: "a computer (Windows)", android: "an Android phone" };

export interface PackedGame {
  bytes: Uint8Array;
  /** game-windows.zip or game-android.apk. */
  fileName: string;
  contentType: string;
}

export interface Packager {
  pack(platform: Platform, files: { name: string; bytes: Uint8Array }[]): Promise<PackedGame>;
}

/** The packager is not configured on this site (no address or key). */
export class PackagerNotSetUpError extends Error {
  constructor() {
    super("the packager is not set up");
    this.name = "PackagerNotSetUpError";
  }
}

/** The packager did not give a usable answer (down, slow, or something that is not it). Only the HTTP status survives. */
export class PackagerUnavailableError extends Error {
  constructor(readonly status?: number) {
    super("the packager did not answer");
    this.name = "PackagerUnavailableError";
  }
}

/** The packager ran and said no, with one of its codes (bad-files, too-big, not-set-up, failed). */
export class PackagerRefusedError extends Error {
  constructor(readonly code: string) {
    super(`the packager refused: ${code}`);
    this.name = "PackagerRefusedError";
  }
}

/** A failure with a sentence for the person and the status it goes out with. */
export class ExportError extends Error {
  constructor(
    readonly status: 404 | 409 | 429 | 503,
    message: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

export interface ExportService {
  /** Packs the game stored as run `runId` (an engine game: settings with a `game`) for a platform. */
  exportGame(user: User, runId: string, platform: Platform): Promise<PackedGame>;
}
