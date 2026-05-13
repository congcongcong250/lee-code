import { describe, it, expect, beforeEach } from "vitest";
import { getLLMResponse } from "../src/agent";
import { Turn, AssistantTurn } from "../src/conversation";
import { registerTool, clearTools, ToolCall } from "../src/tools";

/**
 * These tests prove the agent loop's contract:
 *  - The full Turn[] delta is returned (user + assistant + intermediate tool
 *    turns), not just the final assistant text. Multi-turn memory depends on
 *    this.
 *  - Each tool round-trip preserves callId so native-mode requests round-trip
 *    safely.
 *  - Schema-mode loop still works (mode is decided per-call by resolveMode).
 *  - A throwing tool is caught locally — the loop does not crash.
 *  - Unknown tools are surfaced as a tool-turn (not a user message), keeping
 *    the conversation shape coherent.
 *  - MAX_ITERATIONS terminates infinite tool loops.
 *
 * We inject a fake `chat()` to drive the loop deterministically — no network.
 */

const NULL_HOOKS = {
  onAssistantText: () => {},
  onToolCall: () => {},
  onToolResult: () => {},
  onError: () => {},
};

function makeFakeChat(scripted: AssistantTurn[]) {
  let i = 0;
  const calls: Turn[][] = [];
  const fake = async (turns: Turn[]): Promise<AssistantTurn> => {
    calls.push(turns.map((t) => ({ ...t })));
    const next = scripted[i] ?? { role: "assistant", text: "(no more scripted)" };
    i += 1;
    return next;
  };
  return { fake, getCalls: () => calls, callCount: () => i };
}

describe("agent loop — single-shot (no tools)", () => {
  beforeEach(() => clearTools());

  it("returns user + assistant turns and the response text", async () => {
    const { fake } = makeFakeChat([{ role: "assistant", text: "hello!" }]);
    const result = await getLLMResponse("hi", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    expect(result.response).toBe("hello!");
    expect(result.newTurns).toHaveLength(2);
    expect(result.newTurns[0]).toEqual({ role: "user", text: "hi" });
    expect(result.newTurns[1]).toEqual({ role: "assistant", text: "hello!" });
  });

  it("system prompt + prior history are passed to chat()", async () => {
    const { fake, getCalls } = makeFakeChat([{ role: "assistant", text: "ok" }]);
    const prior: Turn[] = [
      { role: "user", text: "earlier" },
      { role: "assistant", text: "earlier-reply" },
    ];
    await getLLMResponse("now", prior, {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "SYS",
      chat: fake,
      ...NULL_HOOKS,
    });
    const firstCall = getCalls()[0];
    expect(firstCall[0]).toEqual({ role: "system", text: "SYS" });
    expect(firstCall[1]).toEqual({ role: "user", text: "earlier" });
    expect(firstCall[2]).toEqual({ role: "assistant", text: "earlier-reply" });
    expect(firstCall[3]).toEqual({ role: "user", text: "now" });
  });
});

describe("agent loop — tool round-trip preserves history", () => {
  beforeEach(() => clearTools());

  it("records tool calls AND tool results into newTurns (regression: lost-history bug)", async () => {
    registerTool("searchFiles", async () => ({ success: true, result: '["a.ts"]' }));

    const tc: ToolCall = { id: "call_xyz", name: "searchFiles", arguments: { pattern: "*.ts" } };
    const { fake } = makeFakeChat([
      { role: "assistant", text: "searching", toolCalls: [tc] },
      { role: "assistant", text: "Found a.ts" },
    ]);

    const result = await getLLMResponse("list ts", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });

    // user, assistant(with toolCalls), tool(result), assistant(final)
    expect(result.newTurns).toHaveLength(4);
    expect(result.newTurns[0].role).toBe("user");
    expect(result.newTurns[1].role).toBe("assistant");
    expect((result.newTurns[1] as AssistantTurn).toolCalls).toEqual([tc]);
    expect(result.newTurns[2]).toEqual({
      role: "tool",
      callId: "call_xyz",
      name: "searchFiles",
      text: '["a.ts"]',
    });
    expect(result.newTurns[3]).toEqual({ role: "assistant", text: "Found a.ts" });
    expect(result.response).toBe("Found a.ts");
  });

  it("second iteration receives the prior tool turn (regression: model couldn't see its own results)", async () => {
    registerTool("searchFiles", async () => ({ success: true, result: '["x"]' }));
    const { fake, getCalls } = makeFakeChat([
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "c1", name: "searchFiles", arguments: {} }],
      },
      { role: "assistant", text: "done" },
    ]);
    await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    const secondCall = getCalls()[1];
    const toolTurn = secondCall.find((t) => t.role === "tool");
    expect(toolTurn).toBeDefined();
    expect(toolTurn).toEqual({
      role: "tool",
      callId: "c1",
      name: "searchFiles",
      text: '["x"]',
    });
  });

  it("multiple tool calls in one assistant turn each get their own tool turn (parallel ids preserved)", async () => {
    registerTool("a", async () => ({ success: true, result: "ra" }));
    registerTool("b", async () => ({ success: true, result: "rb" }));
    const { fake } = makeFakeChat([
      {
        role: "assistant",
        text: "",
        toolCalls: [
          { id: "id-a", name: "a", arguments: {} },
          { id: "id-b", name: "b", arguments: {} },
        ],
      },
      { role: "assistant", text: "done" },
    ]);
    const result = await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    const toolTurns = result.newTurns.filter((t) => t.role === "tool");
    expect(toolTurns).toHaveLength(2);
    expect(toolTurns[0]).toMatchObject({ callId: "id-a", name: "a", text: "ra" });
    expect(toolTurns[1]).toMatchObject({ callId: "id-b", name: "b", text: "rb" });
  });
});

