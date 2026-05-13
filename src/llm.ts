import { ToolCall } from "./tools";
import { AssistantTurn, Turn, AgentMode } from "./conversation";
import {
  LLMConfig,
  ChatMessage,
  ChatResponse,
  getEnvApiKey,
  PROVIDER_CONFIGS,
  DEFAULT_PROVIDER,
  LLMProvider,
} from "./providers";
import {
  SCHEMAS_MODELS,
  SCHEMA_JSON,
  parseSchemaResponse,
} from "./schema";
import {
  serializeForOpenAINative,
  serializeForOpenAISchema,
  serializeForOllama,
} from "./serializers";

export * from "./providers";
export * from "./schema";

/**
 * Decide the agent mode for this call.
 *
 * Caller can override via config.mode; otherwise we look up the model in
 * SCHEMAS_MODELS (OpenRouter strict-JSON models). Everything else defaults
 * to native function calling, which is the right shape for OpenAI/Groq.
 */
export function resolveMode(model: string, override?: AgentMode): AgentMode {
  if (override) return override;
  if (SCHEMAS_MODELS.has(model)) return "schema";
  return "native";
}

function safeJsonParse<T = unknown>(s: string | undefined | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * Main entry. Accepts the canonical Turn[] internal history and routes to
 * the right provider+mode combination. The serializer used is decided here,
 * never inside the provider function, so the contract is explicit.
 */
export async function chat(
  turns: Turn[],
  config: Partial<LLMConfig> = {}
): Promise<AssistantTurn> {
  const provider = (config.provider || DEFAULT_PROVIDER) as LLMProvider;
  const pc = PROVIDER_CONFIGS[provider];
  const cfg: LLMConfig = {
    provider,
    baseUrl: config.baseUrl || pc.baseUrl,
    apiKey: config.apiKey || getEnvApiKey(provider),
    model: config.model || pc.defaultModel,
    tools: config.tools,
    mode: resolveMode(config.model || pc.defaultModel, config.mode),
  };

  switch (cfg.provider) {
    case "ollama":
      return chatOllama(turns, cfg);
    case "openai":
    case "groq":
    case "openrouter":
      return chatOpenAI(turns, cfg);
    case "anthropic":
      throw new Error(
        "anthropic provider not implemented in Turn[] refactor (out of scope)"
      );
    case "huggingface":
      throw new Error(
        "huggingface provider not implemented in Turn[] refactor (out of scope)"
      );
    default:
      throw new Error(`Unknown provider: ${cfg.provider}`);
  }
}

async function chatOllama(turns: Turn[], cfg: LLMConfig): Promise<AssistantTurn> {
  const payload = {
    model: cfg.model,
    messages: serializeForOllama(turns),
    stream: false,
  };

  const res = await fetch(`${cfg.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error: ${res.status} ${err}`);
  }

  const data: any = await res.json();
  return {
    role: "assistant",
    text: data.message?.content || "",
  };
}

/**
 * OpenAI / Groq / OpenRouter dispatcher.
 *
 * Critically, native mode and schema mode produce *different* payloads:
 *
 *   native mode: sends `tools` + `tool_choice`, NO `response_format`. The
 *     model returns tool_calls in a structured field; we parse them out.
 *
 *   schema mode: sends `response_format` with strict JSON schema, NO
 *     `tools`. The model returns prose-inside-JSON-envelope; we parse the
 *     envelope and surface the `content` field as the assistant prose.
 *     CRITICALLY, we do NOT store the raw envelope into history — only
 *     the parsed content. The caller is then free to push that prose
 *     into Turn[] without polluting future requests.
 *
 * Sending both `tools` and `response_format` (the old bug) is the model
 * receiving two contradictory contracts. We refuse to do that.
 */
