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

  it("list registered tools", () => {
    registerTool("tool1", async () => ({ success: true }));
    registerTool("tool2", async () => ({ success: true }));
    expect(Object.keys(listTools())).toHaveLength(2);
  });

  it("clear all tools", () => {
    registerTool("tool1", async () => ({ success: true }));
    clearTools();
    expect(Object.keys(listTools())).toHaveLength(0);
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
  it("runCommand matches run-command", () => expect(fuzzyMatch("runCommand", "run-command")).toBe(true));
  it("case insensitive", () => expect(fuzzyMatch("READFILE", "readfile")).toBe(true));
});

describe("Parse format 1: [TOOL_CALL]", () => {
  it("parses basic format", () => {
    const text = `[TOOL_CALL]{tool => "searchFiles", args => { --pattern "**/*.js" }}`;
    const m = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\}/gi.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("searchFiles");
  });

  it("extracts pattern argument", () => {
    const text = `[TOOL_CALL]{tool => "searchFiles", args => { --pattern "**/*.ts" }}`;
    const m = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\}/gi.exec(text);
    expect(m![2]).toContain("pattern");
  });
});

describe("Parse format 2: multiline [/TOOL_CALL]", () => {
  it("parses multiline block", () => {
    const text = `[TOOL_CALL]
{tool => "searchFiles", args => { --pattern "**/*.js" }}
[/TOOL_CALL]`;
    const re = /\[TOOL_CALL\]\s*[\r\n]+\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\s*\}[\r\n]+\[\/TOOL_CALL\]/gi;
    const m = re.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("searchFiles");
  });
});

describe("Parse format 3: XML self-closing", () => {
  it("parses <toolName(key: value)/>", () => {
    const text = `<runCommand(command: "ls -la")/>`;
    const m = /<(\w+)\((\w+):\s*"([^"]+)"[^)]*\)\/?>/gi.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("runCommand");
    expect(m![2]).toBe("command");
    expect(m![3]).toBe("ls -la");
  });

  it("parses <toolName(key: value)></toolName>", () => {
    const text = `<runCommand(command: "ls -la")></runCommand>`;
    const re = /<(\w+)\((\w+):\s*"([^"]+)"[^)]*\)\/?>|<(\w+)\((\w+):\s*"([^"]+)"[^)]*\)\s*<\/\w+>/gi;
    const m = re.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("runCommand");
  });
});

describe("Parse format 4: backtick tool: value", () => {
  it("parses backtick format", () => {
    const text = 'Let me use `searchFiles: **/*.ts`';
    const m = /`(\w+):\s*(.+?)`/g.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("searchFiles");
  });

  it("extracts value", () => {
    const text = '`runCommand: npm test`';
    const m = /`(\w+):\s*(.+?)`/g.exec(text);
    expect(m![2]).toBe("npm test");
  });
});

describe("Parse format 5: plain tool name fallback", () => {
  it("matches tool name in text", () => {
    const text = "I will readFile and then runCommand";
    const re = /\breadFile\b/gi;
    expect(re.test(text)).toBe(true);
  });

  it("fuzzy matches in sentence", () => {
    const text = "Please search for the file";
    expect(text.toLowerCase().includes("search")).toBe(true);
  });
});