describe("agent loop — robustness", () => {
  beforeEach(() => clearTools());

  it("a throwing tool does not crash the loop; error surfaces as tool result (regression: B18)", async () => {
    registerTool("boom", async () => {
      throw new Error("kapow");
    });
    const { fake } = makeFakeChat([
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "c1", name: "boom", arguments: {} }],
      },
      { role: "assistant", text: "recovered" },
    ]);
    const result = await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    const toolTurn = result.newTurns.find((t) => t.role === "tool");
    expect(toolTurn).toBeDefined();
    expect((toolTurn as { text: string }).text).toContain("Tool boom threw");
    expect((toolTurn as { text: string }).text).toContain("kapow");
    expect(result.response).toBe("recovered");
  });

  it("unknown tool name becomes a tool turn with an error message", async () => {
    const { fake } = makeFakeChat([
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "c1", name: "ghost", arguments: {} }],
      },
      { role: "assistant", text: "ok" },
    ]);
    const result = await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    const toolTurn = result.newTurns.find((t) => t.role === "tool");
    expect(toolTurn).toBeDefined();
    expect((toolTurn as { text: string }).text).toContain("Unknown tool");
  });

  it("chat() throwing surfaces as an error turn and bails the loop", async () => {
    const fake = async (): Promise<AssistantTurn> => {
      throw new Error("network down");
    };
    const result = await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    expect(result.response).toContain("Error: network down");
    expect(result.newTurns[result.newTurns.length - 1].role).toBe("assistant");
  });

  it("terminates after MAX_ITERATIONS when the model loops on tool calls", async () => {
    registerTool("loop", async () => ({ success: true, result: "again" }));
    // Always returns a tool call. The loop must bail at MAX_ITERATIONS.
    const fake = async (): Promise<AssistantTurn> => ({
      role: "assistant",
      text: "",
      toolCalls: [{ id: "c", name: "loop", arguments: {} }],
    });
    const result = await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    expect(result.response).toBe("Max iterations reached");
  });
});

describe("agent loop — input immutability", () => {
  beforeEach(() => clearTools());

  it("does not mutate the caller's history array", async () => {
    const history: Turn[] = [
      { role: "user", text: "prior" },
      { role: "assistant", text: "prior-reply" },
    ];
    const snapshot = JSON.parse(JSON.stringify(history));
    const { fake } = makeFakeChat([{ role: "assistant", text: "ok" }]);
    await getLLMResponse("now", history, {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      chat: fake,
      ...NULL_HOOKS,
    });
    expect(history).toEqual(snapshot);
  });
});
