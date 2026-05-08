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

export function registerTool(name: string, fn: ToolFunction): void {
  toolRegistry[name] = fn;
}

export function getTool(name: string): ToolFunction | undefined {
  return toolRegistry[name];
}

export function listTools(): Record<string, ToolFunction> {
  return { ...toolRegistry };
}

export function getToolsSchema(): Tool[] {
  return Object.entries(toolRegistry).map(([name, fn]) => ({
    name,
    description: `Tool: ${name}`,
    parameters: { type: "object", properties: {} },
  }));
}

export function clearTools(): void {
  Object.keys(toolRegistry).forEach(k => delete toolRegistry[k]);
}