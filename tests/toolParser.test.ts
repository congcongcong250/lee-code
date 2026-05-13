import { describe, it, expect } from "vitest";
import { parseToolCallsFromText, parseFunctionCalls, fuzzyMatch } from "../src/toolParser";

const TOOLS = ["searchFiles", "readFile", "runCommand"];

describe("fuzzyMatch", () => {
  it("matches snake_case against camelCase", () => {
    expect(fuzzyMatch("readFile", "read_file")).toBe(true);
    expect(fuzzyMatch("read-file", "readFile")).toBe(true);
  });

  it("case-insensitive", () => {
    expect(fuzzyMatch("READFILE", "readfile")).toBe(true);
  });

  it("rejects clearly different names", () => {
    expect(fuzzyMatch("readFile", "writeFile")).toBe(false);
    expect(fuzzyMatch("searchFiles", "runCommand")).toBe(false);
  });
});

describe("parseToolCallsFromText — happy paths", () => {
  it("format 1: bracket-arrow", () => {
    const text = `[TOOL_CALL]{tool => "searchFiles", args => { --pattern "**/*.ts" }}`;
    const calls = parseToolCallsFromText(text, TOOLS);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("searchFiles");
    expect(calls[0].arguments).toEqual({ pattern: "**/*.ts" });
  });

  it("format 2: multiline block (regression: B8 dead regex)", () => {
    const text = `[TOOL_CALL]
{tool => "runCommand", args => { --command "ls -la" }}
[/TOOL_CALL]`;
    const calls = parseToolCallsFromText(text, TOOLS);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("runCommand");
    expect(calls[0].arguments).toEqual({ command: "ls -la" });
  });

  it("format 3: XML self-closing", () => {
    const text = `<runCommand(command: "ls")/>`;
    const calls = parseToolCallsFromText(text, TOOLS);
    expect(calls[0].name).toBe("runCommand");
    expect(calls[0].arguments).toEqual({ command: "ls" });
  });

  it("format 4: bare XML body", () => {
    const text = `<searchFiles>**/*.ts</searchFiles>`;
    const calls = parseToolCallsFromText(text, TOOLS);
    expect(calls[0].name).toBe("searchFiles");
    expect(calls[0].arguments).toEqual({ value: "**/*.ts" });
  });

  it("format 5: backtick `tool: value`", () => {
    const text = "use `searchFiles: **/*.ts` please";
    const calls = parseToolCallsFromText(text, TOOLS);
    expect(calls[0].name).toBe("searchFiles");
    expect(calls[0].arguments).toEqual({ value: "**/*.ts" });
  });
});

describe("parseToolCallsFromText — adversarial / regression", () => {
  it("plain-name mention does NOT trigger an empty call (regression: B7 spam-loop)", () => {
    const text =
      "You can use readFile to read a file, or searchFiles to find them, " +
      "and runCommand to execute shell commands.";
    const calls = parseToolCallsFromText(text, TOOLS);
    expect(calls).toHaveLength(0);
  });

  it("does not fabricate empty-args calls from in-line code references", () => {
    const text = "I considered runCommand but decided not to.";
    expect(parseToolCallsFromText(text, TOOLS)).toHaveLength(0);
  });

  it("ignores [TOOL_CALL] blocks with no args", () => {
    const text = `[TOOL_CALL]{tool => "searchFiles", args => {}}`;
    expect(parseToolCallsFromText(text, TOOLS)).toHaveLength(0);
  });

  it("only the first matched format per tool wins (does not produce duplicates)", () => {
    const text =
      `[TOOL_CALL]{tool => "searchFiles", args => { --pattern "**/*.ts" }}\n` +
      `<searchFiles>**/*.js</searchFiles>`;
    const calls = parseToolCallsFromText(text, TOOLS);
    const searches = calls.filter((c) => c.name === "searchFiles");
    expect(searches).toHaveLength(1);
  });

  it("ignores unknown tool names", () => {
    const text = `[TOOL_CALL]{tool => "deleteEverything", args => { --confirm "yes" }}`;
    expect(parseToolCallsFromText(text, TOOLS)).toHaveLength(0);
  });

  it("multiple distinct tools in one message", () => {
    const text =
      `[TOOL_CALL]{tool => "searchFiles", args => { --pattern "*.ts" }}\n` +
      `<runCommand(command: "echo hi")/>`;
    const calls = parseToolCallsFromText(text, TOOLS);
    expect(calls.map((c) => c.name).sort()).toEqual(["runCommand", "searchFiles"]);
  });

  it("empty text returns empty array", () => {
    expect(parseToolCallsFromText("", TOOLS)).toEqual([]);
  });
});

describe("parseFunctionCalls — wire shape from native models", () => {
  it("parses well-formed string-arguments", () => {
    const calls = parseFunctionCalls({
      tool_calls: [
        {
          id: "c1",
          function: {
            name: "searchFiles",
            arguments: JSON.stringify({ pattern: "**/*.ts" }),
          },
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: "c1",
      name: "searchFiles",
      arguments: { pattern: "**/*.ts" },
    });
  });

  it("malformed JSON arguments do NOT crash; arguments become {} (regression: B5)", () => {
    const calls = parseFunctionCalls({
      tool_calls: [
        {
          id: "c1",
          function: { name: "x", arguments: "{not valid" },
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments).toEqual({});
  });

  it("object arguments (Ollama-shaped) are kept verbatim", () => {
    const calls = parseFunctionCalls({
      tool_calls: [
        { id: "c1", function: { name: "x", arguments: { key: "val" } } },
      ],
    });
    expect(calls[0].arguments).toEqual({ key: "val" });
  });

  it("absent tool_calls field returns []", () => {
    expect(parseFunctionCalls({})).toEqual([]);
    expect(parseFunctionCalls({ tool_calls: null })).toEqual([]);
  });

  it("skips entries without function.name", () => {
    const calls = parseFunctionCalls({
      tool_calls: [
        { id: "c1" },
        { id: "c2", function: {} },
        { id: "c3", function: { name: "ok", arguments: "{}" } },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("ok");
  });

  it("a malformed entry does not abort parsing of subsequent valid entries", () => {
    const calls = parseFunctionCalls({
      tool_calls: [
        { id: "c1", function: { name: "a", arguments: "{not valid" } },
        { id: "c2", function: { name: "b", arguments: '{"k":"v"}' } },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].arguments).toEqual({});
    expect(calls[1].arguments).toEqual({ k: "v" });
  });
});
