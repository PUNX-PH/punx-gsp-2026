import { describe, expect, it } from "vitest";
import { askForJson, type ClaudeClient } from "@/lib/ai/anthropic";
import { ScriptedDesigner } from "@/lib/ai/memory";
import { AiRefusedError, AiUnavailableError } from "@/lib/ai/types";

const SCHEMA = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" } } };
const CONTENT = [{ type: "text" as const, text: "make a thing" }];
const REQUEST = { model: "claude-sonnet-5-5", system: "You make things.", content: CONTENT, schema: SCHEMA, maxTokens: 8192, timeoutMs: 12_000 };

const message = (overrides: Record<string, unknown> = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ a: "yes" }) }],
  usage: { input_tokens: 1200, output_tokens: 90 },
  ...overrides,
});

/** A client that answers from a script and remembers every request it was sent. */
function stubClient(reply: () => unknown = () => message()) {
  const calls: { params: any; options: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const client = {
    beta: {
      messages: {
        async create(params: unknown, options: unknown) {
          calls.push({ params, options });
          return reply();
        },
      },
    },
  } as unknown as ClaudeClient;
  return { client, calls };
}

describe("askForJson: the request", () => {
  it("carries the given model, system, content, schema and token limit, and no tools", async () => {
    const { client, calls } = stubClient();
    await askForJson(client, REQUEST);

    const { params } = calls[0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.system).toBe("You make things.");
    expect(params.messages).toEqual([{ role: "user", content: CONTENT }]);
    expect(params.max_tokens).toBe(8192);
    expect("tools" in params).toBe(false);
    expect("tool_choice" in params).toBe(false);
  });

  it("asks for the schema's JSON at low effort with the server-side refusal fallback", async () => {
    const { client, calls } = stubClient();
    await askForJson(client, REQUEST);

    const { params } = calls[0];
    expect(params.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: SCHEMA } });
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
  });

  it("passes the timeout as the call option", async () => {
    const { client, calls } = stubClient();
    await askForJson(client, REQUEST);
    expect(calls[0].options).toEqual({ timeout: 12_000 });
  });
});

describe("askForJson: the answer", () => {
  it("is the JSON the model wrote, with the token counts", async () => {
    const { client } = stubClient();
    expect(await askForJson(client, REQUEST)).toEqual({ raw: { a: "yes" }, usage: { inputTokens: 1200, outputTokens: 90 } });
  });

  it("is undefined when the text is not JSON, there is no text, or the model ran out of room", async () => {
    for (const reply of [
      message({ content: [{ type: "text", text: "Sure! Here you go." }] }),
      message({ content: [{ type: "thinking", thinking: "" }] }),
      message({ content: [] }),
      message({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"a": "ye' }] }),
    ]) {
      const { client } = stubClient(() => reply);
      expect((await askForJson(client, REQUEST)).raw).toBeUndefined();
    }
  });

  it("counts missing token counts as zero", async () => {
    const { client } = stubClient(() => message({ usage: undefined }));
    expect((await askForJson(client, REQUEST)).usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("throws that it declined when the model refused", async () => {
    const { client } = stubClient(() => message({ stop_reason: "refusal", content: [] }));
    await expect(askForJson(client, REQUEST)).rejects.toBeInstanceOf(AiRefusedError);
  });
});

describe("askForJson: when the call fails", () => {
  it("says the model is not available with only the HTTP status, never the error's own message", async () => {
    const { client } = stubClient(() => {
      throw Object.assign(new Error("overloaded: sk-ant-secret and the prompt: make a thing"), { status: 529 });
    });
    const failure = await askForJson(client, REQUEST).then(() => null, (e: unknown) => e);
    expect(failure).toBeInstanceOf(AiUnavailableError);
    expect((failure as AiUnavailableError).status).toBe(529);
    expect(String((failure as Error).message)).not.toContain("sk-ant-secret");
    expect(String((failure as Error).message)).not.toContain("make a thing");
  });

  it("keeps no detail for any status but 400", async () => {
    const { client } = stubClient(() => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    });
    expect(((await askForJson(client, REQUEST).then(() => null, (e: unknown) => e)) as AiUnavailableError).detail).toBeUndefined();
  });

  it("keeps what a 400 says about the request, shortened, with keys and long secret-looking strings removed", async () => {
    const message = `output_config.format.schema: too many union types. key sk-ant-api03-abcdefghijkl Bearer abc.def ${"x".repeat(60)} ${"y ".repeat(300)}`;
    const { client } = stubClient(() => {
      throw Object.assign(new Error(message), { status: 400 });
    });
    const failure = (await askForJson(client, REQUEST).then(() => null, (e: unknown) => e)) as AiUnavailableError;
    expect(failure.status).toBe(400);
    expect(failure.detail).toContain("too many union types");
    expect(failure.detail).not.toContain("sk-ant");
    expect(failure.detail).not.toContain("abc.def");
    expect(failure.detail).not.toMatch(/x{40}/);
    expect(failure.detail!.length).toBeLessThanOrEqual(300);
    expect(String(failure.message)).toBe("The model is not available"); // the error's own message is still never the service's
  });

  it("has no status when the error carried none", async () => {
    const { client } = stubClient(() => {
      throw new Error("socket hang up");
    });
    const failure = await askForJson(client, REQUEST).then(() => null, (e: unknown) => e);
    expect(failure).toBeInstanceOf(AiUnavailableError);
    expect((failure as AiUnavailableError).status).toBeUndefined();
  });
});

describe("ScriptedDesigner", () => {
  const reply = (raw: unknown) => ({ raw, usage: { inputTokens: 10, outputTokens: 5 } });

  it("records every call in order and replies through the function given for that method", async () => {
    const designer = new ScriptedDesigner({
      designModel: async () => reply({ kind: "biped" }),
      designMotion: async () => reply({ motions: {} }),
      designEnvironment: async () => reply({ sky: 0 }),
    });

    const model = { description: "a fox", role: "hero" as const, kind: null, picture: null };
    const motion = { kind: "biped" as const, joints: ["hips"], texts: { run: "fast" } };
    const environment = { theme: "desert" };
    expect((await designer.designModel(model)).raw).toEqual({ kind: "biped" });
    expect((await designer.designMotion(motion)).raw).toEqual({ motions: {} });
    expect((await designer.designEnvironment(environment)).raw).toEqual({ sky: 0 });

    expect(designer.calls).toEqual([
      { method: "designModel", request: model },
      { method: "designMotion", request: motion },
      { method: "designEnvironment", request: environment },
    ]);
  });

  it("throws that the model is not available for a method it was given no script for, and still records the call", async () => {
    const designer = new ScriptedDesigner({ designModel: async () => reply({}) });
    await expect(designer.designMotion({ kind: "biped", joints: [], texts: {} })).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(designer.designEnvironment({ theme: "x" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(designer.calls.map((call) => call.method)).toEqual(["designMotion", "designEnvironment"]);
  });

  it("passes on what a scripted function throws", async () => {
    const designer = new ScriptedDesigner({
      designModel: async () => {
        throw new AiRefusedError();
      },
    });
    await expect(designer.designModel({ description: "x", role: "hero", kind: null, picture: null })).rejects.toBeInstanceOf(AiRefusedError);
  });
});
