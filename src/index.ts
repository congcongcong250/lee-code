#!/usr/bin/env node

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import fg from "fast-glob";
import { spawn } from "child_process";
import { chat, ChatMessage, LLMProvider, getEnvApiKey, listProviders, ChatResponse } from "./llm.js";
import { registerTool, Tool, ToolResult, getTool, listTools, clearTools } from "./tools.js";
import { ToolCall } from "./tools.js";
import { debug, info, warn as logWarn, error as logError, setLogLevel, setVerboseMode, saveLogs, logLLM, saveLLMLogs, getSessionIdValue } from "./debug.js";

interface FileOperationResult {
  success: boolean;
  data?: string;
  error?: string;
}

async function readFile(filePath: string): Promise<FileOperationResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    return { success: true, data: content };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function writeFile(filePath: string, content: string): Promise<FileOperationResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absolutePath, content, "utf-8");
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function editFile(filePath: string, oldString: string, newString: string): Promise<FileOperationResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    if (!content.includes(oldString)) {
      return { success: false, error: "String not found in file" };
    }
    const newContent = content.replace(oldString, newString);
    await fs.writeFile(absolutePath, newContent, "utf-8");
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function searchFiles(pattern: string): Promise<string[]> {
  try {
    const matches = await fg(pattern, { absolute: true, onlyFiles: true });
    return matches;
  } catch {
    return [];
  }
}

interface CommandResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

function runCommand(command: string, args: string[] = []): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });
    const timer = setTimeout(() => { child.kill(); resolve({ success: false, stdout, stderr, error: "Command timed out" }); }, 60000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ success: code === 0, stdout, stderr }); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ success: false, stdout, stderr, error: (error as Error).message }); });
  });
}

async function loadProjectContext(rootDir: string): Promise<string> {
  let output = `Project: ${rootDir}\n`;
  for (const name of ["CLAUDE.md", "claude.md"]) {
    const filePath = path.join(rootDir, name);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      output += `\n=== ${name} ===\n${content}\n`;
      break;
    } catch { continue; }
  }
  for (const name of ["MEMORY.md", "memory.md"]) {
    const filePath = path.join(rootDir, name);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      output += `\n=== ${name} ===\n${content}\n`;
      break;
    } catch { continue; }
  }
  return output;
}

// === FUZYY TOOL PARSING ===
function fuzzyMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, "").replace(/\s+/g, "");
  return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

function parseToolCallsFromText(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const toolNames = Object.keys(listTools());
  
  // Match [TOOL_CALL]{tool => "name" args => {...}} format
  const blockRegex = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*(\{[^}]+\})\}/gi;
  let blockMatch: RegExpExecArray | null;
  const blockRe = /\[TOOL_CALL\]\s*\{tool\s*=>\s*"(\w+)".*?args\s*=>\s*(\{[^}]+\})\}/gi;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    const toolName = blockMatch[1];
    const matchedTool = toolNames.find(t => fuzzyMatch(t, toolName));
    if (matchedTool) {
      const argsStr = blockMatch[2];
      const args: Record<string, unknown> = {};
      const argRe = /--(\w+)\s*:\s*"([^"]*)"/g;
      let argMatch: RegExpExecArray | null;
      while ((argMatch = argRe.exec(argsStr)) !== null) {
        args[argMatch[1]] = argMatch[2];
      }
      if (Object.keys(args).length > 0) {
        calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: matchedTool, arguments: args });
      }
    }
  }
  
  // Match `tool: value` format  
  const inlineRe = /`(\w+):\s*(.+?)`/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineRe.exec(text)) !== null) {
    const toolArg = inlineMatch[1];
    const toolVal = inlineMatch[2];
    if (toolArg) {
      const matchedTool = toolNames.find(t => fuzzyMatch(t, toolArg));
      if (matchedTool) {
        calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: matchedTool, arguments: { value: toolVal } });
      }
    }
  }
  
  // Also match plain tool names in text
  for (const toolName of toolNames) {
    const toolRegex = new RegExp(`\\b${toolName}\\b`, "gi");
    if (toolRegex.test(text)) {
      const existingCall = calls.find(c => c.name === toolName);
      if (!existingCall) {
        calls.push({ id: `call_${Date.now()}_${Math.random()}`, name: toolName, arguments: {} });
      }
    }
  }
  
  return calls;
}

