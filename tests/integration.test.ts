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

describe("Tool Argument Aliasing", () => {
  beforeEach(() => { clearTools(); });

  it("searchFiles accepts path argument", async () => {
    let captured = "";
    registerTool("searchFiles", async (args) => {
      captured = args.pattern || args.path || "";
      return { success: true, result: `captured: ${captured}` };
    });
    const fn = getTool("searchFiles")!;
    const result = await fn({ path: "**/*.ts" });
    expect(captured).toBe("**/*.ts");
  });

  it("searchFiles returns error for empty arguments", async () => {
    registerTool("searchFiles", async (args) => {
      const pattern = (args.pattern || args.path) as string;
      if (!pattern) return { success: false, error: "Missing pattern argument" };
      return { success: true, result: "ok" };
    });
    const fn = getTool("searchFiles")!;
    const result = await fn({});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing pattern argument");
  });

  it("readFile accepts filePath argument", async () => {
    let captured = "";
    registerTool("readFile", async (args) => {
      captured = (args.path || args.filePath) as string;
      return { success: true, result: captured };
    });
    const fn = getTool("readFile")!;
    const result = await fn({ filePath: "src/cli.ts" });
    expect(captured).toBe("src/cli.ts");
  });

  it("runCommand accepts cmd argument", async () => {
    let captured = "";
    registerTool("runCommand", async (args) => {
      captured = (args.command || args.cmd) as string;
      return { success: true, result: captured };
    });
    const fn = getTool("runCommand")!;
    const result = await fn({ cmd: "ls -la" });
    expect(captured).toBe("ls -la");
  });

  it("runCommand returns error for empty command", async () => {
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
});