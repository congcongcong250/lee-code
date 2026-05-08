import { describe, it, expect, beforeEach } from "vitest";
import { registerTool, getTool, clearTools, listTools } from "../src/tools";

describe("Tools", () => {
  beforeEach(() => { clearTools(); });

  it("register and get", async () => {
    registerTool("test", async () => ({ success: true }));
    expect(getTool("test")).toBeDefined();
  });

  it("unknown returns undefined", () => {
    expect(getTool("unknown")).toBeUndefined();
  });
});

describe("fuzzyMatch", () => {
  const fuzzyMatch = (a: string, b: string) => {
    const n = (s: string) => s.toLowerCase().replace(/[_-]/g, "");
    return n(a).includes(n(b)) || n(b).includes(n(a));
  };

  it("readFile matches read-file", () => expect(fuzzyMatch("readFile", "read-file")).toBe(true));
  it("SEARCHFILES matches searchfiles", () => expect(fuzzyMatch("SEARCHFILES", "searchfiles")).toBe(true));
  it("readFile does NOT match writeFile", () => expect(fuzzyMatch("readFile", "writeFile")).toBe(false));
});

describe("Parse formats", () => {
  it("format 1: [TOOL_CALL]{tool => name, args => { --key value }}", () => {
    const text = `[TOOL_CALL]{tool => "searchFiles", args => { --pattern "**/*.js" }}`;
    const m = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\}/gi.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("searchFiles");
  });

  it("format 2: multiline", () => {
    const text = `[TOOL_CALL]
{tool => "searchFiles", args => { --pattern "**/*.js" }}
[/TOOL_CALL]`;
    const re = /\[TOOL_CALL\]\s*[\r\n]+\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\s*\}[\r\n]+\[\/TOOL_CALL\]/gi;
    const m = re.exec(text);
    expect(m).not.toBeNull();
  });

  it("simple tool call", () => {
    // The format is `tool: value` with backticks
    const text = 'Let me use `searchFiles: **/*.ts`';
    const re = /\`(\w+):\s*(.+?)\`/g;
    const m = re.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("searchFiles");
  });
});