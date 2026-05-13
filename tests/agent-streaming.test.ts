import { describe, it, expect, beforeEach } from "vitest";
import { getLLMResponse } from "../src/agent";
import { Turn, AssistantTurn } from "../src/conversation";
import { ToolCall, registerTool, clearTools } from "../src/tools";
import { StreamHandlers } from "../src/llm";
import { LLMConfig } from "../src/providers";

/**
 * Integration test: the agent loop, when given a streaming chat function,
 * must:
 *   - deliver each text chunk to onStreamChunk
 *   - call onStreamStart / onStreamEnd around each streamed call
 *   - NOT re-print the assistant text via onAssistantText afterwards
 *   - still capture tool calls in newTurns
 *   - still run tools and feed results back to the next iteration
 */

const NULL_HOOKS = {
  onAssistantText: () => {
    throw new Error(
      "agent should NOT call onAssistantText when streaming — chunks already delivered"
    );
  },
  onToolCall: () => {},
  onToolResult: () => {},
  onError: () => {},
};

function makeFakeStreamChat(scripted: AssistantTurn[]) {
  let i = 0;
  const observedCalls: Turn[][] = [];
  const fake = async (turns: Turn[], _cfg: LLMConfig, h: StreamHandlers): Promise<AssistantTurn> => {
    observedCalls.push(turns.map((t) => ({ ...t })));
    const next = scripted[i] ?? { role: "assistant", text: "(no more)" };
    i += 1;
    // Simulate streaming the text in 3 chunks.
    if (next.text) {
      const third = Math.ceil(next.text.length / 3);
      h.onText(next.text.slice(0, third));
      h.onText(next.text.slice(third, third * 2));
      h.onText(next.text.slice(third * 2));
    }
    return next;
  };
  return { fake, getCalls: () => observedCalls };
}

describe("agent loop — streaming path", () => {
  beforeEach(() => clearTools());

  it("delivers chunks to onStreamChunk and skips onAssistantText", async () => {
    const { fake } = makeFakeStreamChat([{ role: "assistant", text: "hello world" }]);
    const seenChunks: string[] = [];
    let started = 0;
    let ended = 0;
    const result = await getLLMResponse("hi", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      streamChat: fake,
      onStreamChunk: (c) => seenChunks.push(c),
      onStreamStart: () => started++,
      onStreamEnd: () => ended++,
      ...NULL_HOOKS,
    });
    expect(seenChunks.join("")).toBe("hello world");
    expect(seenChunks.length).toBeGreaterThan(1);
    expect(started).toBe(1);
    expect(ended).toBe(1);
    expect(result.response).toBe("hello world");
  });

  it("streaming + tool calls: still captures tool turns in newTurns", async () => {
    registerTool("searchFiles", async () => ({ success: true, result: '["a.ts"]' }));
    const tc: ToolCall = { id: "call_99", name: "searchFiles", arguments: { pattern: "*" } };
    const { fake } = makeFakeStreamChat([
      { role: "assistant", text: "scanning", toolCalls: [tc] },
      { role: "assistant", text: "done" },
    ]);
    const seenChunks: string[] = [];
    const result = await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      streamChat: fake,
      onStreamChunk: (c) => seenChunks.push(c),
      ...NULL_HOOKS,
    });
    expect(result.newTurns).toHaveLength(4);
    expect(result.newTurns[1].role).toBe("assistant");
    expect((result.newTurns[1] as AssistantTurn).toolCalls).toEqual([tc]);
    expect(result.newTurns[2]).toEqual({
      role: "tool",
      callId: "call_99",
      name: "searchFiles",
      text: '["a.ts"]',
    });
    expect(seenChunks.join("")).toContain("scanning");
    expect(seenChunks.join("")).toContain("done");
  });

  it("second streamed iteration sees the prior tool turn in history", async () => {
    registerTool("searchFiles", async () => ({ success: true, result: '["x"]' }));
    const { fake, getCalls } = makeFakeStreamChat([
      { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "searchFiles", arguments: {} }] },
      { role: "assistant", text: "fin" },
    ]);
    await getLLMResponse("q", [], {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
      apiKey: "x",
      systemPrompt: "sys",
      streamChat: fake,
      onStreamChunk: () => {},
      ...NULL_HOOKS,
    });
    const secondCall = getCalls()[1];
    const toolTurn = secondCall.find((t) => t.role === "tool");
    expect(toolTurn).toBeDefined();
    expect(toolTurn).toMatchObject({ callId: "c1", name: "searchFiles", text: '["x"]' });
  });
});
