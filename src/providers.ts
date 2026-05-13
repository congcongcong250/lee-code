import { AgentMode } from "./conversation";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  message: ChatMessage;
  done: boolean;
  toolCalls?: any[];
}

export type LLMProvider = "ollama" | "openai" | "anthropic" | "groq" | "huggingface" | "openrouter";

export interface LLMConfig {
  provider: LLMProvider;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  tools?: any[];
  mode?: AgentMode;
}

export interface LLMProviderConfig {
  baseUrl: string;
  defaultModel: string;
}

export const PROVIDER_CONFIGS: Record<LLMProvider, LLMProviderConfig> = {
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "llama3" },
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-haiku-20240307" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
  huggingface: { baseUrl: "https://api-inference.huggingface.co", defaultModel: "meta-llama/Llama-3.1-70b-instruct" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "qwen/qwen3-next-80b-a3b-instruct:free" },
};

export const DEFAULT_PROVIDER: LLMProvider = "openrouter";

export function getEnvApiKey(provider: LLMProvider): string | undefined {
  switch (provider) {
    case "openrouter": return process.env.OPENROUTER_API_KEY;
    case "openai": return process.env.OPENAI_API_KEY;
    case "groq": return process.env.GROQ_API_KEY;
    case "anthropic": return process.env.ANTHROPIC_API_KEY;
    case "huggingface": return process.env.HF_TOKEN;
    default: return undefined;
  }
}

export function listProviders(): { name: string; defaultModel: string }[] {
  return [
    { name: "openrouter", defaultModel: "qwen/qwen3-next-80b-a3b-instruct:free" },
    { name: "groq", defaultModel: "llama-3.3-70b-versatile" },
    { name: "ollama", defaultModel: "llama3" },
    { name: "openai", defaultModel: "gpt-4o-mini" },
    { name: "anthropic", defaultModel: "claude-3-haiku-20240307" },
    { name: "huggingface", defaultModel: "meta-llama/Llama-3.1-70b-instruct" },
  ];
}
