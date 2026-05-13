import { describe, it, expect } from "vitest";
import { Turn } from "../src/conversation";
import {
  serializeForOpenAINative,
  serializeForOpenAISchema,
  serializeForOllama,
} from "../src/serializers";

const baseTurns: Turn[] = [
  { role: "system", text: "You are an agent." },
  { role: "user", text: "List ts files" },
  {
    role: "assistant",
    text: "Calling searchFiles",
    toolCalls: [
      { id: "call_1", name: "searchFiles", arguments: { pattern: "**/*.ts" } },
    ],
  },
  {
    role: "tool",
    callId: "call_1",
    name: "searchFiles",
    text: '["a.ts","b.ts"]',
  },
  { role: "assistant", text: "Found 2 files." },
];

describe("serializeForOpenAINative", () => {
  it("preserves system/user/assistant prose verbatim", () => {
    const out = serializeForOpenAINative(baseTurns);
    expect(out[0]).toEqual({ role: "system", content: "You are an agent." });
    expect(out[1]).toEqual({ role: "user", content: "List ts files" });
  });

  it("attaches tool_calls to the assistant message", () => {
    const out = serializeForOpenAINative(baseTurns);
    expect(out[2].role).toBe("assistant");
    expect(out[2].tool_calls).toHaveLength(1);
    expect(out[2].tool_calls![0].id).toBe("call_1");
    expect(out[2].tool_calls![0].type).toBe("function");
    expect(out[2].tool_calls![0].function.name).toBe("searchFiles");
    expect(out[2].tool_calls![0].function.arguments).toBe(
      JSON.stringify({ pattern: "**/*.ts" })
    );
  });

  it("preserves tool role and tool_call_id (regression: bug B4)", () => {
    const out = serializeForOpenAINative(baseTurns);
    expect(out[3]).toEqual({
      role: "tool",
      content: '["a.ts","b.ts"]',
      tool_call_id: "call_1",
    });
  });

  it("ordering invariant: assistant-with-tool_calls is followed by tool messages with matching ids", () => {
    const turns: Turn[] = [
      {
        role: "assistant",
        text: "",
        toolCalls: [
          { id: "a", name: "f", arguments: {} },
          { id: "b", name: "g", arguments: {} },
        ],
      },
      { role: "tool", callId: "a", name: "f", text: "ra" },
      { role: "tool", callId: "b", name: "g", text: "rb" },
    ];
    const out = serializeForOpenAINative(turns);
    expect(out[0].tool_calls!.map((tc) => tc.id)).toEqual(["a", "b"]);
    expect(out[1].tool_call_id).toBe("a");
    expect(out[2].tool_call_id).toBe("b");
  });

  it("assistant with empty text + tool calls sends content=null", () => {
    const out = serializeForOpenAINative([
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "x", name: "n", arguments: {} }],
      },
    ]);
    expect(out[0].content).toBeNull();
  });

  it("assistant with no tool calls omits tool_calls field", () => {
    const out = serializeForOpenAINative([{ role: "assistant", text: "done" }]);
    expect(out[0].tool_calls).toBeUndefined();
  });
});

describe("serializeForOpenAISchema", () => {
  it("schema mode has no tool role on the wire", () => {
    const out = serializeForOpenAISchema(baseTurns);
    expect(out.every((m) => m.role !== "tool")).toBe(true);
  });

  it("tool turns become labeled user messages (regression: no protocol leak)", () => {
    const out = serializeForOpenAISchema(baseTurns);
    const labeled = out.find((m) => m.role === "user" && m.content!.startsWith("[tool_result"));
    expect(labeled).toBeDefined();
    expect(labeled!.content).toContain("name=searchFiles");
    expect(labeled!.content).toContain("id=call_1");
    expect(labeled!.content).toContain('["a.ts","b.ts"]');
  });

  it("assistant turns surface as plain prose (regression: never push the envelope)", () => {
    const out = serializeForOpenAISchema(baseTurns);
    // 3rd index in the original Turn[] was the assistant with tool_calls
    expect(out[2].role).toBe("assistant");
    expect(out[2].content).toBe("Calling searchFiles");
    expect((out[2] as { tool_calls?: unknown }).tool_calls).toBeUndefined();
  });

  it("does not emit tool_calls or tool_call_id (schema mode has no concept of them)", () => {
    const out = serializeForOpenAISchema(baseTurns);
    for (const m of out) {
      expect(m.tool_calls).toBeUndefined();
      expect(m.tool_call_id).toBeUndefined();
    }
  });
});

describe("serializeForOllama", () => {
  it("collapses tool turns into labeled user messages", () => {
    const out = serializeForOllama(baseTurns);
    expect(out.every((m) => m.role !== ("tool" as unknown))).toBe(true);
    const toolResultUser = out.find((m) => m.content.includes("[tool_result"));
    expect(toolResultUser).toBeDefined();
    expect(toolResultUser!.role).toBe("user");
  });

  it("inlines assistant tool_calls into prose so context survives the round-trip", () => {
    const out = serializeForOllama(baseTurns);
    const assistantWithCall = out.find((m) =>
      m.role === "assistant" && m.content.includes("[tool_call")
    );
    expect(assistantWithCall).toBeDefined();
    expect(assistantWithCall!.content).toContain("name=searchFiles");
    expect(assistantWithCall!.content).toContain("id=call_1");
  });
});

describe("serializer immutability", () => {
  it("does not mutate the input turns", () => {
    const turns: Turn[] = [
      { role: "user", text: "x" },
      {
        role: "assistant",
        text: "y",
        toolCalls: [{ id: "1", name: "n", arguments: { k: "v" } }],
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(turns));
    serializeForOpenAINative(turns);
    serializeForOpenAISchema(turns);
    serializeForOllama(turns);
    expect(turns).toEqual(snapshot);
  });
});
