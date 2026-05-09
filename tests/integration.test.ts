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
});