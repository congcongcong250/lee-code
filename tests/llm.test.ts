import { describe, it, expect } from "vitest";
import { parseSchemaResponse, SCHEMA_JSON, OPENROUTER_MODELS, SCHEMAS_MODELS } from "../src/schema";

describe("Schema Response Parsing", () => {
  it("parses content and version", () => {
    const input = JSON.stringify({
      content: "Hello world",
      version: "1.0"
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("Hello world");
    expect(result!.version).toBe("1.0");
  });

  it("parses empty content string with tool_calls - THE BUG WE FIXED", () => {
    const input = JSON.stringify({
      content: "",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "searchFiles", arguments: { pattern: "*.ts" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("");
    expect(result!.tool_calls).toHaveLength(1);
    expect(result!.tool_calls![0].arguments.pattern).toBe("*.ts");
  });

  it("parses whitespace content string with tool_calls", () => {
    const input = JSON.stringify({
      content: "   ",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "runCommand", arguments: { command: "ls" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("   ");
    expect(result!.tool_calls![0].arguments.command).toBe("ls");
  });

  it("parses content with multiple tool_calls", () => {
    const input = JSON.stringify({
      content: "Working",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "searchFiles", arguments: { pattern: "*.ts" } },
        { id: "call_2", name: "readFile", arguments: { path: "a.ts" } },
        { id: "call_3", name: "runCommand", arguments: { command: "ls" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls).toHaveLength(3);
  });

  it("parses content with tool_calls", () => {
    const input = JSON.stringify({
      content: "Searching files",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "searchFiles", arguments: { pattern: "*.ts" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls).toHaveLength(1);
    expect(result!.tool_calls![0].name).toBe("searchFiles");
  });

  it("parses tool_calls with path argument", () => {
    const input = JSON.stringify({
      content: "Searching",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "searchFiles", arguments: { path: "**/*.ts" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls![0].arguments.path).toBe("**/*.ts");
  });

  it("parses tool_calls with command argument", () => {
    const input = JSON.stringify({
      content: "Running",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "runCommand", arguments: { command: "ls -la" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls![0].arguments.command).toBe("ls -la");
  });

  it("parses readFile with filePath argument", () => {
    const input = JSON.stringify({
      content: "Reading",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "readFile", arguments: { filePath: "src/cli.ts" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls![0].arguments.filePath).toBe("src/cli.ts");
  });

  it("parses tool_calls with complex arguments", () => {
    const input = JSON.stringify({
      content: "",
      version: "1.0",
      tool_calls: [
        { 
          id: "call_1", 
          name: "runCommand", 
          arguments: { command: "grep -r 'pattern' src/**/*.ts" } 
        }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls![0].arguments.command).toBe("grep -r 'pattern' src/**/*.ts");
  });

  it("parses tool with empty arguments object", () => {
    const input = JSON.stringify({
      content: "",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "searchFiles", arguments: {} }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls![0].arguments).toEqual({});
  });

  it("preserves tool call id correctly", () => {
    const input = JSON.stringify({
      content: "",
      version: "1.0",
      tool_calls: [
        { id: "custom_id_123", name: "searchFiles", arguments: { pattern: "*.js" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls![0].id).toBe("custom_id_123");
  });

  it("parses content with tool_calls in code block", () => {
    const input = "```json\n" + JSON.stringify({
      content: "Found files",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "searchFiles", arguments: { pattern: "*.ts" } }
      ]
    }) + "\n```";
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls).toHaveLength(1);
  });

  it("returns null for non-JSON", () => {
    expect(parseSchemaResponse("not json")).toBeNull();
    expect(parseSchemaResponse("")).toBeNull();
  });

  it("returns null for missing version", () => {
    const input = JSON.stringify({ content: "hello" });
    expect(parseSchemaResponse(input)).toBeNull();
  });

  it("returns null when missing content property", () => {
    const input = JSON.stringify({ version: "1.0", tool_calls: [] });
    expect(parseSchemaResponse(input)).toBeNull();
  });
});

describe("OPENROUTER_MODELS configuration", () => {
  it("has schema models defined", () => {
    const schemaModels = OPENROUTER_MODELS.filter(m => m.mode === "schema");
    expect(schemaModels.length).toBeGreaterThan(0);
  });

  it("SCHEMAS_MODELS contains correct models", () => {
    expect(SCHEMAS_MODELS.has("nvidia/nemotron-3-super-120b-a12b:free")).toBe(true);
    expect(SCHEMAS_MODELS.has("qwen/qwen3-next-80b-a3b-instruct:free")).toBe(true);
  });

  it("native models NOT in SCHEMAS_MODELS", () => {
    expect(SCHEMAS_MODELS.has("minimax/minimax-m2.5:free")).toBe(false);
    expect(SCHEMAS_MODELS.has("tencent/hy3-preview:free")).toBe(false);
  });
});

describe("SCHEMA_JSON structure", () => {
  it("has content and version required", () => {
    expect(SCHEMA_JSON.required).toContain("content");
    expect(SCHEMA_JSON.required).toContain("version");
  });

  it("has tool_calls array", () => {
    expect(SCHEMA_JSON.properties.tool_calls).toBeDefined();
  });

  it("has version const 1.0", () => {
    expect(SCHEMA_JSON.properties.version.const).toBe("1.0");
  });
});