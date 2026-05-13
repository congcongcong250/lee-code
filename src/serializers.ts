import { Turn } from "./conversation";

/**
 * Wire-format types for downstream provider HTTP payloads.
 *
 * These are intentionally narrow: enough to round-trip the canonical Turn[]
 * shape through each provider+mode, no more. The serializer's job is to
 * preserve the ordering invariant required by the provider (e.g. native
 * tool_call_id round-trip on OpenAI) and to NEVER push raw protocol
 * envelopes back into prompt history.
 */
export interface OpenAIWireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface OllamaWireMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Native function-calling serializer (OpenAI / Groq / OpenRouter native models).
 *
 * Preserves assistant.tool_calls and tool.tool_call_id verbatim so the API's
 * ordering invariant (assistant-with-tool_calls followed by N matching tool
 * messages) is enforced by construction.
 */
export function serializeForOpenAINative(turns: Turn[]): OpenAIWireMessage[] {
  const out: OpenAIWireMessage[] = [];
  for (const t of turns) {
    if (t.role === "system") {
      out.push({ role: "system", content: t.text });
    } else if (t.role === "user") {
      out.push({ role: "user", content: t.text });
    } else if (t.role === "assistant") {
      const msg: OpenAIWireMessage = {
        role: "assistant",
        content: t.text || null,
      };
      if (t.toolCalls && t.toolCalls.length > 0) {
        msg.tool_calls = t.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        }));
      }
      out.push(msg);
    } else if (t.role === "tool") {
      out.push({
        role: "tool",
        content: t.text,
        tool_call_id: t.callId,
      });
    }
  }
  return out;
}

/**
 * Schema mode serializer (OpenRouter strict JSON-schema fallback).
 *
 * The protocol has no `tool` role concept here. Assistant turns surface as
 * plain prose (NOT the raw JSON envelope). Tool results are smuggled back as
 * labeled user messages so the model can read them.
 *
 * Format for tool result: `[tool_result name=<name> id=<callId>]\n<content>`
 *
 * Why this format: schema-mode models only see what the system prompt
 * teaches them. The system prompt MUST document this format so the model
 * knows how to interpret the labeled user messages.
 */
export function serializeForOpenAISchema(turns: Turn[]): OpenAIWireMessage[] {
  const out: OpenAIWireMessage[] = [];
  for (const t of turns) {
    if (t.role === "system") {
      out.push({ role: "system", content: t.text });
    } else if (t.role === "user") {
      out.push({ role: "user", content: t.text });
    } else if (t.role === "assistant") {
      // CRITICAL: surface the parsed prose, NOT the raw JSON envelope.
      // If the upstream code mistakenly stored an envelope, we still send
      // its text; but the agent loop is responsible for ensuring t.text is
      // the user-facing content field, not the raw response body.
      out.push({ role: "assistant", content: t.text });
    } else if (t.role === "tool") {
      out.push({
        role: "user",
        content: `[tool_result name=${t.name} id=${t.callId}]\n${t.text}`,
      });
    }
  }
  return out;
}

/**
 * Ollama serializer.
 *
 * Ollama (in chat mode) doesn't natively understand the tool role nor
 * tool_call_id. We coerce tool round-trips into prose so multi-turn loops
 * stay coherent for local models.
 */
export function serializeForOllama(turns: Turn[]): OllamaWireMessage[] {
  const out: OllamaWireMessage[] = [];
  for (const t of turns) {
    if (t.role === "system") {
      out.push({ role: "system", content: t.text });
    } else if (t.role === "user") {
      out.push({ role: "user", content: t.text });
    } else if (t.role === "assistant") {
      const parts: string[] = [];
      if (t.text) parts.push(t.text);
      if (t.toolCalls && t.toolCalls.length > 0) {
        for (const tc of t.toolCalls) {
          parts.push(
            `[tool_call name=${tc.name} id=${tc.id}]\n${JSON.stringify(tc.arguments ?? {})}`
          );
        }
      }
      out.push({ role: "assistant", content: parts.join("\n") });
    } else if (t.role === "tool") {
      out.push({
        role: "user",
        content: `[tool_result name=${t.name} id=${t.callId}]\n${t.text}`,
      });
    }
  }
  return out;
}
