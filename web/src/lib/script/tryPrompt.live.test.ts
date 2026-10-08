// A LIVE check of the prompt: five unlike game descriptions go to Claude through the real author, and each answer is checked with checkScript. It spends the
// studio's API credit (a few cents), so it does nothing unless LIVE_PROMPT=1:
//   LIVE_PROMPT=1 npx vitest run src/lib/script/tryPrompt.live.test.ts
// The key is read from ANTHROPIC_API_KEY in the environment or from web/.env.local (git-ignored) and is never printed. The scripts are written to web/.live-scripts/
// (git-ignored) for the Unity test LiveScriptsTests, which plays each one with random input and reports any error.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, it } from "vitest";
import type { ClaudeClient } from "@/lib/ai/anthropic";
import { makeClaudeScriptAuthor } from "./author";
import { checkScript } from "./check";

const GAMES = [
  { slug: "cat-runner", words: "A 3D endless runner where a cat dodges cars on a busy city street. Tap the left or right side to change lane." },
  { slug: "asteroids", words: "A space shooter: I drag my ship around and it shoots asteroids that split into smaller ones. Don't get hit." },
  { slug: "robot-islands", words: "A platformer where a little robot collects batteries across floating islands. Hold to walk, tap to jump." },
  { slug: "neon-breaker", words: "Brick breaker with neon colors, where some bricks drop power-ups that make the paddle wider." },
  { slug: "fishing", words: "A cozy fishing game: tap to cast, then tap again exactly when the bobber dips to hook the fish. Catch five fish to win." },
];

function apiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const line = readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    return line?.slice("ANTHROPIC_API_KEY=".length).trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

describe.skipIf(!process.env.LIVE_PROMPT)("the live prompt check", () => {
  it("asks Claude for five unlike games and checks each script", { timeout: 600_000 }, async () => {
    const key = apiKey();
    if (!key) throw new Error("No ANTHROPIC_API_KEY in the environment or in web/.env.local");
    const client = new Anthropic({ apiKey: key, maxRetries: 1 }) as unknown as ClaudeClient;
    const author = makeClaudeScriptAuthor({ client, model: process.env.AI_MODEL?.trim() || "claude-sonnet-5-5", timeoutMs: 240_000 });
    const out = join(process.cwd(), ".live-scripts");
    mkdirSync(out, { recursive: true });

    let passed = 0;
    for (const [i, game] of GAMES.entries()) {
      const started = Date.now();
      let line: string;
      try {
        const reply = await author.author({ description: game.words, picture: null, models: [] });
        const raw = reply.raw as { script?: unknown; palette?: unknown; leftOut?: unknown; assets?: unknown };
        const script = typeof raw.script === "string" ? raw.script : "";
        const checked = checkScript(script);
        const name = `${String(i + 1).padStart(2, "0")}-${game.slug}`;
        writeFileSync(join(out, `${name}.lua`), script);
        writeFileSync(join(out, `${name}.json`), JSON.stringify({ palette: raw.palette, leftOut: raw.leftOut, assets: raw.assets }, null, 2));
        if (checked.ok) passed++;
        line = `${game.slug}: ${checked.ok ? "PASS" : "FAIL " + checked.reason} | ${script.split("\n").length} lines | ${reply.usage.inputTokens} in, ${reply.usage.outputTokens} out | ${Math.round((Date.now() - started) / 1000)} s | left out: ${String(raw.leftOut ?? "").slice(0, 120)}`;
      } catch (error) {
        line = `${game.slug}: ERROR ${error instanceof Error ? error.name : typeof error}`; // never the message: it could quote a request
      }
      process.stdout.write(`LIVE ${line}\n`);
    }
    process.stdout.write(`LIVE ${passed} of ${GAMES.length} passed the script check on the first attempt\n`);
  });
});
