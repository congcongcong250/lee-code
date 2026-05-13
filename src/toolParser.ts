import { ToolCall } from "./tools.js";

export function fuzzyMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, "").replace(/\s+/g, "");
  return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

function makeId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parse tool calls from LLM text output. This is the "text-fuzzy" fallback
 * used when the model returns prose instead of a structured tool_calls
 * field (e.g. small open-source models). The native-mode and schema-mode
 * paths in llm.ts do NOT go through this code.
 *
 * Supported formats:
 *   1. [TOOL_CALL]{tool => "name", args => { --key "value" }}
 *   2. [TOOL_CALL]\n{tool => "name", args => { --key "value" }}\n[/TOOL_CALL]
 *   3. <toolName(key: "value")/> or <toolName(key: "value")></toolName>
 *   4. <toolName>value</toolName>
 *   5. `tool: value` backtick
 *
 * Notes:
 *   - The previous "plain tool name fallback" (format 6 in the old code)
 *     has been REMOVED. It fired on any prose mention of a tool name with
 *     empty arguments, which trivially triggered spam loops when the model
 *     said "you can use readFile to read…". (Review item B7.)
 *   - The old format-2 regex used `\[\r\n]+\[\/TOOL_CALL\]` which never
 *     matched a real "[/TOOL_CALL]" sentinel. It's fixed below. (B8.)
 */
export function parseToolCallsFromText(text: string, toolNames: string[]): ToolCall[] {
  const calls: ToolCall[] = [];

  function parseArgsBlob(argsStr: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const argRe = /--(\w+)\s+"([^"]+)"|(\w+)\s+"([^"]+)"/g;
    let argMatch: RegExpExecArray | null;
    while ((argMatch = argRe.exec(argsStr)) !== null) {
      const key = argMatch[1] || argMatch[3];
      const val = argMatch[2] || argMatch[4];
      if (key && val) args[key] = val;
    }
    return args;
  }

  // 1. Match [TOOL_CALL]{tool => "name", args => { --key "value" }} format
  const format1Re = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*\{([^}]+)\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = format1Re.exec(text)) !== null) {
    const matchedTool = toolNames.find(t => fuzzyMatch(t, match![1]));
    if (matchedTool) {
      const args = parseArgsBlob(match[2]);
      if (Object.keys(args).length > 0) {
        calls.push({ id: makeId(), name: matchedTool, arguments: args });
      }
    }
  }

  // 2. Match multiline [TOOL_CALL]…[/TOOL_CALL] block. (Fixed regex: the
  // old one used `\[\r\n]+\[\/TOOL_CALL\]` which never matched anything.)
  const format2Re = /\[TOOL_CALL\][\s\r\n]*\{tool\s*=>\s*"(\w+)"[\s\S]*?args\s*=>\s*\{([^}]+)\}\s*\}[\s\r\n]*\[\/TOOL_CALL\]/gi;
  while ((match = format2Re.exec(text)) !== null) {
    const matchedTool = toolNames.find(t => fuzzyMatch(t, match![1]));
    if (matchedTool && !calls.find(c => c.name === matchedTool)) {
      const args = parseArgsBlob(match[2]);
      if (Object.keys(args).length > 0) {
        calls.push({ id: makeId(), name: matchedTool, arguments: args });
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
        calls.push({ id: makeId(), name: matchedTool, arguments: { [paramName]: paramValue } });
      }
    }
  }

  // 4. Match simple XML content: <toolName>value</toolName>
  const format4Re = /<(\w+)>([^<]+)<\/\1>/gi;
  let match4: RegExpExecArray | null;
  while ((match4 = format4Re.exec(text)) !== null) {
    const matchedTool = toolNames.find(t => fuzzyMatch(t, match4![1]));
    const content = match4[2].trim();
    if (matchedTool && content && !calls.find(c => c.name === matchedTool)) {
      calls.push({ id: makeId(), name: matchedTool, arguments: { value: content } });
    }
  }

  // 5. Match `tool: value` format
  const inlineRe = /`(\w+):\s*(.+?)`/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineRe.exec(text)) !== null) {
    const matchedTool = toolNames.find(t => fuzzyMatch(t, inlineMatch![1]));
    if (matchedTool && !calls.find(c => c.name === matchedTool)) {
      calls.push({ id: makeId(), name: matchedTool, arguments: { value: inlineMatch[2] } });
    }
  }

  return calls;
}

/**
 * Parse a server-side tool_calls response (vLLM / SGLang / OpenAI-shaped).
 *
 * Defensive against malformed JSON arguments — a single unparseable call
 * must not crash the whole response. We log nothing here; the caller can
 * see that fewer ToolCalls came back than appeared on the wire.
 */
export function parseFunctionCalls(response: any): ToolCall[] {
  const calls: ToolCall[] = [];
  if (!response?.tool_calls || !Array.isArray(response.tool_calls)) return calls;

  for (const tc of response.tool_calls) {
    if (!tc?.function?.name) continue;
    let args: Record<string, unknown>;
    if (typeof tc.function.arguments === "string") {
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
    } else if (tc.function.arguments && typeof tc.function.arguments === "object") {
      args = tc.function.arguments;
    } else {
      args = {};
    }
    calls.push({
      id: tc.id || makeId(),
      name: tc.function.name,
      arguments: args,
    });
  }

  return calls;
}
