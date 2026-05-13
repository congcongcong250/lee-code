import { describe, it, expect } from "vitest";
import { PROVIDER_CONFIGS, listProviders } from "../src/providers";
import { SCHEMAS_MODELS } from "../src/schema";
import { getState } from "../src/state";

describe("default OpenRouter model (regression: B6, non-existent default)", () => {
  it("PROVIDER_CONFIGS.openrouter.defaultModel exists in the OpenRouter model list", () => {
    const m = PROVIDER_CONFIGS.openrouter.defaultModel;
    expect(SCHEMAS_MODELS.has(m) || /minimax|tencent/.test(m)).toBe(true);
  });

  it("listProviders() openrouter entry matches PROVIDER_CONFIGS", () => {
    const lp = listProviders().find((p) => p.name === "openrouter");
    expect(lp).toBeDefined();
    expect(lp!.defaultModel).toBe(PROVIDER_CONFIGS.openrouter.defaultModel);
  });

  it("initial AppState.model matches the default", () => {
    const s = getState();
    expect(s.model).toBe(PROVIDER_CONFIGS.openrouter.defaultModel);
  });

  it("default is NOT the previously-broken nemotron string", () => {
    expect(PROVIDER_CONFIGS.openrouter.defaultModel).not.toBe(
      "nvidia/nemotron-3-super-120b-a12b:free"
    );
  });
});