// === REGISTER TOOLS ===
registerTool("readFile", async (args) => {
  const { path: filePath } = args as { path?: string };
  try {
    const content = await fs.readFile(filePath as string, "utf-8");
    return { success: true, result: content };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
});

registerTool("searchFiles", async (args) => {
  const { pattern } = args as { pattern?: string };
  try {
    const files = await fg(pattern as string, { absolute: true, onlyFiles: true });
    return { success: true, result: files.join("\n") };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
});

registerTool("runCommand", async (args) => {
  const { command } = args as { command?: string };
  return runCommand(command as string);
});

const tools: Tool[] = [
  {
    name: "readFile",
    description: "Read contents of a file",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to read" } }, required: ["path"] },
  },
  {
    name: "searchFiles",
    description: "Search for files using glob pattern",
    parameters: { type: "object", properties: { pattern: { type: "string", description: "Glob pattern like **/*.ts" } }, required: ["pattern"] },
  },
  {
    name: "runCommand",
    description: "Run a shell command",
    parameters: { type: "object", properties: { command: { type: "string", description: "Command to run" } }, required: ["command"] },
  },
];

// === STATE ===
let provider: LLMProvider = "groq";
let model = "llama-3.3-70b-versatile";
let customBaseUrl = "";
let apiKey = "";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function promptQuestion(question: string): Promise<string> {
  return new Promise((resolve) => { rl.question(question, (answer) => { resolve(answer); }); });
}

// === AGENTIC LOOP ===
async function getLLMResponse(userInput: string, history: ChatMessage[]): Promise<string> {
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

  // Build initial messages
  let messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userInput },
  ];

  // Agentic loop: max 5 iterations
  for (let i = 0; i < 5; i++) {
    try {
      debug(`Iteration ${i + 1}: Calling LLM`, { provider, model, toolsCount: tools.length });
      
      // Log user message
      logLLM("user", userInput, { provider, model, iteration: i + 1 });
      
      // Log messages being sent (truncate for readability)
      const msgsForLog = messages.map(m => ({ role: m.role, content: m.content.slice(0, 200) }));
      logLLM("system", JSON.stringify(msgsForLog), { provider, model, iteration: i + 1 });
      
      const cfg: any = { provider, model, tools };
      if (customBaseUrl) cfg.baseUrl = customBaseUrl;
      if (["openai", "anthropic", "groq", "huggingface", "openrouter"].includes(provider)) {
        cfg.apiKey = apiKey || getEnvApiKey(provider);
      }
      
      const startTime = Date.now();
      const response: ChatResponse = await chat(messages, cfg);
      const duration = Date.now() - startTime;
      
      const respContent = response.message.content;
      logLLM("assistant", respContent, { provider, model, iteration: i + 1, duration });
      
      debug(`Iteration ${i + 1}: LLM responded`, { contentLength: respContent.length, hasToolCalls: !!response.toolCalls, duration });
      
      // Check for API tool calls
      let toolCalls = response.toolCalls || [];
      
      // If no API tool calls, parse from text (fuzzy)
      if (toolCalls.length === 0) {
        toolCalls = parseToolCallsFromText(response.message.content);
        debug(`Iteration ${i + 1}: Fuzzy parsed tool calls`, { count: toolCalls.length, parsed: toolCalls.map(t => t.name) });
      }
      
      if (toolCalls.length > 0) {
        // Execute tool calls
        for (const tc of toolCalls) {
          debug(`Executing tool`, { name: tc.name, args: tc.arguments });
          logLLM("tool", JSON.stringify(tc), { provider, model, iteration: i + 1, toolCalls: tc.name });
          
          const fn = getTool(tc.name);
          if (fn) {
            const result = await fn(tc.arguments);
            const resultStr = result.success 
              ? `Tool ${tc.name} result: ${result.result}`
              : `Tool ${tc.name} error: ${result.error}`;
            
            logLLM("tool_result", resultStr, { provider, model, iteration: i + 1, toolCalls: tc.name });
            debug(`Tool result`, { name: tc.name, success: result.success });
            
            messages.push({ role: "assistant", content: response.message.content });
            messages.push({ role: "user", content: resultStr });
          } else {
            messages.push({ role: "user", content: `Unknown tool: ${tc.name}` });
          }
        }
        // Continue loop with tool results
      } else {
        // No tool calls - return the response
        return response.message.content;
      }
    } catch (error) {
      logError(`Iteration ${i + 1}: Error`, (error as Error).message);
      return `Error: ${(error as Error).message}`;
    }
  }
  
  logWarn("getLLMResponse", "Max iterations reached");
  return "Max iterations reached";
}

