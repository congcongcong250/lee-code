import { describe, it, expect } from "vitest";
import {
  Turn,
  AgentMode,
  isAssistantTurn,
  isToolTurn,
  AssistantTurn,
  ToolTurn,
} from "../src/conversation";

describe("Turn discriminated union", () => {
  it("system turn carries text", () => {
    const t: Turn = { role: "system", text: "You are an agent." };
    expect(t.role).toBe("system");
    expect(t.text).toBe("You are an agent.");
  });

  it("user turn carries text", () => {
    const t: Turn = { role: "user", text: "hello" };
    expect(t.role).toBe("user");
  });

  it("assistant turn can hold tool calls", () => {
    const t: AssistantTurn = {
      role: "assistant",
      text: "calling search",
      toolCalls: [{ id: "call_1", name: "searchFiles", arguments: { pattern: "*.ts" } }],
    };
    expect(t.toolCalls).toHaveLength(1);
    expect(t.toolCalls![0].id).toBe("call_1");
  });

  it("assistant turn without tool calls is valid", () => {
    const t: AssistantTurn = { role: "assistant", text: "done" };
    expect(t.toolCalls).toBeUndefined();
  });

  it("tool turn requires callId and name", () => {
    const t: ToolTurn = {
      role: "tool",
      callId: "call_1",
      name: "searchFiles",
      text: "[\"a.ts\"]",
    };
    expect(t.callId).toBe("call_1");
    expect(t.name).toBe("searchFiles");
  });
});

describe("Turn type guards", () => {
  it("isAssistantTurn narrows correctly", () => {
    const t: Turn = { role: "assistant", text: "hi", toolCalls: [] };
    expect(isAssistantTurn(t)).toBe(true);
    if (isAssistantTurn(t)) {
      expect(t.toolCalls).toEqual([]);
    }
  });

  it("isAssistantTurn rejects other roles", () => {
    expect(isAssistantTurn({ role: "user", text: "x" })).toBe(false);
    expect(isAssistantTurn({ role: "system", text: "x" })).toBe(false);
    expect(isAssistantTurn({ role: "tool", callId: "c", name: "n", text: "x" })).toBe(false);
  });

  it("isToolTurn narrows correctly", () => {
    const t: Turn = { role: "tool", callId: "c1", name: "readFile", text: "data" };
    expect(isToolTurn(t)).toBe(true);
    if (isToolTurn(t)) {
      expect(t.name).toBe("readFile");
    }
  });

  it("isToolTurn rejects other roles", () => {
    expect(isToolTurn({ role: "assistant", text: "x" })).toBe(false);
  });
});

describe("AgentMode", () => {
  it("accepts the three documented modes", () => {
    const a: AgentMode = "native";
    const b: AgentMode = "schema";
    const c: AgentMode = "text-fuzzy";
    expect([a, b, c]).toEqual(["native", "schema", "text-fuzzy"]);
  });
});
