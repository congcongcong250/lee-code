import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  readFile,
  writeFile,
  editFile,
  resolveWithinWorkspace,
} from "../src/fileOps";

// macOS prefixes os.tmpdir() with /var which is a symlink to /private/var.
// process.cwd() returns the canonical path, so resolve through realpath to
// keep comparisons stable across platforms.
async function realTmpDir(prefix: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return await fs.realpath(raw);
}

/**
 * Workspace boundary tests.
 *
 * Each test runs against a temp workspace so we can prove that paths
 * *outside* it are rejected without depending on a specific layout of the
 * real filesystem. We also keep one test against the running process cwd to
 * confirm the default behaviour.
 */

let workspace: string;
let outside: string;
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  workspace = await realTmpDir("leecode-ws-");
  outside = await realTmpDir("leecode-outside-");
  await fs.writeFile(path.join(outside, "secret.txt"), "TOP_SECRET", "utf-8");
  process.chdir(workspace);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("resolveWithinWorkspace", () => {
  it("accepts a relative path inside the workspace", () => {
    const r = resolveWithinWorkspace("a/b.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolute).toBe(path.resolve(workspace, "a/b.txt"));
  });

  it("accepts the workspace itself", () => {
    const r = resolveWithinWorkspace(".");
    expect(r.ok).toBe(true);
  });

  it("rejects ../ escapes (regression: S2 path traversal)", () => {
    const r = resolveWithinWorkspace("../leecode-outside-secret.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside workspace/);
  });

  it("rejects nested ../ escapes", () => {
    const r = resolveWithinWorkspace("a/../../../etc/passwd");
    expect(r.ok).toBe(false);
  });

  it("rejects absolute paths outside the workspace", () => {
    const r = resolveWithinWorkspace(path.join(outside, "secret.txt"));
    expect(r.ok).toBe(false);
  });

  it("rejects empty string", () => {
    const r = resolveWithinWorkspace("");
    expect(r.ok).toBe(false);
  });

  it("does not collide on prefix-overlap (workspace=/tmp/a vs /tmp/abc)", async () => {
    // Same root tmpdir, distinct workspace names — make sure '/tmp/abc/...'
    // is NOT considered inside '/tmp/a' just because the strings share a
    // prefix. This guards against a classic startsWith bug.
    const realTmp = await fs.realpath(os.tmpdir());
    const ws = path.join(realTmp, "leecode-prefix-a");
    const cousin = path.join(realTmp, "leecode-prefix-abc", "evil.txt");
    const r = resolveWithinWorkspace(cousin, ws);
    expect(r.ok).toBe(false);
  });

  it("accepts an absolute path inside the workspace", () => {
    const target = path.join(workspace, "deep", "thing.txt");
    const r = resolveWithinWorkspace(target);
    expect(r.ok).toBe(true);
  });
});

describe("readFile / writeFile / editFile honour the boundary", () => {
  it("readFile rejects path outside cwd", async () => {
    const r = await readFile(path.join(outside, "secret.txt"));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/outside workspace/);
  });

  it("readFile rejects ../ escape", async () => {
    const r = await readFile("../leecode-outside-secret.txt");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/outside workspace/);
  });

  it("readFile works inside cwd", async () => {
    await fs.writeFile(path.join(workspace, "ok.txt"), "hello", "utf-8");
    const r = await readFile("ok.txt");
    expect(r.success).toBe(true);
    expect(r.data).toBe("hello");
  });

  it("writeFile rejects path outside cwd (regression: pre-fix would happily create files anywhere)", async () => {
    const target = path.join(outside, "should-not-write.txt");
    const r = await writeFile(target, "x");
    expect(r.success).toBe(false);
    // And the file must not exist.
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("writeFile works inside cwd and creates parent dirs", async () => {
    const r = await writeFile("nested/dir/file.txt", "hi");
    expect(r.success).toBe(true);
    const content = await fs.readFile(path.join(workspace, "nested/dir/file.txt"), "utf-8");
    expect(content).toBe("hi");
  });

  it("editFile rejects path outside cwd", async () => {
    const target = path.join(outside, "secret.txt");
    const r = await editFile(target, "TOP_SECRET", "OWNED");
    expect(r.success).toBe(false);
    // The outside file must be unchanged.
    const stillSecret = await fs.readFile(target, "utf-8");
    expect(stillSecret).toBe("TOP_SECRET");
  });
});
