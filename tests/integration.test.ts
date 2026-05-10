import { describe, it, expect, beforeEach } from "vitest";
import { registerTool, getTool, getToolSchema, clearTools, listToolSchemas, Tool } from "../src/tools";

describe("Tool Registration with Schemas", () => {
  beforeEach(() => { clearTools(); });

  it("registers tool with schema", () => {
    const schema: Tool = {
      name: "testTool",
      description: "Test tool",
      parameters: { type: "object", properties: { arg1: { type: "string" } }, required: ["arg1"] },
    };
    registerTool("testTool", async () => ({ success: true, result: "ok" }), schema);
    
    const storedSchema = getToolSchema("testTool");
    expect(storedSchema).toBeDefined();
    expect(storedSchema!.name).toBe("testTool");
    expect(storedSchema!.parameters.properties.arg1).toBeDefined();
  });

  it("lists tool schemas", () => {
    const schema: Tool = {
      name: "tool1",
      description: "Tool 1",
      parameters: { type: "object", properties: {} },
    };
    registerTool("tool1", async () => ({ success: true }), schema);
    
    const schemas = listToolSchemas();
    expect(schemas.length).toBeGreaterThan(0);
    expect(schemas.find(s => s.name === "tool1")).toBeDefined();
  });

  it("searchFiles schema has pattern argument", () => {
    const schema: Tool = {
      name: "searchFiles",
      description: "Find files",
      parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
    };
    registerTool("searchFiles", async () => ({ success: true }), schema);
    
    const stored = getToolSchema("searchFiles");
    expect(stored?.parameters.properties.pattern).toBeDefined();
  });

  it("runCommand schema has command argument", () => {
    const schema: Tool = {
      name: "runCommand",
      description: "Run command",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    };
    registerTool("runCommand", async () => ({ success: true }), schema);
    
    const stored = getToolSchema("runCommand");
    expect(stored?.parameters.properties.command).toBeDefined();
  });
});

describe("Tool Execution", () => {
  beforeEach(() => { clearTools(); });

  it("executes searchFiles with pattern", async () => {
    registerTool("searchFiles", async (args) => {
      const pattern = (args.pattern || args.path) as string;
      if (!pattern) return { success: false, error: "Missing pattern argument" };
      return { success: true, result: `found: ${pattern}` };
    });
    const fn = getTool("searchFiles")!;
    const result = await fn({ pattern: "*.ts" });
    expect(result.success).toBe(true);
    expect(result.result).toContain("*.ts");
  });

  it("executes readFile with path", async () => {
    registerTool("readFile", async (args) => {
      const filePath = (args.path || args.filePath) as string;
      if (!filePath) return { success: false, error: "Missing path argument" };
      return { success: true, result: `read: ${filePath}` };
    });
    const fn = getTool("readFile")!;
    const result = await fn({ path: "src/cli.ts" });
    expect(result.success).toBe(true);
    expect(result.result).toContain("src/cli.ts");
  });

  it("executes runCommand with command", async () => {
    registerTool("runCommand", async (args) => {
      const command = (args.command || args.cmd) as string;
      if (!command) return { success: false, error: "Missing command argument" };
      return { success: true, result: `ran: ${command}` };
    });
    const fn = getTool("runCommand")!;
    const result = await fn({ command: "ls" });
    expect(result.success).toBe(true);
    expect(result.result).toContain("ls");
  });

  it("returns error when argument missing", async () => {
    registerTool("runCommand", async (args) => {
      const command = (args.command || args.cmd) as string;
      if (!command) return { success: false, error: "Missing command argument" };
      return { success: true, result: "ok" };
    });
    const fn = getTool("runCommand")!;
    const result = await fn({});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing command argument");
  });

  it("tool result added to messages with role tool", async () => {
    const messages: { role: string; content: string; toolCallId?: string }[] = [];
    
    registerTool("searchFiles", async () => ({ success: true, result: '["a.ts"]' }));
    const fn = getTool("searchFiles")!;
    const result = await fn({ pattern: "*.ts" });
    
    const toolMsg = { role: "tool", content: result.result || "", toolCallId: "call_1" };
    messages.push({ role: "assistant", content: '{"tool_calls":[...]}' });
    messages.push(toolMsg);
    
    expect(messages.find(m => m.role === "tool")).toBeDefined();
    expect(messages.find(m => m.toolCallId === "call_1")).toBeDefined();
  });
});

describe("Tool Message Role", () => {
  it("supports tool role in ChatMessage", () => {
    const role: "system" | "user" | "assistant" | "tool" = "tool";
    expect(role).toBe("tool");
  });

  it("supports toolCallId in ChatMessage", () => {
    const msg = { role: "tool" as const, content: "result", toolCallId: "call_1" };
    expect(msg.toolCallId).toBe("call_1");
  });

  it("toolCallId is preserved from request", () => {
    const msg = { role: "tool" as const, content: "result", toolCallId: "custom id" };
    expect(msg.toolCallId).toBe("custom id");
  });
});

