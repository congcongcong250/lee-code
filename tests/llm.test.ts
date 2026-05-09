import { describe, it, expect } from "vitest";
import { parseSchemaResponse, SCHEMA_JSON, OPENROUTER_MODELS, SCHEMAS_MODELS } from "../src/schema";

describe("Schema Response Parsing - Error Handling", () => {
  it("parses error status and displays message", () => {
    const input = JSON.stringify({
      status: "error",
      content: "Failed to retrieve tools",
      version: "1.0"
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("error");
    expect(result!.content).toBe("Failed to retrieve tools");
  });

  it("parses finished status", () => {
    const input = JSON.stringify({
      status: "finished",
      content: "Done",
      version: "1.0"
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("finished");
  });

  it("parses continue status with tool_calls", () => {
    const input = JSON.stringify({
      status: "continue",
      content: "Working",
      version: "1.0",
      tool_calls: [
        { id: "call_1", name: "readFile", arguments: { path: "a.ts" } }
      ]
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("continue");
    expect(result!.tool_calls).toHaveLength(1);
    expect(result!.tool_calls![0].name).toBe("readFile");
  });

  it("handles error with tool_calls count in message", () => {
    const input = JSON.stringify({
      status: "error",
      content: "Error invoking MCP tool: permission denied",
      version: "1.0"
    });
    const result = parseSchemaResponse(input);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("error");
    expect(result!.content).toContain("Error");
  });

  it("returns null for non-JSON", () => {
    expect(parseSchemaResponse("not json")).toBeNull();
    expect(parseSchemaResponse("")).toBeNull();
  });
});

describe("OPENROUTER_MODELS configuration", () => {
  it("has schema models defined", () => {
    const schemaModels = OPENROUTER_MODELS.filter(m => m.mode === "schema");
    expect(schemaModels.length).toBeGreaterThan(0);
  });

  it("SCHEMAS_MODELS contains correct models", () => {
    expect(SCHEMAS_MODELS.has("openrouter/free")).toBe(true);
    expect(SCHEMAS_MODELS.has("nvidia/nemotron-3-super-120b-a12b:free")).toBe(true);
  });

  it("native models NOT in SCHEMAS_MODELS", () => {
    expect(SCHEMAS_MODELS.has("minimax/minimax-m2.5:free")).toBe(false);
    expect(SCHEMAS_MODELS.has("tencent/hy3-preview:free")).toBe(false);
  });
});

describe("SCHEMA_JSON structure", () => {
  it("has status enum with error", () => {
    expect(SCHEMA_JSON.properties.status.enum).toContain("error");
  });

  it("has all required fields", () => {
    expect(SCHEMA_JSON.required).toContain("status");
    expect(SCHEMA_JSON.required).toContain("content");
    expect(SCHEMA_JSON.required).toContain("version");
  });
});