async function startInteractive() {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║              lee-code v1.0.0 - AI Coding Assistant       ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`Provider: ${provider} (${model})`);
  console.log("Commands: :quit, :help, :clear, :provider, :files, :context");
  console.log("");

  let history: ChatMessage[] = [];
  let running = true;

  while (running) {
    const input = await promptQuestion("❯ ");
    console.log("");
    const cmd = input.trim().toLowerCase();

    if (cmd === ":quit" || cmd === ":q") {
      running = false;
      console.log("Goodbye!");
      // Auto-save logs on exit
      try {
        const fn = saveLLMLogs();
        console.log(`Logs saved to ${fn}`);
      } catch {}
      process.exit(0);
    } else if (cmd === ":help" || cmd === ":h") {
      console.log("Commands: :quit, :help, :clear, :provider, :files, :context");
      console.log("         read <file>, search <pattern>, run <cmd>");
      console.log("         :logs, :logs save");
    } else if (cmd === ":logs save verbose" || cmd === ":logs v") {
      const filename = saveLLMLogs();
      console.log(`Verbose logs saved to ${filename}`);
    } else if (cmd === ":logs save") {
      const filename = saveLogs();
      console.log(`Logs saved to ${filename}`);
    } else if (cmd === ":logs" || cmd === ":logs stats") {
      const logs = require("./debug.js").getLogs();
      const llmLogs = require("./debug.js").getLLMLogs();
      console.log(`Session: ${getSessionIdValue()}`);
      console.log(`Debug logs: ${logs.length}`);
      console.log(`LLM logs: ${llmLogs.length}`);
      llmLogs.slice(-5).forEach((l: any) => {
        console.log(`  ${l.timestamp} [${l.role}] ${l.content?.slice(0, 60)}...`);
      });
    } else if (cmd === ":provider") {
      const providers = listProviders();
      console.log("\nProviders:");
      providers.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.defaultModel})`));
      const sel = await promptQuestion("Select: ");
      const idx = parseInt(sel) - 1;
      if (idx >= 0 && idx < providers.length) {
        provider = providers[idx].name as LLMProvider;
        model = providers[idx].defaultModel;
        console.log(`Provider: ${provider} (${model})`);
      }
    } else if (cmd === ":files") {
      const files = await searchFiles("**/*");
      console.log(`Found ${files.length} files`);
      files.slice(0, 20).forEach(f => console.log(f));
      if (files.length > 20) console.log(`... and ${files.length - 20} more`);
    } else if (cmd === ":context") {
      const ctx = await loadProjectContext(process.cwd());
      console.log(ctx);
    } else if (input.trim()) {
      const response = await getLLMResponse(input, history);
      console.log(response);
      history.push({ role: "user", content: input });
      history.push({ role: "assistant", content: response });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Separate flags from commands
  const flags = args.filter(a => a.startsWith('--') || a.startsWith('-'));
  const commandArgs = args.filter(a => !a.startsWith('--') && !a.startsWith('-'));
  
  // Handle --debug flag
  if (flags.includes('--debug') || flags.includes('-d')) {
    setLogLevel("debug");
    debug("Debug mode enabled");
  }

  // Handle --verbose flag
  if (flags.includes('--verbose') || flags.includes('-v')) {
    setVerboseMode(true);
    debug("Verbose mode enabled - logging LLM requests/responses");
  }

  const isInteractive = commandArgs.length === 0 || commandArgs[0] === "i" || commandArgs[0] === "interactive";

  if (isInteractive) {
    await startInteractive();
    return;
  }

  const command = commandArgs[0];

  switch (command) {
    case "read":
    case "write":
    case "edit":
    case "search":
    case "run":
    case "context":
    case "help":
    case "interactive":
    case "i":
      if (command === "help") {
        console.log("lee-code v1.0.0");
        console.log("Usage: lee-code [read|write|edit|search|run|context|help|i]");
      } else if (command === "context") {
        console.log(await loadProjectContext(process.cwd()));
      } else if (command === "interactive" || command === "i") {
        await startInteractive();
      } else if (command === "read") {
        if (args.length < 2) { console.error("Usage: lee-code read <file>"); process.exit(1); }
        const result = await readFile(args[1]);
        console.log(result.success ? result.data : result.error);
        if (!result.success) process.exit(1);
      } else if (command === "write") {
        if (args.length < 3) { console.error("Usage: lee-code write <file> <content>"); process.exit(1); }
        const result = await writeFile(args[1], args[2]);
        console.log(result.success ? "OK" : result.error);
        if (!result.success) process.exit(1);
      } else if (command === "edit") {
        if (args.length < 4) { console.error("Usage: lee-code edit <file> <old> <new>"); process.exit(1); }
        const result = await editFile(args[1], args[2], args[3]);
        console.log(result.success ? "OK" : result.error);
        if (!result.success) process.exit(1);
      } else if (command === "search") {
        if (args.length < 2) { console.error("Usage: lee-code search <pattern>"); process.exit(1); }
        const files = await searchFiles(args[1]);
        files.forEach(f => console.log(f));
      } else if (command === "run") {
        if (args.length < 2) { console.error("Usage: lee-code run <command>"); process.exit(1); }
        const result = await runCommand(args[1]);
        if (result.stdout) console.log(result.stdout);
        if (result.stderr) console.error(result.stderr);
        if (!result.success) process.exit(1);
      }
      break;
    default:
      console.error(`Unknown: ${command}. Run 'lee-code help'`);
      process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });