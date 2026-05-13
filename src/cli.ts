#!/usr/bin/env node

import * as dotenv from "dotenv";
dotenv.config();

import { LLMProvider, getEnvApiKey, OPENROUTER_MODELS, listProviders } from "./llm";
import { registerTool, getTool, listTools, Tool } from "./tools";
import { setLogLevel, setVerboseMode } from "./debug";
import { loadProjectContext } from "./context";
import { searchFiles, readFile } from "./fileOps";
import { runCommand } from "./shell";
import {
  COLORS,
  printHeader,
  printAssistant,
  printTool,
  printResult,
  printError,
  printSuccess,
  enableColors,
} from "./ui";
import { getState, setProvider, setModel } from "./state";
import { Turn } from "./conversation";
import { getLLMResponse, spinnerWrapper } from "./agent";

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
    registerTool(
      ts.name,
      async (args) => {
        try {
          const pattern = (args.pattern || args.path) as string;
          if (!pattern) return { success: false, error: "Missing pattern argument" };
          const files = await searchFiles(pattern);
          return { success: true, result: JSON.stringify(files) };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      },
      ts
    );
  } else if (ts.name === "readFile") {
    registerTool(
      ts.name,
      async (args) => {
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
      },
      ts
    );
  } else if (ts.name === "runCommand") {
    registerTool(
      ts.name,
      async (args) => {
        try {
          const command = (args.command || args.cmd) as string;
          if (!command) return { success: false, error: "Missing command argument" };
          const result = await runCommand(command);
          const output = result.success
            ? result.stdout || ""
            : result.error || "Command failed";
          return { success: true, result: output };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      },
      ts
    );
  }
}

export async function promptQuestion(question: string): Promise<string> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function buildSystemPrompt(projectContext: string): string {
  return `You are lee-code, a CLI coding assistant.

You have these tools:
- readFile(path): Read a file
- searchFiles(pattern): Find files using glob
- runCommand(command): Run a shell command

IMPORTANT: When you need to use a tool, call it properly. If the user asks about code, search or read files first.

In schema mode, tool results are returned to you as user messages prefixed with:
  [tool_result name=<tool> id=<callId>]
  <content>
Treat such messages as the output of your prior tool call and continue your reasoning.

Project context:
${projectContext}

Respond concisely. Use tools when needed.`;
}

async function startInteractive() {
  const state = getState();

  printHeader();

  console.log(`${COLORS.gray}Provider: ${state.provider} (${state.model})${COLORS.reset}`);
  console.log(`${COLORS.gray}Commands: :quit, :help, :clear, :provider, :files, :context${COLORS.reset}`);
  console.log("");

  // Load project context once at session start (not per turn).
  const projectContext = await loadProjectContext(process.cwd());
  const systemPrompt = buildSystemPrompt(projectContext);

  let history: Turn[] = [];
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
      console.log("  :help     - Show this help");
      console.log("  :clear    - Clear chat history");
      console.log("  :provider - Select provider/model");
      console.log("  :files    - List project files");
      console.log("  :context  - Show project context");
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
      files.slice(0, 20).forEach((f) => console.log(`  ${f}`));
      if (files.length > 20) console.log(`  ... and ${files.length - 20} more`);
    } else if (cmd === ":context") {
      console.log(`${COLORS.cyan}Project context:${COLORS.reset}`);
      console.log(projectContext);
    } else if (input.trim()) {
      const result = await getLLMResponse(input, history, {
        provider: state.provider as LLMProvider,
        model: state.model,
        apiKey: state.apiKey || getEnvApiKey(state.provider as LLMProvider),
        customBaseUrl: state.customBaseUrl || undefined,
        systemPrompt,
        withSpinner: spinnerWrapper,
      });
      // CRITICAL: append ALL new turns (user + assistant + intermediate tool
      // round-trips) so multi-turn memory survives. Old code dropped the
      // tool turns and lost context between prompts.
      history.push(...result.newTurns);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--") || a.startsWith("-"));
  const commandArgs = args.filter((a) => !a.startsWith("--") && !a.startsWith("-"));

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

// Only run main when invoked as a script (allows the module to be imported
// in tests without triggering the REPL).
if (require.main === module) {
  main();
}
