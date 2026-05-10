#!/usr/bin/env node

import * as dotenv from "dotenv";
dotenv.config();

import { chat, ChatMessage, LLMProvider, getEnvApiKey, ChatResponse, OPENROUTER_MODELS, listProviders } from "./llm";
import { registerTool, getTool, listTools, listToolSchemas, Tool } from "./tools";
import { debug, setLogLevel, setVerboseMode, logLLM, saveLLMLogs } from "./debug";
import { parseToolCallsFromText, parseFunctionCalls } from "./toolParser";
import { loadProjectContext } from "./context";
import { searchFiles, readFile } from "./fileOps";
import { runCommand } from "./shell";
import { COLORS, printHeader, printAssistant, printTool, printResult, printError, printSuccess, createSpinner, enableColors } from "./ui";
import { parseSchemaResponse } from "./schema";
import { getState, setProvider, setModel } from "./state";

enableColors();

const toolSchemas: Tool[] = [
  {
    name: "searchFiles",
    description: "Find files using glob pattern",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g., **/*.ts, *.js)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "readFile",
    description: "Read file contents",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "runCommand",
    description: "Run shell command",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
  },
];

for (const ts of toolSchemas) {
  if (ts.name === "searchFiles") {
    registerTool(ts.name, async (args) => {
      try {
        const pattern = (args.pattern || args.path) as string;
        if (!pattern) return { success: false, error: "Missing pattern argument" };
        const files = await searchFiles(pattern);
        return { success: true, result: JSON.stringify(files) };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }, ts);
  } else if (ts.name === "readFile") {
    registerTool(ts.name, async (args) => {
      try {
        const filePath = (args.path || args.filePath) as string;
        if (!filePath) return { success: false, error: "Missing path argument" };
        const result = await readFile(filePath);
        if (result.success) {
          return { success: true, result: result.data || "" };
        } else {
          return { success: false, error: result.error || "Read failed" };
        }
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }, ts);
  } else if (ts.name === "runCommand") {
    registerTool(ts.name, async (args) => {
      try {
        const command = (args.command || args.cmd) as string;
        if (!command) return { success: false, error: "Missing command argument" };
        const result = await runCommand(command);
        const output = result.success 
          ? (result.stdout || "") 
          : (result.error || "Command failed");
        return { success: true, result: output };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }, ts);
  }
}

const MAX_ITERATIONS = 10;

export async function promptQuestion(question: string): Promise<string> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getLLMResponse(userInput: string, history: ChatMessage[]): Promise<string> {
  const state = getState();
  const context = await loadProjectContext(process.cwd());
  debug("getLLMResponse", { userInput, iteration: 0 });
  
  const systemPrompt = `You are lee-code, a CLI coding assistant.

You have these tools:
- readFile(path): Read a file
- searchFiles(pattern): Find files using glob 
- runCommand(command): Run a shell command

IMPORTANT: When you need to use a tool, call it properly. If the user asks about code, search or read files first.

Project context:
${context}

Respond concisely. Use tools when needed.`;

  async function executeToolCalls(
    toolCalls: { id?: string; name: string; arguments: Record<string, unknown> }[],
    iteration: number
  ): Promise<{ messages: ChatMessage[]; toolCount: number }> {
    const state = getState();
    const provider = state.provider as LLMProvider;
    const model = state.model;
    const newMessages: ChatMessage[] = [];
    
    for (const tc of toolCalls) {
      const fn = getTool(tc.name);
      if (fn) {
        const result = await fn(tc.arguments);
        const fullResult = result.success ? (result.result || "") : (result.error || "Error");
        const displayResult = fullResult.length > 200 
          ? fullResult.slice(0, 200) + "......" + fullResult.slice(-50) 
          : fullResult;
        printResult(displayResult);
        logLLM("tool_result", fullResult, { provider, model, iteration, toolCalls: tc.name });
        newMessages.push({ role: "tool", content: fullResult, toolCallId: tc?.id || "call_0" });
      } else {
        printError(`Unknown tool: ${tc.name}`);
        newMessages.push({ role: "user", content: `Unknown tool: ${tc.name}` });
      }
    }
    
    return { messages: newMessages, toolCount: toolCalls.length };
  }

  let messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userInput },
  ];

  const provider = state.provider as LLMProvider;
  const model = state.model;
  const loadingSpinner = createSpinner();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    try {
      const msgCountBefore = messages.length;
      debug(`Iteration ${i + 1}: Calling LLM`, { provider, model, messagesIn: msgCountBefore });
      
      const cfg: any = { provider, model, tools: listToolSchemas() };
      if (state.customBaseUrl) cfg.baseUrl = state.customBaseUrl;
      if (["openai", "anthropic", "groq", "huggingface", "openrouter"].includes(provider)) {
        cfg.apiKey = state.apiKey || getEnvApiKey(provider);
      }
      
      loadingSpinner.start();
      const startTime = Date.now();
      const response: ChatResponse = await chat(messages, cfg);
loadingSpinner.stop();
      const duration = Date.now() - startTime;
      
      const respContent = response.message.content;
      logLLM("assistant", respContent, { provider, model, iteration: i + 1, duration });
      saveLLMLogs();
      
      // Try to parse schema response for schema-mode models
      const schemaResp = parseSchemaResponse(respContent);
      if (schemaResp) {
        // For schema responses, show message
        const msg = schemaResp.content || "";
        if (msg) {
          printAssistant(msg);
        }
        
        // Extract tool_calls from schema JSON
        const toolCalls = schemaResp.tool_calls || [];
        if (toolCalls.length > 0) {
          console.log("");
          printTool(toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 50)})`).join(", "));
          
          const { messages: toolMsgs, toolCount } = await executeToolCalls(toolCalls, i + 1);
          messages.push({ role: "assistant", content: respContent });
          messages.push(...toolMsgs);
          debug(`Iteration ${i + 1}: Added ${toolCount + 1} messages`, { totalMessages: messages.length });
          saveLLMLogs();
          continue;
        }
        
        // Schema has content but no tools - return message
        return msg;
      }
      
      // Non-schema response - show content
      const displayContent = respContent.slice(0, 500);
      if (displayContent) {
        printAssistant(displayContent);
      }
      
      // Try tool calls
      let toolCalls = response.toolCalls || [];
      if (toolCalls.length === 0) toolCalls = parseFunctionCalls(response);
      if (toolCalls.length === 0) {
        toolCalls = parseToolCallsFromText(response.message.content, Object.keys(listTools()));
      }
      
      if (toolCalls.length > 0) {
        console.log("");
        printTool(toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 50)})`).join(", "));
        
        debug("Executing tools", { count: toolCalls.length });
        const { messages: toolMsgs, toolCount } = await executeToolCalls(toolCalls, i + 1);
        messages.push({ role: "assistant", content: respContent });
        messages.push(...toolMsgs);
        debug(`Iteration ${i + 1}: Added ${toolCount + 1} messages`, { totalMessages: messages.length });
        saveLLMLogs();
      } else {
        return respContent;
      }
    } catch (error) {
      printError((error as Error).message);
      return `Error: ${(error as Error).message}`;
    }
  }
  
  return "Max iterations reached";
}

async function startInteractive() {
  const state = getState();
  
  printHeader();
  
  console.log(`${COLORS.gray}Provider: ${state.provider} (${state.model})${COLORS.reset}`);
  console.log(`${COLORS.gray}Commands: :quit, :help, :clear, :provider, :files, :context${COLORS.reset}`);
  console.log("");

  let history: ChatMessage[] = [];
  let running = true;

  while (running) {
    const input = await promptQuestion("❯ ");
    console.log("");
    const cmd = input.trim().toLowerCase();

    if (cmd === ":quit" || cmd === ":q") {
      running = false;
      printSuccess("Goodbye!");
    } else if (cmd === ":help") {
      console.log(`${COLORS.cyan}Commands:${COLORS.reset}`);
      console.log("  :quit     - Exit");
      console.log("  :help    - Show this help");
      console.log("  :clear   - Clear chat history");
      console.log("  :provider - Select provider/model");
      console.log("  :files   - List project files");
      console.log("  :context - Show project context");
    } else if (cmd === ":clear") {
      history = [];
      printSuccess("History cleared");
    } else if (cmd === ":provider") {
      const providers = listProviders();
      console.log(`${COLORS.cyan}Providers:${COLORS.reset}`);
      providers.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.defaultModel})`));
      
      const sel = await promptQuestion("Select: ");
      const idx = parseInt(sel) - 1;
      if (idx >= 0 && idx < providers.length) {
        setProvider(providers[idx].name as LLMProvider);
        setModel(providers[idx].defaultModel);
        
        if (state.provider === "openrouter") {
          console.log(`\n${COLORS.cyan}OpenRouter models (free):${COLORS.reset}`);
          OPENROUTER_MODELS.forEach((m, i) => {
            const modeColor = m.mode === "schema" ? COLORS.green : COLORS.yellow;
            console.log(`  ${i + 1}. ${m.model} ${modeColor}[${m.mode}]${COLORS.reset}`);
          });
          const modelSel = await promptQuestion("Select model: ");
          const modelIdx = parseInt(modelSel) - 1;
          if (modelIdx >= 0 && modelIdx < OPENROUTER_MODELS.length) {
            setModel(OPENROUTER_MODELS[modelIdx].model);
          }
        }
        console.log(`${COLORS.green}Provider: ${state.provider} (${state.model})${COLORS.reset}`);
      }
    } else if (cmd === ":files") {
      const files = await searchFiles("**/*");
      console.log(`${COLORS.cyan}Found ${files.length} files:${COLORS.reset}`);
      files.slice(0, 20).forEach(f => console.log(`  ${f}`));
      if (files.length > 20) console.log(`  ... and ${files.length - 20} more`);
    } else if (cmd === ":context") {
      const ctx = await loadProjectContext(process.cwd());
      console.log(`${COLORS.cyan}Project context:${COLORS.reset}`);
      console.log(ctx);
    } else if (input.trim()) {
      const response = await getLLMResponse(input, history);
      history.push({ role: "user", content: input });
      history.push({ role: "assistant", content: response });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith('--') || a.startsWith('-'));
  const commandArgs = args.filter(a => !a.startsWith('--') && !a.startsWith('-'));
  
  for (const flag of flags) {
    if (flag === "--debug") {
      setLogLevel("debug");
      console.log(`${COLORS.yellow}🔍 Debug mode enabled - verbose logging active${COLORS.reset}`);
    }
    if (flag === "--verbose" || flag === "-v") {
      setVerboseMode(true);
      console.log(`${COLORS.cyan}📝 Verbose mode enabled - LLM requests/responses will be logged${COLORS.reset}`);
    }
  }
  
  if (commandArgs.length > 0) {
    const result = await runCommand(commandArgs.join(" "), []);
    console.log(result.stdout || result.stderr || "");
  } else {
    await startInteractive();
  }
}

main();