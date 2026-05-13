import { describe, it, expect } from "vitest";
import { createConfirmGate, parseAnswer } from "../src/confirm";

function queuedPrompt(answers: string[]) {
  const asked: string[] = [];
  const fn = async (q: string) => {
    asked.push(q);
    const next = answers.shift();
    if (next === undefined) throw new Error("ran out of canned answers");
    return next;
  };
  return { fn, asked };
}

describe("parseAnswer", () => {
  it("recognises 'a' and 'always' as always", () => {
    expect(parseAnswer("a")).toBe("always");
    expect(parseAnswer("always")).toBe("always");
    expect(parseAnswer("ALWAYS")).toBe("always");
  });

  it("recognises 'n' and 'no' as no", () => {
    expect(parseAnswer("n")).toBe("no");
    expect(parseAnswer("no")).toBe("no");
    expect(parseAnswer(" N ")).toBe("no");
  });

  it("treats blank / unknown as yes (Enter == yes convention)", () => {
    expect(parseAnswer("")).toBe("yes");
    expect(parseAnswer("y")).toBe("yes");
    expect(parseAnswer("yes")).toBe("yes");
    expect(parseAnswer("\n")).toBe("yes");
  });
});

describe("ConfirmGate", () => {
  it("returns true on 'y'", async () => {
    const { fn } = queuedPrompt(["y"]);
    const gate = createConfirmGate(fn);
    expect(await gate.ask("runCommand", "ls")).toBe(true);
  });

  it("returns false on 'n'", async () => {
    const { fn } = queuedPrompt(["n"]);
    const gate = createConfirmGate(fn);
    expect(await gate.ask("runCommand", "rm -rf /")).toBe(false);
  });

  it("returns true on 'a' AND remembers — second call skips the prompt", async () => {
    const { fn, asked } = queuedPrompt(["a"]);
    const gate = createConfirmGate(fn);
    expect(await gate.ask("runCommand", "rm 1")).toBe(true);
    expect(gate.isAlwaysAllowed("runCommand")).toBe(true);
    // Second call: even with empty queue, we never prompt.
    expect(await gate.ask("runCommand", "rm 2")).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("'always' is scoped per tool name (allowing runCommand does not allow writeFile)", async () => {
    const { fn } = queuedPrompt(["a", "n"]);
    const gate = createConfirmGate(fn);
    expect(await gate.ask("runCommand", "ls")).toBe(true);
    expect(await gate.ask("writeFile", "secret.txt")).toBe(false);
  });

  it("reset() clears the always-allow set", async () => {
    const { fn } = queuedPrompt(["a", "n"]);
    const gate = createConfirmGate(fn);
    await gate.ask("runCommand", "x");
    expect(gate.isAlwaysAllowed("runCommand")).toBe(true);
    gate.reset();
    expect(gate.isAlwaysAllowed("runCommand")).toBe(false);
    // After reset, the next call must prompt again and uses the next answer.
    expect(await gate.ask("runCommand", "y")).toBe(false);
  });

  it("prompt text includes the tool name and the summary", async () => {
    const { fn, asked } = queuedPrompt(["y"]);
    const gate = createConfirmGate(fn);
    await gate.ask("runCommand", "rm -rf node_modules");
    expect(asked[0]).toContain("runCommand");
    expect(asked[0]).toContain("rm -rf node_modules");
    expect(asked[0]).toMatch(/y\/n\/a/i);
  });
});
