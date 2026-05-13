import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { saveSession, loadSession, defaultSessionPath, SESSION_DIR } from "../src/session";
import { Turn } from "../src/conversation";

let workspace: string;
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "leecode-session-")));
  process.chdir(workspace);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await fs.rm(workspace, { recursive: true, force: true });
});

const sampleTurns: Turn[] = [
  { role: "system", text: "sys" },
  { role: "user", text: "hello" },
  {
    role: "assistant",
    text: "calling tool",
    toolCalls: [{ id: "c1", name: "searchFiles", arguments: { pattern: "*.ts" } }],
  },
  { role: "tool", callId: "c1", name: "searchFiles", text: '["a.ts"]' },
  { role: "assistant", text: "done" },
];

describe("saveSession / loadSession — round-trip", () => {
  it("writes a JSON file under .lee-sessions and round-trips turns", async () => {
    const file = await saveSession({
      sessionId: "round-trip-1",
      turns: sampleTurns,
      provider: "openrouter",
      model: "qwen/qwen3-next-80b-a3b-instruct:free",
    });
    expect(file).toBe(defaultSessionPath("round-trip-1"));
    const loaded = await loadSession(file);
    expect(loaded.sessionId).toBe("round-trip-1");
    expect(loaded.provider).toBe("openrouter");
    expect(loaded.model).toBe("qwen/qwen3-next-80b-a3b-instruct:free");
    expect(loaded.turns).toEqual(sampleTurns);
  });

  it("creates the session directory if missing", async () => {
    const dir = path.join(workspace, "fresh-dir");
    await saveSession({ sessionId: "x", turns: sampleTurns, dir });
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("session content is human-readable (pretty-printed)", async () => {
    const file = await saveSession({ sessionId: "pretty", turns: sampleTurns });
    const raw = await fs.readFile(file, "utf-8");
    // Pretty JSON has a newline after the opening brace.
    expect(raw.split("\n").length).toBeGreaterThan(5);
  });

  it("stable savedAt when supplied (for deterministic tests)", async () => {
    const file = await saveSession({
      sessionId: "fixed",
      turns: [],
      savedAt: "2026-05-14T00:00:00.000Z",
    });
    const loaded = await loadSession(file);
    expect(loaded.savedAt).toBe("2026-05-14T00:00:00.000Z");
  });
});

describe("loadSession — validation", () => {
  it("rejects non-JSON", async () => {
    const f = path.join(workspace, "garbage.json");
    await fs.writeFile(f, "not json", "utf-8");
    await expect(loadSession(f)).rejects.toThrow(/not valid JSON/);
  });

  it("rejects wrong version", async () => {
    const f = path.join(workspace, "old.json");
    await fs.writeFile(
      f,
      JSON.stringify({ version: 99, sessionId: "x", savedAt: "x", turns: [] })
    );
    await expect(loadSession(f)).rejects.toThrow(/Unsupported session version/);
  });

  it("rejects missing turns array", async () => {
    const f = path.join(workspace, "no-turns.json");
    await fs.writeFile(
      f,
      JSON.stringify({ version: 1, sessionId: "x", savedAt: "y" })
    );
    await expect(loadSession(f)).rejects.toThrow(/turns array/);
  });

  it("rejects unknown turn role (refuses to corrupt history)", async () => {
    const f = path.join(workspace, "bad-role.json");
    await fs.writeFile(
      f,
      JSON.stringify({
        version: 1,
        sessionId: "x",
        savedAt: "y",
        turns: [{ role: "ghost", text: "boo" }],
      })
    );
    await expect(loadSession(f)).rejects.toThrow(/Unknown turn role/);
  });

  it("rejects tool turn missing callId", async () => {
    const f = path.join(workspace, "bad-tool.json");
    await fs.writeFile(
      f,
      JSON.stringify({
        version: 1,
        sessionId: "x",
        savedAt: "y",
        turns: [{ role: "tool", name: "f", text: "r" }],
      })
    );
    await expect(loadSession(f)).rejects.toThrow(/callId/);
  });

  it("rejects assistant turn with non-array toolCalls", async () => {
    const f = path.join(workspace, "bad-asst.json");
    await fs.writeFile(
      f,
      JSON.stringify({
        version: 1,
        sessionId: "x",
        savedAt: "y",
        turns: [{ role: "assistant", text: "x", toolCalls: "nope" }],
      })
    );
    await expect(loadSession(f)).rejects.toThrow(/toolCalls/);
  });
});

describe("defaultSessionPath", () => {
  it("places files under SESSION_DIR by default", () => {
    expect(defaultSessionPath("abc")).toBe(path.join(SESSION_DIR, "abc.json"));
  });
});
