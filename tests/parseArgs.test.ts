import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli";

describe("parseArgs", () => {
  it("--debug enables debug", () => {
    expect(parseArgs(["--debug"]).debug).toBe(true);
  });

  it("-d also enables debug (regression: B21)", () => {
    expect(parseArgs(["-d"]).debug).toBe(true);
  });

  it("--verbose and -v enable verbose", () => {
    expect(parseArgs(["--verbose"]).verbose).toBe(true);
    expect(parseArgs(["-v"]).verbose).toBe(true);
  });

  it("flags can be combined", () => {
    const p = parseArgs(["-d", "-v"]);
    expect(p.debug).toBe(true);
    expect(p.verbose).toBe(true);
  });

  it("positional args collect non-flag tokens", () => {
    const p = parseArgs(["echo", "hello", "world"]);
    expect(p.positional).toEqual(["echo", "hello", "world"]);
    expect(p.debug).toBe(false);
  });

  it("unrecognised flags go to `unknown`, not positional", () => {
    const p = parseArgs(["--frobnicate", "echo", "hi"]);
    expect(p.unknown).toEqual(["--frobnicate"]);
    expect(p.positional).toEqual(["echo", "hi"]);
  });

  it("empty argv returns all defaults", () => {
    const p = parseArgs([]);
    expect(p).toEqual({ debug: false, verbose: false, positional: [], unknown: [] });
  });
});
