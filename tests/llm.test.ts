import { describe, it, expect, beforeEach } from "vitest";
import { registerTool, getTool, clearTools, listTools } from "../src/tools";
import { 
  SCHEMA_JSON, 
  parseSchemaResponse, 
  SchemaResponse, 
  OPENROUTER_MODELS, 
  SCHEMAS_MODELS,
  ModelMode,
  ModelConfig 
} from "../src/llm";

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
});

describe("Parse format 4: XML paired", () => {
  it("parses <tool>value</tool>", () => {
    const text = `<searchFiles>**/*.js</searchFiles>`;
    const m = /<(\w+)>([^<]+)<\/\1>/gi.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("searchFiles");
    expect(m![2]).toBe("**/*.js");
  });

  it("extracts value", () => {
    const text = "<runCommand>ls -la</runCommand>";
    const m = /<(\w+)>([^<]+)<\/\1>/gi.exec(text);
    expect(m![2]).toBe("ls -la");
  });

  it("handles long value", () => {
    const text = `<searchFiles>**/*.ts</searchFiles>`;
    const m = /<(\w+)>([^<]+)<\/\1>/gi.exec(text);
    expect(m![2]).toBe("**/*.ts");
  });
});

describe("Schema Response", () => {
  it("SCHEMA_JSON is valid object", () => {
    expect(SCHEMA_JSON.type).toBe("object");
    expect(SCHEMA_JSON.properties.status.enum).toContain("continue");
    expect(SCHEMA_JSON.properties.status.enum).toContain("finished");
    expect(SCHEMA_JSON.properties.status.enum).toContain("error");
    expect(SCHEMA_JSON.properties.status.enum).toContain("ask_user");
  });

  it("SCHEMA_JSON has version field", () => {
    expect(SCHEMA_JSON.properties.version.const).toBe("1.0");
  });

  it("parses valid JSON without markdown", () => {
    const input = JSON.stringify({
      status: "finished",
      content: "Done",
      version: "1.0"
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("finished");
    expect(result!.content).toBe("Done");
  });

  it("parses JSON in markdown code fence", () => {
    const input = '```json\n{"status": "continue", "content": "Working", "version": "1.0"}\n```';
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("continue");
    expect(result!.content).toBe("Working");
  });

  it("parses JSON in generic code fence", () => {
    const input = '```\n{"status": "finished", "content": "Done", "version": "1.0"}\n```';
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("finished");
  });

  it("parses tool_calls from schema response", () => {
    const input = JSON.stringify({
      status: "continue",
      content: "Calling tool",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "readFile", arguments: { path: "/test.js" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.tool_calls).toHaveLength(1);
    expect(result!.tool_calls![0].name).toBe("readFile");
  });

  it("returns null for invalid JSON", () => {
    expect(parseSchemaResponse("not json")).toBeNull();
    expect(parseSchemaResponse("")).toBeNull();
    expect(parseSchemaResponse("{invalid}")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(parseSchemaResponse('{"status": "finished"}')).toBeNull();
    expect(parseSchemaResponse('{"content": "hi"}')).toBeNull();
    expect(parseSchemaResponse('{"status": "hi", "content": "hi"}')).toBeNull();
  });

  it("trims whitespace", () => {
    const input = '  {"status": "finished", "content": "Hi", "version": "1.0"}  ';
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("Hi");
  });
});

describe("OPENROUTER_MODELS", () => {
  it("has 5 models defined", () => {
    expect(OPENROUTER_MODELS).toHaveLength(5);
  });

  it("models have required fields", () => {
    OPENROUTER_MODELS.forEach(m => {
      expect(m.model).toBeDefined();
      expect(m.mode).toMatch(/^(schema|native)$/);
      expect(m.description).toBeDefined();
    });
  });

  it("schema models are in SCHEMAS_MODELS set", () => {
    const schemaModels = OPENROUTER_MODELS.filter(m => m.mode === "schema").map(m => m.model);
    schemaModels.forEach(model => {
      expect(SCHEMAS_MODELS.has(model)).toBe(true);
    });
  });

  it("native models are NOT in SCHEMAS_MODELS set", () => {
    const nativeModels = OPENROUTER_MODELS.filter(m => m.mode === "native").map(m => m.model);
    nativeModels.forEach(model => {
      expect(SCHEMAS_MODELS.has(model)).toBe(false);
    });
  });

  it("openrouter/free uses schema mode", () => {
    const m = OPENROUTER_MODELS.find(x => x.model === "openrouter/free");
    expect(m?.mode).toBe("schema");
  });

  it("minimax uses native mode", () => {
    const m = OPENROUTER_MODELS.find(x => x.model === "minimax/minimax-m2.5:free");
    expect(m?.mode).toBe("native");
  });

  it("tencent uses native mode", () => {
    const m = OPENROUTER_MODELS.find(x => x.model === "tencent/hy3-preview:free");
    expect(m?.mode).toBe("native");
  });

  it("nvidia nemotron uses schema mode", () => {
    const m = OPENROUTER_MODELS.find(x => x.model === "nvidia/nemotron-3-super-120b-a12b:free");
    expect(m?.mode).toBe("schema");
  });

  it("qwen uses schema mode", () => {
    const m = OPENROUTER_MODELS.find(x => x.model === "qwen/qwen3-next-80b-a3b-instruct:free");
    expect(m?.mode).toBe("schema");
  });

  it("SCHEMAS_MODELS has 3 models", () => {
    expect(SCHEMAS_MODELS.size).toBe(3);
  });

  it("SCHEMAS_MODELS contains correct models", () => {
    expect(SCHEMAS_MODELS.has("openrouter/free")).toBe(true);
    expect(SCHEMAS_MODELS.has("nvidia/nemotron-3-super-120b-a12b:free")).toBe(true);
    expect(SCHEMAS_MODELS.has("qwen/qwen3-next-80b-a3b-instruct:free")).toBe(true);
  });

  it("SCHEMAS_MODELS does not contain native models", () => {
    expect(SCHEMAS_MODELS.has("minimax/minimax-m2.5:free")).toBe(false);
    expect(SCHEMAS_MODELS.has("tencent/hy3-preview:free")).toBe(false);
  });
});