import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chat, resolveMode } from "../src/llm";
import { Turn } from "../src/conversation";

/**
 * Wire-level tests for chat() / chatOpenAI.
 *
 * We mock `fetch` to capture the exact request body sent and to script the
 * upstream response. These tests prove the protocol-level contracts:
 *
 *  - schema mode payload: response_format set, tools NOT sent
 *  - native mode payload: tools set, response_format NOT sent
 *  - schema mode return: parsed prose content (not raw JSON envelope) +
 *    extracted tool_calls
 *  - native mode return: tool_calls parsed safely (malformed JSON args
 *    do not crash; they become empty {})
 *  - missing api key throws BEFORE hitting fetch
 */

const SCHEMA_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const NATIVE_MODEL = "minimax/minimax-m2.5:free";

interface CapturedRequest {
  url: string;
  body: any;
  headers: Record<string, string>;
}

function installFetchMock(scriptedResponse: any) {
  const captured: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init: any) => {
    captured.push({
      url: url.toString(),
      body: JSON.parse(init.body),
      headers: init.headers,
    });
    return {
      ok: true,
      status: 200,
      json: async () => scriptedResponse,
      text: async () => JSON.stringify(scriptedResponse),
    } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
  return captured;
}

describe("resolveMode", () => {
  it("returns 'schema' for known schema models", () => {
    expect(resolveMode(SCHEMA_MODEL)).toBe("schema");
    expect(resolveMode("qwen/qwen3-next-80b-a3b-instruct:free")).toBe("schema");
  });

  it("defaults to 'native' for unknown / non-schema models", () => {
    expect(resolveMode(NATIVE_MODEL)).toBe("native");
    expect(resolveMode("gpt-4o-mini")).toBe("native");
  });

  it("respects an explicit override", () => {
    expect(resolveMode(NATIVE_MODEL, "schema")).toBe("schema");
    expect(resolveMode(SCHEMA_MODEL, "text-fuzzy")).toBe("text-fuzzy");
  });
});

describe("chatOpenAI — schema mode payload", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("sends response_format and does NOT send tools (regression: schema/native collision)", async () => {
    const captured = installFetchMock({
      choices: [
        {
          message: {
            content: JSON.stringify({ content: "hi", version: "1.0" }),
          },
        },
      ],
    });
    const turns: Turn[] = [
      { role: "system", text: "sys" },
      { role: "user", text: "hi" },
    ];
    await chat(turns, {
      provider: "openrouter",
      model: SCHEMA_MODEL,
      apiKey: "k",
      tools: [{ name: "x", description: "x", parameters: { type: "object", properties: {} } }],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].body.response_format).toBeDefined();
    expect(captured[0].body.response_format.type).toBe("json_schema");
    expect(captured[0].body.tools).toBeUndefined();
    expect(captured[0].body.tool_choice).toBeUndefined();
  });

  it("attaches OpenRouter referer headers when calling openrouter.ai", async () => {
    const captured = installFetchMock({
      choices: [{ message: { content: JSON.stringify({ content: "", version: "1.0" }) } }],
    });
    await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: SCHEMA_MODEL,
      apiKey: "k",
    });
    expect(captured[0].headers["HTTP-Referer"]).toBe("https://lee-code.local");
    expect(captured[0].headers["X-Title"]).toBe("lee-code");
  });
});

describe("chatOpenAI — schema mode response parsing", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("returns parsed prose, NOT the raw JSON envelope (regression: envelope-in-history)", async () => {
    installFetchMock({
      choices: [
        {
          message: {
            content: JSON.stringify({
              content: "Found 3 files",
              version: "1.0",
              tool_calls: [{ id: "c1", name: "searchFiles", arguments: { pattern: "*" } }],
            }),
          },
        },
      ],
    });
    const turn = await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: SCHEMA_MODEL,
      apiKey: "k",
    });
    expect(turn.text).toBe("Found 3 files");
    expect(turn.text).not.toContain("version");
    expect(turn.text).not.toContain("tool_calls");
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls![0]).toEqual({
      id: "c1",
      name: "searchFiles",
      arguments: { pattern: "*" },
    });
  });

  it("schema response with empty content + tool_calls → empty text + toolCalls", async () => {
    installFetchMock({
      choices: [
        {
          message: {
            content: JSON.stringify({
              content: "",
              version: "1.0",
              tool_calls: [{ id: "c1", name: "readFile", arguments: { path: "a.ts" } }],
            }),
          },
        },
      ],
    });
    const turn = await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: SCHEMA_MODEL,
      apiKey: "k",
    });
    expect(turn.text).toBe("");
    expect(turn.toolCalls).toHaveLength(1);
  });

  it("schema model returning non-envelope text surfaces it as prose (graceful degradation)", async () => {
    installFetchMock({
      choices: [{ message: { content: "I am not JSON." } }],
    });
    const turn = await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: SCHEMA_MODEL,
      apiKey: "k",
    });
    expect(turn.text).toBe("I am not JSON.");
    expect(turn.toolCalls).toBeUndefined();
  });
});

