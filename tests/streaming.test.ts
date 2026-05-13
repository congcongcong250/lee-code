import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chatStream, parseSseBuffer } from "../src/llm";
import { Turn } from "../src/conversation";

/**
 * Streaming tests with mocked SSE response bodies.
 *
 * We construct a real ReadableStream<Uint8Array> that emits SSE frames,
 * then assert that:
 *   - chunks arrive at handlers.onText as they are produced
 *   - the assembled AssistantTurn has the right text + toolCalls at the end
 *   - schema mode parses the envelope after the stream finishes
 *   - tool_call argument deltas accumulated across chunks parse correctly
 *   - malformed chunks are tolerated (not crash)
 *   - stream split across read boundaries still parses (the canonical
 *     test for an SSE reader that handles partial buffers)
 */

const SCHEMA_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const NATIVE_MODEL = "minimax/minimax-m2.5:free";

function sseLines(lines: string[]): string {
  // SSE: each `data:` line, terminated by a blank line.
  return lines.map((l) => `data: ${l}\n\n`).join("");
}

function makeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function installFetchStreamMock(bodyChunks: string[]) {
  const fetchMock = vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      body: makeReadableStream(bodyChunks),
      text: async () => "",
    } as any;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("parseSseBuffer", () => {
  it("parses a complete single event", () => {
    const out = parseSseBuffer(`data: {"a":1}\n\n`);
    expect(out.events).toEqual([{ data: '{"a":1}' }]);
    expect(out.rest).toBe("");
  });

  it("parses multiple events", () => {
    const out = parseSseBuffer(`data: 1\n\ndata: 2\n\n`);
    expect(out.events.map((e) => e.data)).toEqual(["1", "2"]);
  });

  it("keeps an incomplete trailing event in `rest`", () => {
    const out = parseSseBuffer(`data: 1\n\ndata: 2`);
    expect(out.events.map((e) => e.data)).toEqual(["1"]);
    expect(out.rest).toBe("data: 2");
  });

  it("handles 'data:' with no space", () => {
    const out = parseSseBuffer(`data:foo\n\n`);
    expect(out.events[0].data).toBe("foo");
  });

  it("ignores non-data lines (event:, id:, retry:)", () => {
    const out = parseSseBuffer(`event: ping\ndata: keep\n\n`);
    expect(out.events).toHaveLength(1);
    expect(out.events[0].data).toBe("keep");
  });
});

describe("chatStream — native mode happy path", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("emits content chunks as they arrive and returns the assembled text", async () => {
    installFetchStreamMock([
      sseLines([
        JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
        JSON.stringify({ choices: [{ delta: { content: " there" } }] }),
        "[DONE]",
      ]),
    ]);
    const seen: string[] = [];
    const turn = await chatStream(
      [{ role: "user", text: "hi" }],
      { provider: "openrouter", model: NATIVE_MODEL, apiKey: "k" },
      { onText: (c) => seen.push(c) }
    );
    expect(seen).toEqual(["Hel", "lo", " there"]);
    expect(turn.text).toBe("Hello there");
    expect(turn.toolCalls).toBeUndefined();
  });

  it("accumulates tool_call argument deltas across chunks (regression: tool args are fragmented)", async () => {
    installFetchStreamMock([
      sseLines([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "searchFiles", arguments: '{"patte' } },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: 'rn":"**' } },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '/*.ts"}' } },
                ],
              },
            },
          ],
        }),
        "[DONE]",
      ]),
    ]);
    const turn = await chatStream(
      [{ role: "user", text: "search" }],
      { provider: "openrouter", model: NATIVE_MODEL, apiKey: "k" },
      { onText: () => {} }
    );
    expect(turn.toolCalls).toEqual([
      { id: "c1", name: "searchFiles", arguments: { pattern: "**/*.ts" } },
    ]);
  });

  it("preserves multiple parallel tool calls by index", async () => {
    installFetchStreamMock([
      sseLines([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "a", function: { name: "f", arguments: '{}' } },
                  { index: 1, id: "b", function: { name: "g", arguments: '{"k":1}' } },
                ],
              },
            },
          ],
        }),
        "[DONE]",
      ]),
    ]);
    const turn = await chatStream(
      [{ role: "user", text: "x" }],
      { provider: "openrouter", model: NATIVE_MODEL, apiKey: "k" },
      { onText: () => {} }
    );
    expect(turn.toolCalls).toHaveLength(2);
    expect(turn.toolCalls!.map((c) => c.id)).toEqual(["a", "b"]);
    expect(turn.toolCalls![1].arguments).toEqual({ k: 1 });
  });

  it("malformed tool args (after stream) become {} instead of crashing", async () => {
    installFetchStreamMock([
      sseLines([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "f", arguments: "{not valid" } },
                ],
              },
            },
          ],
        }),
        "[DONE]",
      ]),
    ]);
    const turn = await chatStream(
      [{ role: "user", text: "x" }],
      { provider: "openrouter", model: NATIVE_MODEL, apiKey: "k" },
      { onText: () => {} }
    );
    expect(turn.toolCalls![0].arguments).toEqual({});
  });
});

