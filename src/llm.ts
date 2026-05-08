import { Tool, ToolCall } from "./tools";
import { LLMProvider, LLMConfig, ChatMessage, ChatResponse, getEnvApiKey, listProviders, PROVIDER_CONFIGS, DEFAULT_PROVIDER } from "./providers";
import { SCHEMAS_MODELS, SCHEMA_JSON, parseSchemaResponse, OPENROUTER_MODELS } from "./schema";

export * from "./providers";
export * from "./schema";

export async function chat(messages: ChatMessage[], config: Partial<LLMConfig> = {}): Promise<ChatResponse> {
  const provider = config.provider || DEFAULT_PROVIDER;
  const pc = PROVIDER_CONFIGS[provider];
  const cfg: LLMConfig = {
    provider,
    baseUrl: config.baseUrl || pc.baseUrl,
    apiKey: config.apiKey || getEnvApiKey(provider),
    model: config.model || pc.defaultModel,
    tools: config.tools,
  };

  switch (cfg.provider) {
    case "ollama": return chatOllama(messages, cfg);
    case "openai":
    case "groq":
    case "openrouter": return chatOpenAI(messages, cfg);
    case "anthropic": return chatAnthropic(messages, cfg);
    case "huggingface": return chatHuggingFace(messages, cfg);
    default: throw new Error(`Unknown provider: ${cfg.provider}`);
  }
}

async function chatOllama(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system");

  const payload = {
    model: cfg.model,
    messages: [
      ...(systemMsg ? [{ role: "system", content: systemMsg.content }] : []),
      ...userMsgs,
    ],
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
    message: { role: "assistant", content: data.message?.content || "" },
    done: data.done ?? true,
  };
}

async function chatOpenAI(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) {
    throw new Error("API key required. Set OPENROUTER_API_KEY or other provider key.");
  }

  const useSchema = cfg.baseUrl?.includes("openrouter.ai") && SCHEMAS_MODELS.has(cfg.model);

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };

  if (useSchema) {
    Object.assign(payload, {
      response_format: {
        type: "json_schema",
        json_schema: { name: "agent_response", strict: true, schema: SCHEMA_JSON },
      },
      provider: { require_parameters: true },
    });
  }

  if (cfg.tools && cfg.tools.length > 0) {
    payload.tools = cfg.tools.map(t => ({
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
  
  let toolCalls: ToolCall[] = assistantMsg?.tool_calls?.map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  })) || [];

  const contentStr = assistantMsg?.content || "";
  if (useSchema && toolCalls.length === 0 && contentStr) {
    const schemaResp = parseSchemaResponse(contentStr);
    if (schemaResp?.tool_calls) {
      toolCalls = schemaResp.tool_calls.map((tc, i) => ({
        id: tc.id || `call_${i}`,
        name: tc.name,
        arguments: tc.arguments,
      }));
    }
  }

  return {
    message: { role: "assistant", content: contentStr },
    done: true,
    toolCalls,
  };
}

async function chatAnthropic(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) throw new Error("Anthropic requires API key.");
  
  const userMsg = messages.find(m => m.role === "user");
  const systemMsg = messages.find(m => m.role === "system");

  const payload = {
    model: cfg.model,
    max_tokens: 1024,
    messages: [
      ...(systemMsg ? [{ role: "user", content: systemMsg.content }] : []),
      ...(userMsg ? [{ role: "user", content: userMsg.content }] : []),
    ],
  };

  const res = await fetch(`${cfg.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error: ${res.status} ${err}`);
  }

  const data: any = await res.json();
  return {
    message: { role: "assistant", content: data.content?.[0]?.text || "" },
    done: data.stop_reason !== null,
  };
}

async function chatHuggingFace(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) throw new Error("HuggingFace requires API key.");
  
  const lastMsg = messages[messages.length - 1];
  const res = await fetch(`${cfg.baseUrl}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ inputs: lastMsg.content, parameters: { max_new_tokens: 512 } }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HF error: ${res.status} ${err}`);
  }

  const data: any = await res.json();
  const text = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
  
  return {
    message: { role: "assistant", content: text || "" },
    done: true,
  };
}