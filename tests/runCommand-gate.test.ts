import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultTools } from "../src/cli";
import { createConfirmGate } from "../src/confirm";
import { clearTools, getTool } from "../src/tools";

/**
 * Integration tests that prove the confirmation gate is actually wired into
 * the runCommand tool. The gate's logic is exhaustively tested in
 * confirm.test.ts; this file proves the connection at the tool boundary.
 *
 * runCommand actually shells out (via src/shell.ts), so we keep the
 * commands trivial (`true`, `echo`) and assert on the gate's behaviour
 * rather than on shell-side effects.
 */

function queuedPrompt(answers: string[]) {
  return async () => {
    const next = answers.shift();
    if (next === undefined) throw new Error("ran out of answers");
    return next;
  };
}

describe("registerDefaultTools — runCommand gate", () => {
  beforeEach(() => clearTools());

  it("answering 'n' cancels and the shell is never invoked", async () => {
    const gate = createConfirmGate(queuedPrompt(["n"]));
    registerDefaultTools(gate);
    const tool = getTool("runCommand")!;
    const r = await tool({ command: "echo SHOULD_NOT_RUN" });
    expect(r.success).toBe(false);
    expect(r.error).toBe("Cancelled by user");
  });

  it("answering 'y' proceeds and the shell runs", async () => {
    const gate = createConfirmGate(queuedPrompt(["y"]));
    registerDefaultTools(gate);
    const tool = getTool("runCommand")!;
    const r = await tool({ command: "echo hi" });
    expect(r.success).toBe(true);
    expect(r.result).toBe("hi");
  });

  it("'always' allows subsequent calls without prompting again", async () => {
    // Only one canned answer. If the gate prompted twice, the second call
    // would throw "ran out of answers".
    const gate = createConfirmGate(queuedPrompt(["a"]));
    registerDefaultTools(gate);
    const tool = getTool("runCommand")!;
    const r1 = await tool({ command: "echo 1" });
    const r2 = await tool({ command: "echo 2" });
    expect(r1.success).toBe(true);
    expect(r1.result).toBe("1");
    expect(r2.success).toBe(true);
    expect(r2.result).toBe("2");
    expect(gate.isAlwaysAllowed("runCommand")).toBe(true);
  });

  it("missing command argument errors BEFORE prompting (no spurious prompt)", async () => {
    // No canned answers. If the gate prompted, the test would crash.
    const gate = createConfirmGate(queuedPrompt([]));
    registerDefaultTools(gate);
    const tool = getTool("runCommand")!;
    const r = await tool({});
    expect(r.success).toBe(false);
    expect(r.error).toBe("Missing command argument");
  });

  it("readFile and searchFiles are NOT gated (they are read-only)", async () => {
    const gate = createConfirmGate(queuedPrompt([])); // empty: prompting would throw
    registerDefaultTools(gate);
    const search = getTool("searchFiles")!;
    const read = getTool("readFile")!;
    // Both should run without consuming any prompt answer.
    const sr = await search({ pattern: "src/llm.ts" });
    expect(sr.success).toBe(true);
    const rr = await read({ path: "src/llm.ts" });
    expect(rr.success).toBe(true);
  });
});
