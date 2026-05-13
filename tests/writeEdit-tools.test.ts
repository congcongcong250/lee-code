import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { registerDefaultTools } from "../src/cli";
import { createConfirmGate } from "../src/confirm";
import { clearTools, getTool, listToolSchemas } from "../src/tools";

/**
 * Integration tests for the writeFile / editFile agent tools.
 *
 * Each test sets up a queued mock prompt and asserts the gate + boundary
 * behave correctly through the agent-tool surface.
 */

let workspace: string;
let outside: string;
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "leecode-we-")));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "leecode-we-out-")));
  process.chdir(workspace);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

beforeEach(() => clearTools());

function queuedPrompt(answers: string[]) {
  return async () => {
    const n = answers.shift();
    if (n === undefined) throw new Error("ran out of canned answers");
    return n;
  };
}

describe("tool schemas advertised to the LLM", () => {
  it("writeFile and editFile are registered with parameter schemas", () => {
    const gate = createConfirmGate(queuedPrompt([]));
    registerDefaultTools(gate);
    const schemas = listToolSchemas();
    const names = schemas.map((s) => s.name);
    expect(names).toContain("writeFile");
    expect(names).toContain("editFile");
    const write = schemas.find((s) => s.name === "writeFile")!;
    expect(write.parameters.properties.path).toBeDefined();
    expect(write.parameters.properties.content).toBeDefined();
    const edit = schemas.find((s) => s.name === "editFile")!;
    expect(edit.parameters.properties.oldString).toBeDefined();
    expect(edit.parameters.properties.newString).toBeDefined();
  });
});

describe("writeFile tool — gating + boundary", () => {
  it("answering 'n' cancels and no file is written", async () => {
    const gate = createConfirmGate(queuedPrompt(["n"]));
    registerDefaultTools(gate);
    const r = await getTool("writeFile")!({ path: "blocked.txt", content: "boom" });
    expect(r.success).toBe(false);
    expect(r.error).toBe("Cancelled by user");
    await expect(fs.access(path.join(workspace, "blocked.txt"))).rejects.toThrow();
  });

  it("answering 'y' writes the file", async () => {
    const gate = createConfirmGate(queuedPrompt(["y"]));
    registerDefaultTools(gate);
    const r = await getTool("writeFile")!({ path: "ok.txt", content: "hello" });
    expect(r.success).toBe(true);
    const c = await fs.readFile(path.join(workspace, "ok.txt"), "utf-8");
    expect(c).toBe("hello");
  });

  it("workspace boundary rejects an outside path BEFORE writing (and after the gate)", async () => {
    const gate = createConfirmGate(queuedPrompt(["y"]));
    registerDefaultTools(gate);
    const target = path.join(outside, "evil.txt");
    const r = await getTool("writeFile")!({ path: target, content: "x" });
    expect(r.success).toBe(false);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("missing path argument short-circuits before prompting", async () => {
    const gate = createConfirmGate(queuedPrompt([])); // empty: prompting would throw
    registerDefaultTools(gate);
    const r = await getTool("writeFile")!({ content: "x" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Missing path/);
  });

  it("'always' allows subsequent writes without prompting", async () => {
    const gate = createConfirmGate(queuedPrompt(["a"]));
    registerDefaultTools(gate);
    await getTool("writeFile")!({ path: "first.txt", content: "1" });
    const r = await getTool("writeFile")!({ path: "second.txt", content: "2" });
    expect(r.success).toBe(true);
    expect(await fs.readFile(path.join(workspace, "second.txt"), "utf-8")).toBe("2");
  });
});

describe("editFile tool — gating + boundary + safe replace", () => {
  it("answering 'n' cancels and file is unchanged", async () => {
    await fs.writeFile(path.join(workspace, "keep.txt"), "hello", "utf-8");
    const gate = createConfirmGate(queuedPrompt(["n"]));
    registerDefaultTools(gate);
    const r = await getTool("editFile")!({
      path: "keep.txt",
      oldString: "hello",
      newString: "bye",
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe("Cancelled by user");
    expect(await fs.readFile(path.join(workspace, "keep.txt"), "utf-8")).toBe("hello");
  });

  it("answering 'y' replaces a unique match", async () => {
    await fs.writeFile(path.join(workspace, "doc.txt"), "hello world", "utf-8");
    const gate = createConfirmGate(queuedPrompt(["y"]));
    registerDefaultTools(gate);
    const r = await getTool("editFile")!({
      path: "doc.txt",
      oldString: "world",
      newString: "there",
    });
    expect(r.success).toBe(true);
    expect(await fs.readFile(path.join(workspace, "doc.txt"), "utf-8")).toBe("hello there");
  });

  it("non-string oldString/newString is rejected before prompting", async () => {
    const gate = createConfirmGate(queuedPrompt([])); // would crash if prompted
    registerDefaultTools(gate);
    const r = await getTool("editFile")!({
      path: "x.txt",
      oldString: 42,
      newString: "bye",
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/string oldString/);
  });

  it("workspace boundary blocks editing files outside cwd", async () => {
    const evil = path.join(outside, "secret.txt");
    await fs.writeFile(evil, "TOP", "utf-8");
    const gate = createConfirmGate(queuedPrompt(["y"]));
    registerDefaultTools(gate);
    const r = await getTool("editFile")!({
      path: evil,
      oldString: "TOP",
      newString: "OWNED",
    });
    expect(r.success).toBe(false);
    expect(await fs.readFile(evil, "utf-8")).toBe("TOP");
  });

  it("'$&' replacement is preserved literally (regression: B9, end-to-end through agent tool)", async () => {
    await fs.writeFile(path.join(workspace, "dollar.txt"), "HOLE", "utf-8");
    const gate = createConfirmGate(queuedPrompt(["y"]));
    registerDefaultTools(gate);
    const r = await getTool("editFile")!({
      path: "dollar.txt",
      oldString: "HOLE",
      newString: "before $& after",
    });
    expect(r.success).toBe(true);
    expect(await fs.readFile(path.join(workspace, "dollar.txt"), "utf-8")).toBe(
      "before $& after"
    );
  });

  it("multiple matches require replaceAll:true", async () => {
    await fs.writeFile(path.join(workspace, "many.txt"), "aaa", "utf-8");
    const gate = createConfirmGate(queuedPrompt(["y", "y"]));
    registerDefaultTools(gate);
    const r1 = await getTool("editFile")!({
      path: "many.txt",
      oldString: "a",
      newString: "b",
    });
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/matches 3 locations/);
    // Same content, now with replaceAll.
    const r2 = await getTool("editFile")!({
      path: "many.txt",
      oldString: "a",
      newString: "b",
      replaceAll: true,
    });
    expect(r2.success).toBe(true);
    expect(await fs.readFile(path.join(workspace, "many.txt"), "utf-8")).toBe("bbb");
  });
});
