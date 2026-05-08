#!/usr/bin/env node

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import fg from "fast-glob";
import { spawn } from "child_process";
import { chat, ChatMessage, LLMProvider, getEnvApiKey, listProviders } from "./llm.js";

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
  exitCode?: number;
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
    child.on("close", (code) => { clearTimeout(timer); resolve({ success: code === 0, stdout, stderr, exitCode: code || undefined }); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ success: false, stdout, stderr, error: error.message }); });
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

let provider: LLMProvider = "openrouter";
let model = "minimax/minimax-m2.5:free";
let customBaseUrl = "";
let apiKey = "";
let demoMode = false;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function promptQuestion(question: string): Promise<string> {
  return new Promise((resolve) => { rl.question(question, (answer) => { resolve(answer); }); });
}

async function getLLMResponse(userInput: string, messages: ChatMessage[]): Promise<string> {
  const context = await loadProjectContext(process.cwd());
  
  const systemPrompt = `You are lee-code, a CLI coding assistant. You help users with software engineering tasks.
Available tools: read file, write file, edit file, search files (glob), run shell commands.

Project context:
${context}

When用户提供代码相关请求时，你可以:
1. 读取文件了解代码结构
2. 使用glob搜索文件
3. 运行命令构建/测试
4. 写代码解决用户需求

Keep responses concise and practical. If user asks to implement something, provide working code.`;

  const userMsg = `Current request: ${userInput}`;

  const tempMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
    { role: "user", content: userMsg },
  ];

  try {
    const cfg: any = { provider, model };
    if (customBaseUrl) cfg.baseUrl = customBaseUrl;
    if (provider === "openai" || provider === "anthropic" || provider === "groq" || provider === "huggingface" || provider === "openrouter") {
      cfg.apiKey = apiKey || getEnvApiKey(provider);
    }
    
    const response = await chat(tempMessages, cfg);
    return response.message.content;
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

async function startInteractive() {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║              lee-code v1.0.0 - AI Coding Assistant       ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`Provider: ${provider}${model ? ` (${model})` : ""}`);
  console.log("Commands:");
  console.log("  :quit, :q      Exit the session");
  console.log("  :help, :h      Show available commands");
  console.log("  :clear, :c    Clear the screen");
  console.log("  :provider     Change LLM provider");
  console.log("  :files        List project files");
  console.log("  :context      Show project context");
  console.log("");

  const history: ChatMessage[] = [];
  let running = true;

  while (running) {
    const input = await promptQuestion("❯ ");
    console.log("");
    const cmd = input.trim().toLowerCase();

    if (cmd === ":quit" || cmd === ":q") {
      running = false;
      console.log("Goodbye!");
      process.exit(0);
    } else if (cmd === ":help" || cmd === ":h") {
      console.log("");
      console.log("Available commands:");
      console.log("  :quit, :q       Exit");
      console.log("  :help, :h       Show help");
      console.log("  :clear, :c     Clear screen");
      console.log("  :provider       Change LLM provider");
      console.log("  :files          List files");
      console.log("  :context        Show CLAUDE.md / MEMORY.md");
      console.log("  read <file>     Read a file");
      console.log("  search <glob>   Search files with glob");
      console.log("  run <cmd>       Run a shell command");
      console.log("");
    } else if (cmd === ":clear" || cmd === ":c") {
      console.clear();
    } else if (cmd === ":provider") {
      const providers = listProviders();
      console.log("\nAvailable providers:");
      providers.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (default: ${p.defaultModel})`));
      const sel = await promptQuestion("Select provider (1-5): ");
      const idx = parseInt(sel) - 1;
      if (idx >= 0 && idx < providers.length) {
        provider = providers[idx].name as LLMProvider;
        model = providers[idx].defaultModel;
        apiKey = "";
        console.log(`Provider set to: ${provider} (${model})`);
        if (!getEnvApiKey(provider)) {
          console.log("Note: Set API key with :apikey or via env var");
        }
      }
    } else if (cmd === ":apikey") {
      const key = await promptQuestion("Enter API key: ");
      apiKey = key.trim();
      console.log("API key saved for this session");
    } else if (cmd === ":files") {
      const files = await searchFiles("**/*");
      console.log(`Found ${files.length} files`);
      files.slice(0, 20).forEach((f) => console.log(f));
      if (files.length > 20) console.log(`... and ${files.length - 20} more`);
    } else if (cmd === ":context") {
      const ctx = await loadProjectContext(process.cwd());
      console.log(ctx);
    } else if (cmd.startsWith("read ")) {
      const filePath = cmd.slice(5);
      const result = await readFile(filePath);
      console.log(result.success ? result.data : `Error: ${result.error}`);
    } else if (cmd.startsWith("search ")) {
      const files = await searchFiles(cmd.slice(7));
      files.length ? files.forEach((f) => console.log(f)) : console.log("No files found");
    } else if (cmd.startsWith("run ")) {
      const result = await runCommand(cmd.slice(4));
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (!result.success && result.error) console.error(`Error: ${result.error}`);
    } else if (input.trim()) {
      history.push({ role: "user", content: input });
      const response = await getLLMResponse(input, history);
      console.log(response);
      history.push({ role: "assistant", content: response });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await startInteractive();
    return;
  }

  const command = args[0];

  switch (command) {
    case "read":
    case "write":
    case "edit":
    case "search":
    case "run":
    case "context":
    case "interactive":
    case "shell":
    case "repl":
    case "i":
    case "help": {
      if (command === "help") {
        console.log("lee-code v1.0.0 - AI Coding Assistant");
        console.log("");
        console.log("Usage:");
        console.log("  lee-code                    Start interactive mode");
        console.log("  lee-code read <file>       Read a file");
        console.log("  lee-code write <file> <content>  Write to a file");
        console.log("  lee-code edit <file> <old> <new>  Edit a file");
        console.log("  lee-code search <pattern>  Search files with glob");
        console.log("  lee-code run <command>    Run a shell command");
        console.log("  lee-code context           Load project context");
        console.log("  lee-code help             Show help");
      } else if (command === "context") {
        const ctx = await loadProjectContext(process.cwd());
        console.log(ctx);
      } else if (command === "interactive" || command === "shell" || command === "repl" || command === "i") {
        await startInteractive();
      } else if (command === "read") {
        if (args.length < 2) { console.error("Usage: lee-code read <file>"); process.exit(1); }
        const result = await readFile(args[1]);
        console.log(result.success ? result.data : result.error);
        if (!result.success) process.exit(1);
      } else if (command === "write") {
        if (args.length < 3) { console.error("Usage: lee-code write <file> <content>"); process.exit(1); }
        const result = await writeFile(args[1], args[2]);
        console.log(result.success ? "File written" : result.error);
        if (!result.success) process.exit(1);
      } else if (command === "edit") {
        if (args.length < 4) { console.error("Usage: lee-code edit <file> <old> <new>"); process.exit(1); }
        const result = await editFile(args[1], args[2], args[3]);
        console.log(result.success ? "File edited" : result.error);
        if (!result.success) process.exit(1);
      } else if (command === "search") {
        if (args.length < 2) { console.error("Usage: lee-code search <pattern>"); process.exit(1); }
        const files = await searchFiles(args[1]);
        files.forEach((f) => console.log(f));
      } else if (command === "run") {
        if (args.length < 2) { console.error("Usage: lee-code run <command>"); process.exit(1); }
        const result = await runCommand(args[1]);
        if (result.stdout) console.log(result.stdout);
        if (result.stderr) console.error(result.stderr);
        if (!result.success) process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'lee-code help' for usage");
      process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });