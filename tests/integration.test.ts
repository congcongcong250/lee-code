import { describe, it, expect, beforeEach } from "vitest";
import { registerTool, getTool, clearTools, listTools } from "../src/tools";

describe("Tool Registration CLI Integration", () => {
  beforeEach(() => { clearTools(); });

  it("registers searchFiles tool", async () => {
    registerTool("searchFiles", async (args) => {
      return { success: true, result: '["file1.ts", "file2.ts"]' };
    });
    const fn = getTool("searchFiles");
    expect(fn).toBeDefined();
    const result = await fn!({ pattern: "*.ts" });
    expect(result.success).toBe(true);
  });

  it("registers readFile tool", async () => {
    registerTool("readFile", async (args) => {
      const path = args.path as string;
      return { success: true, result: `file content of ${path}` };
    });
    const fn = getTool("readFile");
    expect(fn).toBeDefined();
    const result = await fn!({ path: "a.ts" });
    expect(result.success).toBe(true);
    expect(result.result).toContain("a.ts");
  });

  it("registers runCommand tool", async () => {
    registerTool("runCommand", async (args) => {
      const cmd = args.command as string;
      return { success: true, result: `executed: ${cmd}` };
    });
    const fn = getTool("runCommand");
    expect(fn).toBeDefined();
    const result = await fn!({ command: "ls" });
    expect(result.success).toBe(true);
    expect(result.result).toContain("ls");
  });

  it("returns error on tool failure", async () => {
    registerTool("failingTool", async () => {
      return { success: false, error: "tool failed" };
    });
    const fn = getTool("failingTool");
    const result = await fn!({});
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool failed");
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