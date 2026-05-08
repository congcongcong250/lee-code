export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  message: ChatMessage;
  done: boolean;
}

export type LLMProvider = "ollama" | "openai" | "anthropic" | "groq" | "huggingface";

export interface LLMConfig {
  provider: LLMProvider;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

const DEFAULT_PROVIDER: LLMProvider = "groq";

const PROVIDER_CONFIGS: Record<LLMProvider, { baseUrl: string; defaultModel: string }> = {
  ollama: {
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-haiku-20240307",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-70b-versatile",
  },
  huggingface: {
    baseUrl: "https://api-inference.huggingface.co",
    defaultModel: "meta-llama/Llama-3.1-70b-instruct",
  },
};

function getConfig(config: Partial<LLMConfig>): LLMConfig {
  const provider = config.provider || DEFAULT_PROVIDER;
  const pc = PROVIDER_CONFIGS[provider];
  return {
    provider,
    baseUrl: config.baseUrl || pc.baseUrl,
    apiKey: config.apiKey,
    model: config.model || pc.defaultModel,
  };
}

export async function chat(
  messages: ChatMessage[],
  config: Partial<LLMConfig> = {}
): Promise<ChatResponse> {
  const cfg = getConfig(config);

  switch (cfg.provider) {
    case "ollama":
      return chatOllama(messages, cfg);
    case "openai":
    case "groq":
      return chatOpenAI(messages, cfg);
    case "anthropic":
      return chatAnthropic(messages, cfg);
    case "huggingface":
      return chatHuggingFace(messages, cfg);
    default:
      throw new Error(`Unknown provider: ${cfg.provider}`);
  }
}

async function chatOllama(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs = messages.filter((m) => m.role !== "system");

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
    message: {
      role: "assistant",
      content: data.message?.content || "",
    },
    done: data.done ?? true,
  };
}

async function chatOpenAI(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) {
    throw new Error("OpenAI requires API key. Set OPENAI_API_KEY env var.");
  }

  const payload = {
    model: cfg.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${err}`);
  }

  const data: any = await res.json();
  return {
    message: {
      role: "assistant",
      content: data.choices?.[0]?.message?.content || "",
    },
    done: true,
  };
}

async function chatAnthropic(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) {
    throw new Error("Anthropic requires API key. Set ANTHROPIC_API_KEY env var.");
  }

  const userMsg = messages.find((m) => m.role === "user");
  const systemMsg = messages.find((m) => m.role === "system");

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
    message: {
      role: "assistant",
      content: data.content?.[0]?.text || "",
    },
    done: true,
  };
}

async function chatHuggingFace(messages: ChatMessage[], cfg: LLMConfig): Promise<ChatResponse> {
  if (!cfg.apiKey) {
    throw new Error("HuggingFace requires API key. Set HF_TOKEN or HUGGINGFACE_API_KEY env var.");
  }

  const lastMsg = messages.filter((m) => m.role === "user").pop();
  const systemMsg = messages.find((m) => m.role === "system");

  const inputs = [
    ...(systemMsg ? `[INST] <<SYS>>\n${systemMsg.content}\n<</SYS>>\n\n` : ""),
    lastMsg?.content || "",
    "[/INST]",
  ].join("");

  const res = await fetch(`${cfg.baseUrl}/models/${cfg.model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ inputs }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HuggingFace error: ${res.status} ${err}`);
  }

  const data: any = await res.json();
  return {
    message: {
      role: "assistant",
      content: data[0]?.generated_text || "",
    },
    done: true,
  };
}

export function getEnvApiKey(provider: LLMProvider): string | undefined {
  switch (provider) {
    case "openai":
    case "groq":
      return process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "huggingface":
      return process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
    default:
      return undefined;
  }
}

export function listProviders(): { name: string; defaultModel: string }[] {
  return [
    { name: "groq", defaultModel: "llama-3.1-70b-versatile" },
    { name: "ollama", defaultModel: "llama3" },
    { name: "openai", defaultModel: "gpt-4o-mini" },
    { name: "anthropic", defaultModel: "claude-3-haiku-20240307" },
    { name: "huggingface", defaultModel: "meta-llama/Llama-3.1-70b-instruct" },
  ];
}