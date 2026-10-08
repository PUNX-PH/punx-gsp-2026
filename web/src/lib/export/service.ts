// The export service: what may be exported, how often, and what the person is told. Only a made game (settings with a `game` or a `script`) can be: the runner
// has no spec and no packaged player. The game's files are read from its stored run, so what is packed is exactly what Preview plays. One count of
// the person's daily exports is taken before the call and given back when no file came out. Packager and stores are ports, so every rule here is tested
// with fakes.
import { dayOf } from "@/lib/ai/key";
import type { UsageLimits } from "@/lib/ai/ports";
import { ExportError, type ExportService, type Packager, PackagerNotSetUpError, PackagerRefusedError, PackagerUnavailableError, PLATFORM_NAMES } from "@/lib/export/types";
import { RunError, type RunService } from "@/lib/runs/types";
import { filesNeeded, validateSettings } from "@/lib/settings";

export interface ExportDeps {
  runs: Pick<RunService, "readFile">;
  packager: Packager;
  limits: UsageLimits;
  perPerson: number;
  total: number;
  now: () => number;
  /** Outcomes only: the platform, the outcome and counts, never a file or the person's words. */
  log?: (info: object) => void;
}

export function makeExportService(deps: ExportDeps): ExportService {
  const log = deps.log ?? (() => {});
  return {
    async exportGame(user, runId, platform) {
      const read = async (name: string) => {
        try {
          return (await deps.runs.readFile(user, runId, name)).bytes;
        } catch (error) {
          if (error instanceof RunError) throw new ExportError(404, "Your game is no longer stored. Press Play to make it again.");
          throw error;
        }
      };
      const settingsBytes = await read("settings.json");
      const checked = validateSettings(new TextDecoder().decode(settingsBytes));
      if (!checked.ok || !(checked.settings.game || checked.settings.script)) {
        throw new ExportError(409, "Only a game made with Describe Game can be built for a computer or a phone. Turn on Make a game, then press Play.");
      }
      const files = [{ name: "settings.json", bytes: settingsBytes }];
      for (const name of filesNeeded(checked.settings)) files.push({ name, bytes: await read(name) });

      const day = dayOf(deps.now());
      const taken = await deps.limits.take(user.uid, day, { perPerson: deps.perPerson, total: deps.total });
      if (taken !== "ok") {
        log({ step: "export", platform, outcome: taken });
        throw new ExportError(429, taken === "person-limit" ? "You have used today's downloads. Try again tomorrow." : "Downloads are busy today. Try again tomorrow.");
      }
      try {
        const packed = await deps.packager.pack(platform, files);
        log({ step: "export", platform, outcome: "packed", files: files.length, size: packed.bytes.length });
        return packed;
      } catch (error) {
        await deps.limits.give(user.uid, day);
        if (error instanceof PackagerNotSetUpError || (error instanceof PackagerRefusedError && error.code === "not-set-up")) {
          log({ step: "export", platform, outcome: "not-set-up" });
          throw new ExportError(503, `Building for ${PLATFORM_NAMES[platform]} is not set up on this site yet.`);
        }
        if (error instanceof PackagerRefusedError) log({ step: "export", platform, outcome: "refused", code: error.code });
        else if (error instanceof PackagerUnavailableError) log({ step: "export", platform, outcome: "unavailable", ...(error.status === undefined ? {} : { status: error.status }) });
        else log({ step: "export", platform, outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
        throw new ExportError(503, "The packaging service did not answer. Try again.");
      }
    },
  };
}
