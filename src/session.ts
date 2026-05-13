import * as fs from "fs/promises";
import * as path from "path";
import { Turn } from "./conversation";

/**
 * Session file format. v1 is intentionally minimal — just enough to
 * round-trip the canonical Turn[] across runs.
 *
 * If the format needs to change later (e.g. embedding tool definitions
 * with the session), bump `version` and add a migration in loadSession.
 */
export interface SessionFile {
  version: 1;
  sessionId: string;
  savedAt: string;
  provider?: string;
  model?: string;
  turns: Turn[];
}

export const SESSION_DIR = ".lee-sessions";

export function defaultSessionPath(sessionId: string, dir: string = SESSION_DIR): string {
  return path.join(dir, `${sessionId}.json`);
}

export interface SaveSessionOptions {
  sessionId: string;
  turns: Turn[];
  provider?: string;
  model?: string;
  /** Directory to write the session file. Defaults to .lee-sessions. */
  dir?: string;
  /** Override the timestamp (used by tests for deterministic output). */
  savedAt?: string;
}

export async function saveSession(opts: SaveSessionOptions): Promise<string> {
  const dir = opts.dir ?? SESSION_DIR;
  await fs.mkdir(dir, { recursive: true });
  const file: SessionFile = {
    version: 1,
    sessionId: opts.sessionId,
    savedAt: opts.savedAt ?? new Date().toISOString(),
    provider: opts.provider,
    model: opts.model,
    turns: opts.turns,
  };
  const fullPath = path.join(dir, `${opts.sessionId}.json`);
  await fs.writeFile(fullPath, JSON.stringify(file, null, 2), "utf-8");
  return fullPath;
}

export interface LoadedSession {
  sessionId: string;
  savedAt: string;
  provider?: string;
  model?: string;
  turns: Turn[];
}

/**
 * Load a session file. We validate the version, that turns is an array,
 * and that each turn has a known role with the right shape. Anything
 * malformed throws — we'd rather refuse to load than corrupt the agent's
 * working history.
 */
export async function loadSession(filePath: string): Promise<LoadedSession> {
  const raw = await fs.readFile(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Session file is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Session file is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`Unsupported session version: ${obj.version}`);
  }
  if (typeof obj.sessionId !== "string" || typeof obj.savedAt !== "string") {
    throw new Error("Session file missing sessionId / savedAt");
  }
  if (!Array.isArray(obj.turns)) {
    throw new Error("Session file missing turns array");
  }
  const turns = obj.turns.map(validateTurn);
  return {
    sessionId: obj.sessionId,
    savedAt: obj.savedAt,
    provider: typeof obj.provider === "string" ? obj.provider : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
    turns,
  };
}

function validateTurn(t: unknown): Turn {
  if (!t || typeof t !== "object") throw new Error("Turn must be an object");
  const o = t as Record<string, unknown>;
  switch (o.role) {
    case "system":
    case "user":
      if (typeof o.text !== "string") throw new Error(`${o.role} turn missing text`);
      return { role: o.role, text: o.text };
    case "assistant":
      if (typeof o.text !== "string") throw new Error("assistant turn missing text");
      if (o.toolCalls !== undefined && !Array.isArray(o.toolCalls)) {
        throw new Error("assistant.toolCalls must be an array");
      }
      return {
        role: "assistant",
        text: o.text,
        ...(o.toolCalls ? { toolCalls: o.toolCalls as Turn extends { toolCalls?: infer X } ? X : never } : {}),
      } as Turn;
    case "tool":
      if (
        typeof o.callId !== "string" ||
        typeof o.name !== "string" ||
        typeof o.text !== "string"
      ) {
        throw new Error("tool turn missing callId / name / text");
      }
      return { role: "tool", callId: o.callId, name: o.name, text: o.text };
    default:
      throw new Error(`Unknown turn role: ${String(o.role)}`);
  }
}
