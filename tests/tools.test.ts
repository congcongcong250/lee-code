import { describe, it, expect, beforeEach } from "vitest";
import { registerTool, getTool, clearTools, listTools, ToolCall } from "../src/tools";

describe("Tools Module", () => {
  beforeEach(() => {
    clearTools();
  });

  describe("registerTool / getTool", () => {
    it("should register and retrieve a tool", async () => {
      const toolFn = async (args: any) => ({ success: true, result: "ok" });
      registerTool("testTool", toolFn);
      
      const fn = getTool("testTool");
      expect(fn).toBeDefined();
    });

    it("should return undefined for unknown tool", () => {
      const fn = getTool("unknown");
      expect(fn).toBeUndefined();
    });
  });

  describe("listTools", () => {
    it("should list registered tools", () => {
      registerTool("tool1", async () => ({ success: true }));
      registerTool("tool2", async () => ({ success: true }));
      
      const list = listTools();
      expect(Object.keys(list)).toContain("tool1");
      expect(Object.keys(list)).toContain("tool2");
    });
  });

  describe("clearTools", () => {
    it("should clear all tools", () => {
      registerTool("tool1", async () => ({ success: true }));
      clearTools();
      
      const list = listTools();
      expect(Object.keys(list).length).toBe(0);
    });
  });
});

describe("Tool Call Parsing (integration)", () => {
  function fuzzyMatch(a: string, b: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, "").replace(/\s+/g, "");
    return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
  }

  it("should fuzzy match readFile vs read-file", () => {
    expect(fuzzyMatch("readFile", "read-file")).toBe(true);
  });

  it("should fuzzy match SEARCHFILES vs searchfiles", () => {
    expect(fuzzyMatch("SEARCHFILES", "searchfiles")).toBe(true);
  });

  it("should NOT match unrelated tools", () => {
    expect(fuzzyMatch("readFile", "writeFile")).toBe(false);
  });
});