async function chatOpenAI(turns: Turn[], cfg: LLMConfig): Promise<AssistantTurn> {
  if (!cfg.apiKey) {
    throw new Error("API key required. Set OPENROUTER_API_KEY or other provider key.");
  }

  const mode = cfg.mode || "native";
  const wireMessages =
    mode === "schema"
      ? serializeForOpenAISchema(turns)
      : serializeForOpenAINative(turns);

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: wireMessages,
  };

  if (mode === "schema") {
    Object.assign(payload, {
      response_format: {
        type: "json_schema",
        json_schema: { name: "agent_response", strict: true, schema: SCHEMA_JSON },
      },
      provider: { require_parameters: true },
    });
  } else if (cfg.tools && cfg.tools.length > 0) {
    payload.tools = cfg.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    payload.tool_choice = "auto";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  if (cfg.baseUrl?.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://lee-code.local";
    headers["X-Title"] = "lee-code";
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error: ${res.status} ${err}`);
  }

  const data: any = await res.json();
  const assistantMsg = data.choices?.[0]?.message;
  const rawContent: string = assistantMsg?.content || "";

  if (mode === "schema") {
    const parsed = parseSchemaResponse(rawContent);
    if (parsed) {
      const toolCalls: ToolCall[] = (parsed.tool_calls || []).map((tc, i) => ({
        id: tc.id || `call_${i}`,
        name: tc.name,
        arguments: tc.arguments,
      }));
      return {
        role: "assistant",
        text: parsed.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }
    // Envelope didn't parse — surface raw content as prose so the user
    // at least sees the model's output. Don't try to extract tool calls
    // from unstructured text in schema mode; that's text-fuzzy territory.
    return { role: "assistant", text: rawContent };
  }

  // Native mode: tool_calls live on the structured field.
  const nativeCalls: ToolCall[] = (assistantMsg?.tool_calls || [])
    .map((tc: any): ToolCall | null => {
      if (!tc?.function?.name) return null;
      return {
        id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === "string"
            ? safeJsonParse(tc.function.arguments, {} as Record<string, unknown>)
            : (tc.function.arguments ?? {}),
      };
    })
    .filter((tc: ToolCall | null): tc is ToolCall => tc !== null);

  return {
    role: "assistant",
    text: rawContent,
    ...(nativeCalls.length > 0 ? { toolCalls: nativeCalls } : {}),
  };
}

/**
 * Back-compat shim. Some callers still want a ChatResponse-shaped result
 * (e.g. for response.toolCalls). Prefer chat() directly.
 */
export async function chatLegacy(
  turns: Turn[],
  config: Partial<LLMConfig> = {}
): Promise<ChatResponse> {
  const turn = await chat(turns, config);
  return {
    message: { role: "assistant", content: turn.text },
    done: true,
    toolCalls: turn.toolCalls,
  };
}

// Re-export ChatMessage for tests / legacy callers that still need it.
export { ChatMessage };

// =========================================================================
//  Streaming (Server-Sent Events).
// =========================================================================
//
// Streams the assistant response from OpenAI-compatible providers. Chunks
// of visible text are emitted to `onText` as they arrive; the function
// resolves to the complete AssistantTurn once the stream ends, including
// any tool_calls assembled from the deltas.
//
// Tool call deltas are accumulated by their `index` because OpenAI sends
// the id once and the arguments string in fragments — we have to assemble
// them in order.
//
// Schema mode: we accumulate the visible content fragments and stream them
// to the user UNCHANGED (yes, that means the user sees the raw envelope
// flow by — that's still better than nothing, and the parsed envelope is
// what we return as the AssistantTurn so history stays clean).

export interface StreamHandlers {
  /**
   * Called as soon as the chunk yields displayable text. In native mode
   * this is the assistant's prose; in schema mode this is the envelope
   * JSON streaming through.
   */
  onText: (chunk: string) => void;
}

interface NativeToolCallAccum {
  id?: string;
  name?: string;
  args: string;
}

interface SSEEvent {
  data: string;
}

/**
 * Parse a buffer of SSE-formatted text. Returns the parsed events and any
 * leftover (incomplete) text the caller should keep for the next read.
 */
export function parseSseBuffer(buffer: string): { events: SSEEvent[]; rest: string } {
  const events: SSEEvent[] = [];
  // SSE messages are separated by a blank line ("\n\n"). Keep anything
  // after the last separator for the next read.
  const lastBoundary = buffer.lastIndexOf("\n\n");
  const consumable = lastBoundary === -1 ? "" : buffer.slice(0, lastBoundary);
  const rest = lastBoundary === -1 ? buffer : buffer.slice(lastBoundary + 2);
  if (!consumable) return { events, rest };
  for (const block of consumable.split("\n\n")) {
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      else if (line.startsWith("data:")) dataLines.push(line.slice(5));
    }
    if (dataLines.length > 0) events.push({ data: dataLines.join("\n") });
  }
  return { events, rest };
}

export async function chatStream(
  turns: Turn[],
  config: Partial<LLMConfig>,
  handlers: StreamHandlers
): Promise<AssistantTurn> {
  const provider = (config.provider || DEFAULT_PROVIDER) as LLMProvider;
  const pc = PROVIDER_CONFIGS[provider];
  const cfg: LLMConfig = {
    provider,
    baseUrl: config.baseUrl || pc.baseUrl,
    apiKey: config.apiKey || getEnvApiKey(provider),
    model: config.model || pc.defaultModel,
    tools: config.tools,
    mode: resolveMode(config.model || pc.defaultModel, config.mode),
  };
  if (provider !== "openai" && provider !== "openrouter" && provider !== "groq") {
    throw new Error(`Streaming not implemented for provider: ${provider}`);
  }
  if (!cfg.apiKey) {
    throw new Error("API key required for streaming.");
  }

  const mode = cfg.mode || "native";
  const wireMessages =
    mode === "schema"
      ? serializeForOpenAISchema(turns)
      : serializeForOpenAINative(turns);

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: wireMessages,
    stream: true,
  };

  if (mode === "schema") {
    Object.assign(payload, {
      response_format: {
        type: "json_schema",
        json_schema: { name: "agent_response", strict: true, schema: SCHEMA_JSON },
      },
      provider: { require_parameters: true },
    });
  } else if (cfg.tools && cfg.tools.length > 0) {
    payload.tools = cfg.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    payload.tool_choice = "auto";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    Accept: "text/event-stream",
  };
  if (cfg.baseUrl?.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://lee-code.local";
    headers["X-Title"] = "lee-code";
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error: ${res.status} ${err}`);
  }

  if (!res.body) {
    throw new Error("Streaming response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let textAccum = "";
  const toolAccum = new Map<number, NativeToolCallAccum>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buffer);
    buffer = rest;
    for (const ev of events) {
      if (ev.data === "[DONE]") continue;
      let parsed: any;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        // Malformed chunk — skip, keep going.
        continue;
      }
      const delta = parsed?.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        textAccum += delta.content;
        handlers.onText(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tcd of delta.tool_calls) {
          const idx = typeof tcd.index === "number" ? tcd.index : 0;
          const slot = toolAccum.get(idx) ?? { args: "" };
          if (tcd.id) slot.id = tcd.id;
          if (tcd.function?.name) slot.name = tcd.function.name;
          if (typeof tcd.function?.arguments === "string") slot.args += tcd.function.arguments;
          toolAccum.set(idx, slot);
        }
      }
    }
  }
  // Flush anything still in the buffer.
  if (buffer.trim().length > 0) {
    const { events } = parseSseBuffer(buffer + "\n\n");
    for (const ev of events) {
      if (ev.data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(ev.data);
        const delta = parsed?.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          textAccum += delta.content;
          handlers.onText(delta.content);
        }
      } catch {
        // ignore
      }
    }
  }

  if (mode === "schema") {
    const parsed = parseSchemaResponse(textAccum);
    if (parsed) {
      const toolCalls: ToolCall[] = (parsed.tool_calls || []).map((tc, i) => ({
        id: tc.id || `call_${i}`,
        name: tc.name,
        arguments: tc.arguments,
      }));
      return {
        role: "assistant",
        text: parsed.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }
    return { role: "assistant", text: textAccum };
  }

  // Native mode: assemble accumulated tool calls.
  const calls: ToolCall[] = [];
  const sortedKeys = [...toolAccum.keys()].sort((a, b) => a - b);
  for (const k of sortedKeys) {
    const slot = toolAccum.get(k)!;
    if (!slot.name) continue;
    let args: Record<string, unknown> = {};
    if (slot.args) {
      args = safeJsonParse(slot.args, {});
    }
    calls.push({
      id: slot.id || `call_${k}`,
      name: slot.name,
      arguments: args,
    });
  }

  return {
    role: "assistant",
    text: textAccum,
    ...(calls.length > 0 ? { toolCalls: calls } : {}),
  };
}
