import { ToolCall } from "./tools";

export type SystemTurn = { role: "system"; text: string };
export type UserTurn = { role: "user"; text: string };
export type AssistantTurn = { role: "assistant"; text: string; toolCalls?: ToolCall[] };
export type ToolTurn = { role: "tool"; callId: string; name: string; text: string };

export type Turn = SystemTurn | UserTurn | AssistantTurn | ToolTurn;

export type AgentMode = "native" | "schema" | "text-fuzzy";

export function isAssistantTurn(t: Turn): t is AssistantTurn {
  return t.role === "assistant";
}

export function isToolTurn(t: Turn): t is ToolTurn {
  return t.role === "tool";
}
