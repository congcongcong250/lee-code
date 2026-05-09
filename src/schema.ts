export type ModelMode = "schema" | "native";

export interface ModelConfig {
  model: string;
  mode: ModelMode;
  description?: string;
}

export const OPENROUTER_MODELS: ModelConfig[] = [
  { model: "openrouter/free", mode: "schema", description: "Supports strict JSON schema" },
  { model: "nvidia/nemotron-3-super-120b-a12b:free", mode: "schema", description: "Supports strict JSON schema" },
  { model: "qwen/qwen3-next-80b-a3b-instruct:free", mode: "schema", description: "Supports strict JSON schema" },
  { model: "minimax/minimax-m2.5:free", mode: "native", description: "Native tool calling" },
  { model: "tencent/hy3-preview:free", mode: "native", description: "Native tool calling" },
];

export const SCHEMAS_MODELS = new Set(OPENROUTER_MODELS.filter(m => m.mode === "schema").map(m => m.model));

export interface SchemaToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface SchemaResponse {
  content: string;
  tool_calls?: SchemaToolCall[];
  version: "1.0";
}

export const SCHEMA_JSON = {
  type: "object" as const,
  properties: {
    content: {
      type: "string" as const,
      description: "Text response to display to the user",
    },
    tool_calls: {
      type: "array" as const,
      description: "Tools to call with arguments",
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const, description: "Unique call identifier" },
          name: { type: "string" as const, description: "Tool name to execute" },
          arguments: { type: "object" as const, description: "Arguments for the tool" },
        },
        required: ["id", "name", "arguments"],
      },
    },
    version: { type: "string" as const, const: "1.0" as const },
  },
  required: ["content", "version"],
};

export function parseSchemaResponse(content: string): SchemaResponse | null {
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    const codeMatch = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
    if (codeMatch) jsonStr = codeMatch[1];
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.content && parsed.version) {
      return parsed as SchemaResponse;
    }
  } catch {}
  return null;
}