describe("chatStream — schema mode", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("streams envelope content through, then parses to AssistantTurn (no envelope in returned text)", async () => {
    const envelope = JSON.stringify({
      content: "Hello user",
      version: "1.0",
      tool_calls: [{ id: "c1", name: "readFile", arguments: { path: "a.ts" } }],
    });
    // Split envelope across multiple chunks so the test proves stream
    // reassembly works.
    const half = Math.floor(envelope.length / 2);
    const a = envelope.slice(0, half);
    const b = envelope.slice(half);
    installFetchStreamMock([
      sseLines([
        JSON.stringify({ choices: [{ delta: { content: a } }] }),
        JSON.stringify({ choices: [{ delta: { content: b } }] }),
        "[DONE]",
      ]),
    ]);
    const seen: string[] = [];
    const turn = await chatStream(
      [{ role: "user", text: "x" }],
      { provider: "openrouter", model: SCHEMA_MODEL, apiKey: "k" },
      { onText: (c) => seen.push(c) }
    );
    expect(seen.join("")).toBe(envelope);
    expect(turn.text).toBe("Hello user");
    expect(turn.text).not.toContain("version");
    expect(turn.toolCalls).toEqual([
      { id: "c1", name: "readFile", arguments: { path: "a.ts" } },
    ]);
  });
});

describe("chatStream — partial SSE frames across read boundaries", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("a frame split across chunks still parses", async () => {
    const fullFrame = `data: ${JSON.stringify({
      choices: [{ delta: { content: "ok" } }],
    })}\n\n`;
    // Split in the middle of "data: {...}\n\n" — the reader must keep the
    // remainder and parse it on the next chunk.
    const mid = Math.floor(fullFrame.length / 2);
    installFetchStreamMock([
      fullFrame.slice(0, mid),
      fullFrame.slice(mid) + "data: [DONE]\n\n",
    ]);
    const turn = await chatStream(
      [{ role: "user", text: "x" }],
      { provider: "openrouter", model: NATIVE_MODEL, apiKey: "k" },
      { onText: () => {} }
    );
    expect(turn.text).toBe("ok");
  });
});

describe("chatStream — malformed events tolerated", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("a single non-JSON event does not abort the stream", async () => {
    installFetchStreamMock([
      sseLines([
        "not json at all",
        JSON.stringify({ choices: [{ delta: { content: "after-error" } }] }),
        "[DONE]",
      ]),
    ]);
    const turn = await chatStream(
      [{ role: "user", text: "x" }],
      { provider: "openrouter", model: NATIVE_MODEL, apiKey: "k" },
      { onText: () => {} }
    );
    expect(turn.text).toBe("after-error");
  });
});

describe("chatStream — wire payload sets stream:true", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("the body sent to the server has stream:true", async () => {
    let capturedBody: any = null;
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        body: makeReadableStream([
          sseLines([JSON.stringify({ choices: [{ delta: { content: "" } }] }), "[DONE]"]),
        ]),
      } as any;
    });
    vi.stubGlobal("fetch", fetchMock);
    await chatStream(
      [{ role: "user", text: "x" }],
      { provider: "openrouter", model: NATIVE_MODEL, apiKey: "k" },
      { onText: () => {} }
    );
    expect(capturedBody.stream).toBe(true);
  });
});

describe("chatStream — unsupported provider rejects", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("ollama is rejected with a helpful error", async () => {
    await expect(
      chatStream(
        [{ role: "user", text: "x" }],
        { provider: "ollama", model: "llama3", apiKey: undefined },
        { onText: () => {} }
      )
    ).rejects.toThrow(/Streaming not implemented/);
  });
});
