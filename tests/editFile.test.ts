import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { editFile } from "../src/fileOps";

let workspace: string;
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), "leecode-edit-"));
  workspace = await fs.realpath(raw);
  process.chdir(workspace);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await fs.rm(workspace, { recursive: true, force: true });
});

async function seed(name: string, content: string): Promise<string> {
  const p = path.join(workspace, name);
  await fs.writeFile(p, content, "utf-8");
  return p;
}

describe("editFile — replacement semantics", () => {
  it("replaces a single occurrence", async () => {
    const p = await seed("a.txt", "hello world");
    const r = await editFile("a.txt", "world", "there");
    expect(r.success).toBe(true);
    expect(await fs.readFile(p, "utf-8")).toBe("hello there");
  });

  it("returns error when oldString not found", async () => {
    await seed("b.txt", "hello");
    const r = await editFile("b.txt", "missing", "x");
    expect(r.success).toBe(false);
    expect(r.error).toBe("String not found");
  });

  it("returns error when oldString matches multiple times and replaceAll not set", async () => {
    await seed("c.txt", "a a a");
    const r = await editFile("c.txt", "a", "b");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/matches 3 locations/);
  });

  it("replaceAll:true replaces every occurrence", async () => {
    const p = await seed("d.txt", "a-a-a");
    const r = await editFile("d.txt", "a", "b", { replaceAll: true });
    expect(r.success).toBe(true);
    expect(await fs.readFile(p, "utf-8")).toBe("b-b-b");
  });

  it("rejects empty oldString", async () => {
    await seed("e.txt", "hi");
    const r = await editFile("e.txt", "", "x");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/non-empty/);
  });
});

describe("editFile — $& injection safety (regression: B9)", () => {
  it("'$&' in newString does NOT expand to the matched text", async () => {
    const p = await seed("dollar.txt", "<HOLE>");
    const r = await editFile("dollar.txt", "<HOLE>", "before $& after");
    expect(r.success).toBe(true);
    expect(await fs.readFile(p, "utf-8")).toBe("before $& after");
  });

  it("'$1' in newString is preserved literally", async () => {
    const p = await seed("dollar2.txt", "REPLACE_ME");
    const r = await editFile("dollar2.txt", "REPLACE_ME", "code:$1");
    expect(r.success).toBe(true);
    expect(await fs.readFile(p, "utf-8")).toBe("code:$1");
  });

  it("'$$' in newString stays as '$$' (not collapsed to '$')", async () => {
    const p = await seed("dollar3.txt", "X");
    const r = await editFile("dollar3.txt", "X", "$$");
    expect(r.success).toBe(true);
    expect(await fs.readFile(p, "utf-8")).toBe("$$");
  });
});

describe("editFile — boundary still enforced", () => {
  let outside: string;
  beforeAll(async () => {
    const raw = await fs.mkdtemp(path.join(os.tmpdir(), "leecode-edit-out-"));
    outside = await fs.realpath(raw);
    await fs.writeFile(path.join(outside, "secret.txt"), "TOP", "utf-8");
  });
  it("refuses to edit files outside the workspace", async () => {
    const r = await editFile(path.join(outside, "secret.txt"), "TOP", "OWNED");
    expect(r.success).toBe(false);
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf-8")).toBe("TOP");
  });
});
