/**
 * Interactive confirmation gate for destructive / side-effectful tools.
 *
 * Why: the agent can call runCommand (and soon writeFile/editFile) without
 * the user being aware. Once the model ingests attacker-controlled prose,
 * an unconfirmed runCommand is an RCE primitive. A simple [y/n/a] prompt
 * before each call gives the user a final veto.
 *
 * The "always" mode is per-tool and per-session — the user explicitly opts
 * in to skipping further prompts for that tool, but it resets every run.
 */

export type ConfirmAnswer = "yes" | "no" | "always";

export interface ConfirmGate {
  /**
   * Ask the user whether to allow the tool. Returns true to proceed, false
   * to cancel. If the user answered "always" for this tool earlier in the
   * session, returns true without prompting again.
   */
  ask(toolName: string, summary: string): Promise<boolean>;
  /** Test helper: clear the per-session always-allow set. */
  reset(): void;
  /** Test helper: introspect the always-allow set. */
  isAlwaysAllowed(toolName: string): boolean;
}

export type PromptFn = (question: string) => Promise<string>;

export function parseAnswer(raw: string): ConfirmAnswer {
  const t = raw.trim().toLowerCase();
  if (t === "a" || t === "always") return "always";
  if (t === "n" || t === "no") return "no";
  // Default (including blank, "y", "yes", garbage) is yes — matches the
  // industry-standard convention where pressing Enter on a [Y/n] prompt
  // means yes. Note: a strict mode would default to "no" instead; we keep
  // yes-as-default for usability.
  return "yes";
}

export function createConfirmGate(prompt: PromptFn): ConfirmGate {
  const alwaysAllow = new Set<string>();
  return {
    async ask(toolName: string, summary: string): Promise<boolean> {
      if (alwaysAllow.has(toolName)) return true;
      const raw = await prompt(
        `\nTool: ${toolName}\n  ${summary}\nAllow? [y/n/a(lways)] `
      );
      const decision = parseAnswer(raw);
      if (decision === "always") {
        alwaysAllow.add(toolName);
        return true;
      }
      return decision === "yes";
    },
    reset() {
      alwaysAllow.clear();
    },
    isAlwaysAllowed(toolName: string) {
      return alwaysAllow.has(toolName);
    },
  };
}
