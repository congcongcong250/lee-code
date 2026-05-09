export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

export type ToolFunction = (args: Record<string, unknown>) => Promise<ToolResult>;

const toolRegistry: Record<string, ToolFunction> = {};
const toolSchemas: Record<string, Tool> = {};

export function registerTool(name: string, fn: ToolFunction, schema?: Tool): void {
  toolRegistry[name] = fn;
  if (schema) {
    toolSchemas[name] = schema;
  }
}

export function getTool(name: string): ToolFunction | undefined {
  return toolRegistry[name];
}

export function getToolSchema(name: string): Tool | undefined {
  return toolSchemas[name];
}

export function listTools(): Record<string, ToolFunction> {
  return { ...toolRegistry };
}

export function listToolSchemas(): Tool[] {
  return Object.values(toolSchemas);
}

export function getToolSchemas(): Tool[] {
  return Object.values(toolSchemas);
}

export function clearTools(): void {
  Object.keys(toolRegistry).forEach(k => delete toolRegistry[k]);
}