describe("chatOpenAI — native mode payload", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("sends tools + tool_choice and does NOT send response_format", async () => {
    const captured = installFetchMock({
      choices: [{ message: { content: "hi" } }],
    });
    await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: NATIVE_MODEL,
      apiKey: "k",
      tools: [
        {
          name: "searchFiles",
          description: "find",
          parameters: { type: "object", properties: { pattern: { type: "string" } } },
        },
      ],
    });
    expect(captured[0].body.tools).toBeDefined();
    expect(captured[0].body.tools).toHaveLength(1);
    expect(captured[0].body.tool_choice).toBe("auto");
    expect(captured[0].body.response_format).toBeUndefined();
  });
});

describe("chatOpenAI — native mode response parsing", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("parses tool_calls from the structured field", async () => {
    installFetchMock({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_99",
                function: {
                  name: "searchFiles",
                  arguments: JSON.stringify({ pattern: "**/*.ts" }),
                },
              },
            ],
          },
        },
      ],
    });
    const turn = await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: NATIVE_MODEL,
      apiKey: "k",
    });
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls![0]).toEqual({
      id: "call_99",
      name: "searchFiles",
      arguments: { pattern: "**/*.ts" },
    });
  });

  it("malformed tool_call arguments JSON does NOT crash; arguments become {} (regression: B5)", async () => {
    installFetchMock({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                function: { name: "x", arguments: "{not valid json" },
              },
            ],
          },
        },
      ],
    });
    const turn = await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: NATIVE_MODEL,
      apiKey: "k",
    });
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls![0].arguments).toEqual({});
  });

  it("tool_call already-object arguments (e.g. Ollama-shaped) are kept verbatim", async () => {
    installFetchMock({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                function: { name: "x", arguments: { key: "val" } },
              },
            ],
          },
        },
      ],
    });
    const turn = await chat([{ role: "user", text: "x" }], {
      provider: "openrouter",
      model: NATIVE_MODEL,
      apiKey: "k",
    });
    expect(turn.toolCalls![0].arguments).toEqual({ key: "val" });
  });
});

describe("chatOpenAI — wire payload uses the right serializer", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("native mode sends assistant.tool_calls and tool messages with tool_call_id", async () => {
    const captured = installFetchMock({
      choices: [{ message: { content: "ok" } }],
    });
    const turns: Turn[] = [
      { role: "user", text: "q" },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "c1", name: "f", arguments: {} }],
      },
      { role: "tool", callId: "c1", name: "f", text: "r1" },
    ];
    await chat(turns, {
      provider: "openrouter",
      model: NATIVE_MODEL,
      apiKey: "k",
    });
    const msgs = captured[0].body.messages;
    expect(msgs[1].tool_calls).toBeDefined();
    expect(msgs[1].tool_calls[0].id).toBe("c1");
    expect(msgs[2].role).toBe("tool");
    expect(msgs[2].tool_call_id).toBe("c1");
  });

  it("schema mode never sends a tool role over the wire", async () => {
    const captured = installFetchMock({
      choices: [{ message: { content: JSON.stringify({ content: "ok", version: "1.0" }) } }],
    });
    const turns: Turn[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "calling" },
      { role: "tool", callId: "c1", name: "f", text: "r1" },
    ];
    await chat(turns, {
      provider: "openrouter",
      model: SCHEMA_MODEL,
      apiKey: "k",
    });
    const msgs = captured[0].body.messages;
    expect(msgs.every((m: any) => m.role !== "tool")).toBe(true);
    const labeled = msgs.find((m: any) => m.role === "user" && m.content.startsWith("[tool_result"));
    expect(labeled).toBeDefined();
  });
});

describe("chatOpenAI — auth", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("throws if no api key is provided (and never hits fetch)", async () => {
    // Make sure we don't accidentally pick up an env var.
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      chat([{ role: "user", text: "x" }], { provider: "openrouter", model: NATIVE_MODEL })
    ).rejects.toThrow(/API key required/);
    expect(fetchMock).not.toHaveBeenCalled();
    if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
  });
});

describe("chat() dispatch", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("anthropic provider is explicitly out-of-scope (helpful error, not silent failure)", async () => {
    await expect(
      chat([{ role: "user", text: "x" }], {
        provider: "anthropic",
        model: "claude-3-haiku-20240307",
        apiKey: "k",
      })
    ).rejects.toThrow(/anthropic provider not implemented/);
  });

  it("huggingface provider is explicitly out-of-scope", async () => {
    await expect(
      chat([{ role: "user", text: "x" }], {
        provider: "huggingface",
        model: "x",
        apiKey: "k",
      })
    ).rejects.toThrow(/huggingface provider not implemented/);
  });
});