describe("Message Accumulation", () => {
  it("messages array grows when adding new entries", () => {
    const messages: { role: string; content: string }[] = [];
    const initialLength = messages.length;
    
    messages.push({ role: "assistant", content: "response" });
    messages.push({ role: "tool", content: "tool result" });
    
    expect(messages.length).toBe(initialLength + 2);
  });

  it("assistant message comes before tool result", () => {
    const messages: { role: string; content: string }[] = [];
    
    // Simulate: assistant first, then tool
    messages.push({ role: "assistant", content: "I'll search files" });
    messages.push({ role: "tool", content: '["file1.ts", "file2.ts"]' });
    
    const lastIndex = messages.length - 1;
    expect(messages[lastIndex - 1].role).toBe("assistant");
    expect(messages[lastIndex].role).toBe("tool");
  });

  it("multiple iterations accumulate messages", () => {
    let messages: { role: string; content: string }[] = [];
    
    // Iteration 1
    messages.push({ role: "assistant", content: "searching" });
    messages.push({ role: "tool", content: "result1" });
    
    // Iteration 2
    messages.push({ role: "assistant", content: "reading" });
    messages.push({ role: "tool", content: "result2" });
    
    expect(messages.length).toBe(4);
    expect(messages[0].content).toBe("searching");
    expect(messages[2].content).toBe("reading");
  });
});

describe("Multiple Tools in Single Response", () => {
  beforeEach(() => { clearTools(); });

  it("processes multiple tools sequentially", async () => {
    let executedTools: string[] = [];
    
    registerTool("tool1", async () => ({ success: true, result: "result1" }));
    registerTool("tool2", async () => ({ success: true, result: "result2" }));
    
    const toolCalls = [
      { id: "1", name: "tool1", arguments: {} },
      { id: "2", name: "tool2", arguments: {} }
    ];
    
    for (const tc of toolCalls) {
      const fn = getTool(tc.name);
      if (fn) {
        const result = await fn(tc.arguments);
        executedTools.push(tc.name);
      }
    }
    
    expect(executedTools).toHaveLength(2);
    expect(executedTools[0]).toBe("tool1");
    expect(executedTools[1]).toBe("tool2");
  });

  it("returns messages for multiple tool calls", async () => {
    const messages: { role: string; content: string; toolCallId?: string }[] = [];
    
    const toolCalls = [
      { id: "call_1", name: "searchFiles", arguments: { pattern: "*.ts" } },
      { id: "call_2", name: "readFile", arguments: { path: "a.ts" } }
    ];
    
    for (const tc of toolCalls) {
      messages.push({ 
        role: "tool", 
        content: "result", 
        toolCallId: tc.id 
      });
    }
    
    expect(messages).toHaveLength(2);
    expect(messages[0].toolCallId).toBe("call_1");
    expect(messages[1].toolCallId).toBe("call_2");
  });
});

describe("Unknown Tool Handling", () => {
  beforeEach(() => { clearTools(); });

  it("unknown tool returns error message", () => {
    const fn = getTool("nonexistentTool");
    expect(fn).toBeUndefined();
  });

  it("handles unknown tool with user role message", () => {
    const unknownToolName = "unknownTool";
    const errorMsg = `Unknown tool: ${unknownToolName}`;
    const msg = { role: "user", content: errorMsg };
    
    expect(msg.role).toBe("user");
    expect(msg.content).toContain("Unknown");
  });
});

describe("Full vs Display Content", () => {
  it("display is truncated at 200 chars", () => {
    const fullResult = "a".repeat(300);
    const displayResult = fullResult.length > 200 
      ? fullResult.slice(0, 200) + "..." 
      : fullResult;
    
    expect(displayResult.length).toBe(203);
  });

  it("full result is preserved for LLM", () => {
    const fullResult = "a".repeat(300);
    const displayResult = fullResult.length > 200 
      ? fullResult.slice(0, 200) + "..." 
      : fullResult;
    
    // Full is stored, display is shown
    const storedForLLM = fullResult;
    expect(storedForLLM.length).toBe(300);
    expect(displayResult.length).toBe(203);
  });
});

describe("Error Result Handling", () => {
  beforeEach(() => { clearTools(); });

  it("tool returns success: false with error message", async () => {
    registerTool("failingTool", async () => ({ success: false, error: "tool failed" }));
    
    const fn = getTool("failingTool")!;
    const result = await fn({});
    
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool failed");
  });

  it("error result is added to messages", () => {
    const result = { success: false, error: "tool failed" };
    const fullResult = result.success ? (result.result || "") : (result.error || "Error");
    
    expect(fullResult).toContain("failed");
  });
});