import { ToolCall } from "./tools.js";

export function fuzzyMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, "").replace(/\s+/g, "");
  return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

/**
 * Parse tool calls from LLM text output
 * Supports multiple formats (for backwards compatibility when LLM doesn't support function_calling)
 * 
 * Formats:
 * 1. [TOOL_CALL]{tool => "name", args => { --key "value" }}
 * 2. [TOOL_CALL]...[/TOOL_CALL] multiline
 * 3. <toolName(key: "value")></toolName>
 * 4. <toolName>value</toolName>
 * 5. `tool: value` backtick
 * 6. plain tool name fallback
 */
export function parseToolCallsFromText(text: string, toolNames: string[]): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // 1. Match [TOOL_CALL]{tool => "name", args => { --key "value" }} format
  const format1Re = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = format1Re.exec(text)) !== null) {
    const toolName = match[1];
    const matchedTool = toolNames.find(t => fuzzyMatch(t, toolName));
    if (matchedTool) {
      const argsStr = match[2];
      const args: Record<string, unknown> = {};
      const argRe = /--(\w+)\s+"([^"]+)"|(\w+)\s+"([^"]+)"/g;
      let argMatch: RegExpExecArray | null;
      while ((argMatch = argRe.exec(argsStr)) !== null) {
        const key = argMatch[1] || argMatch[3];
        const val = argMatch[2] || argMatch[4];
        if (key && val) args[key] = val;
      }
      if (Object.keys(args).length > 0) {
        calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: matchedTool, arguments: args });
      }
    }
  }
  
  // 2. Match multiline [TOOL_CALL]...[/TOOL_CALL] block format
  const format2Re = /\[TOOL_CALL\]\s*[\r\n]+\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\s*\}\s*\[\r\n]+\[\/TOOL_CALL\]/gi;
  while ((match = format2Re.exec(text)) !== null) {
    const toolName = match[1];
    const matchedTool = toolNames.find(t => fuzzyMatch(t, toolName));
    if (matchedTool && !calls.find(c => c.name === matchedTool)) {
      const argsStr = match[2];
      const args: Record<string, unknown> = {};
      const argRe = /--(\w+)\s+"([^"]+)"|(\w+)\s+"([^"]+)"/g;
      let argMatch: RegExpExecArray | null;
      while ((argMatch = argRe.exec(argsStr)) !== null) {
        const key = argMatch[1] || argMatch[3];
        const val = argMatch[2] || argMatch[4];
        if (key && val) args[key] = val;
      }
      if (Object.keys(args).length > 0) {
        calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: matchedTool, arguments: args });
      }
    }
  }
  
  // 3. Match XML self-closing or paired tag format: <toolName(key: "value")></toolName>
  const format3Re = /<(\w+)\((\w+):\s*"([^"]+)"[^)]*\)\/?>|<(\w+)\((\w+):\s*"([^"]+)"[^)]*\)\s*<\/\w+>/gi;
  let match3: RegExpExecArray | null;
  while ((match3 = format3Re.exec(text)) !== null) {
    const toolName = match3[1] || match3[4];
    const paramName = match3[2] || match3[5];
    const paramValue = match3[3] || match3[6];
    const matchedTool = toolNames.find(t => fuzzyMatch(t, toolName!));
    if (matchedTool && paramName && paramValue) {
      const existingCall = calls.find(c => c.name === matchedTool);
      if (existingCall) {
        existingCall.arguments[paramName] = paramValue;
      } else {
        calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: matchedTool, arguments: { [paramName]: paramValue } });
      }
    }
  }

  // 4. Match simple XML content: <toolName>value</toolName>
  const format4Re = /<(\w+)>([^<]+)<\/\1>/gi;
  let match4: RegExpExecArray | null;
  while ((match4 = format4Re.exec(text)) !== null) {
    const toolName = match4[1];
    const content = match4[2].trim();
    const matchedTool = toolNames.find(t => fuzzyMatch(t, toolName));
    if (matchedTool && content && !calls.find(c => c.name === matchedTool)) {
      calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: matchedTool, arguments: { value: content } });
    }
  }

  // 5. Match `tool: value` format  
  const inlineRe = /`(\w+):\s*(.+?)`/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineRe.exec(text)) !== null) {
    const toolName = inlineMatch[1];
    const toolValue = inlineMatch[2];
    const matchedTool = toolNames.find(t => fuzzyMatch(t, toolName));
    if (matchedTool && !calls.find(c => c.name === matchedTool)) {
      calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: matchedTool, arguments: { value: toolValue } });
    }
  }
  
  // 6. Match plain tool names (fallback)
  for (const toolName of toolNames) {
    const toolRegex = new RegExp(`\\b${toolName}\\b`, "gi");
    if (toolRegex.test(text) && !calls.find(c => c.name === toolName)) {
      calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: toolName, arguments: {} });
    }
  }
  
  return calls;
}

/**
 * Parse function call format from vLLM/SGLang server
 * This converts server's tool_calls to our ToolCall format
 * 
 * Expected vLLM response format:
 * {
 *   tool_calls: [
 *     {
 *       function: { name: "searchFiles", arguments: {...} },
 *       id: "call_123"
 *     }
 *   ]
 * }
 */
export function parseFunctionCalls(response: any): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // Handle vLLM function_calls format
  if (response.tool_calls && Array.isArray(response.tool_calls)) {
    for (const tc of response.tool_calls) {
      if (tc.function && tc.function.name) {
        calls.push({
          id: tc.id || `call_${Date.now()}_${Math.random()}`,
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string' 
            ? JSON.parse(tc.function.arguments) 
            : tc.function.arguments
        });
      }
    }
  }
  
  return calls;
}