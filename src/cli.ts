#!/usr/bin/env node

import * as dotenv from "dotenv";
dotenv.config();

import { LLMProvider, getEnvApiKey, OPENROUTER_MODELS, listProviders } from "./llm";
import { registerTool, getTool, listTools, Tool } from "./tools";
import { setLogLevel, setVerboseMode } from "./debug";
import { loadProjectContext } from "./context";
import { searchFiles, readFile, writeFile, editFile } from "./fileOps";
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
import { createConfirmGate, ConfirmGate } from "./confirm";
import { chatStream } from "./llm";
import { saveSession, loadSession } from "./session";
import { getSessionIdValue } from "./debug";

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
  {
    name: "writeFile",
    description: "Write content to a file inside the workspace, creating it if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path inside the workspace" },
        content: { type: "string", description: "Full file contents to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "editFile",
    description:
      "Replace a substring in an existing file. oldString must match exactly once unless replaceAll is true.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path inside the workspace" },
        oldString: { type: "string", description: "Exact substring to replace; must be unique unless replaceAll is true" },
        newString: { type: "string", description: "Replacement substring" },
        replaceAll: { type: "boolean", description: "If true, replace every occurrence" },
      },
      required: ["path", "oldString", "newString"],
    },
  },
];

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

/**
 * Register the three default agent tools.
 *
 * Exported (and parameterised on a ConfirmGate) so tests can register the
 * tools against a mock prompt and verify gating behaviour without touching
 * the global REPL.
 */
export function registerDefaultTools(confirmGate: ConfirmGate): void {
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
            const allowed = await confirmGate.ask("runCommand", command);
            if (!allowed) {
              return { success: false, error: "Cancelled by user" };
            }
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
    } else if (ts.name === "writeFile") {
      registerTool(
        ts.name,
        async (args) => {
          try {
            const filePath = (args.path || args.filePath) as string;
            const content = (args.content ?? "") as string;
            if (!filePath) return { success: false, error: "Missing path argument" };
            const allowed = await confirmGate.ask(
              "writeFile",
              `${filePath} (${content.length} bytes)`
            );
            if (!allowed) return { success: false, error: "Cancelled by user" };
            const r = await writeFile(filePath, content);
            return r.success
              ? { success: true, result: `Wrote ${filePath}` }
              : { success: false, error: r.error || "Write failed" };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
        ts
      );
    } else if (ts.name === "editFile") {
      registerTool(
        ts.name,
        async (args) => {
          try {
            const filePath = (args.path || args.filePath) as string;
            const oldString = args.oldString as string;
            const newString = args.newString as string;
            const replaceAll = !!args.replaceAll;
            if (!filePath) return { success: false, error: "Missing path argument" };
            if (typeof oldString !== "string" || typeof newString !== "string") {
              return {
                success: false,
                error: "editFile requires string oldString and newString",
              };
            }
            const allowed = await confirmGate.ask(
              "editFile",
              `${filePath}: replace ${JSON.stringify(oldString).slice(0, 60)} -> ${JSON.stringify(newString).slice(0, 60)}`
            );
            if (!allowed) return { success: false, error: "Cancelled by user" };
            const r = await editFile(filePath, oldString, newString, { replaceAll });
            return r.success
              ? { success: true, result: `Edited ${filePath}` }
              : { success: false, error: r.error || "Edit failed" };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
        ts
      );
    }
  }
}

const interactiveConfirmGate = createConfirmGate(promptQuestion);
registerDefaultTools(interactiveConfirmGate);

function buildSystemPrompt(projectContext: string): string {
  return `You are lee-code, a CLI coding assistant.

You have these tools:
- readFile(path): Read a file inside the workspace
- searchFiles(pattern): Find files using glob, inside the workspace
- runCommand(command): Run a shell command (requires user confirmation)
- writeFile(path, content): Write/replace a file (requires confirmation)
- editFile(path, oldString, newString, replaceAll?): Replace a unique substring in a file (requires confirmation). oldString MUST match exactly once unless replaceAll is true.

IMPORTANT: When you need to use a tool, call it properly. If the user asks about code, search or read files first. Prefer editFile over writeFile when modifying an existing file so context is preserved.

In schema mode, tool results are returned to you as user messages prefixed with:
  [tool_result name=<tool> id=<callId>]
  <content>
Treat such messages as the output of your prior tool call and continue your reasoning.

Project context:
${projectContext}

Respond concisely. Use tools when needed.`;
}

export interface StartInteractiveOptions {
  resumeFrom?: string;
}

async function startInteractive(opts: StartInteractiveOptions = {}) {
  const state = getState();

  printHeader();

  console.log(`${COLORS.gray}Provider: ${state.provider} (${state.model})${COLORS.reset}`);
  console.log(
    `${COLORS.gray}Commands: :quit, :help, :clear, :provider, :files, :context, :save${COLORS.reset}`
  );

  // Load project context once at session start (not per turn).
  const projectContext = await loadProjectContext(process.cwd());
  const systemPrompt = buildSystemPrompt(projectContext);

  let history: Turn[] = [];

  if (opts.resumeFrom) {
    try {
      const loaded = await loadSession(opts.resumeFrom);
      history = loaded.turns;
      printSuccess(
        `Resumed session ${loaded.sessionId} (${history.length} turns) from ${opts.resumeFrom}`
      );
    } catch (e) {
      printError(`Failed to load session: ${(e as Error).message}`);
    }
  }
  console.log("");

  let running = true;

  while (running) {
    const input = await promptQuestion("❯ ");
    console.log("");
    const cmd = input.trim().toLowerCase();
    const cmdParts = input.trim().split(/\s+/);
    const cmdHead = cmdParts[0]?.toLowerCase() ?? "";

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
      console.log("  :save [path] - Save the current session (default .lee-sessions/<sessionId>.json)");
    } else if (cmdHead === ":save") {
      try {
        const sessionId = getSessionIdValue();
        const file = await saveSession({
          sessionId,
          turns: history,
          provider: state.provider,
          model: state.model,
        });
        printSuccess(`Saved ${history.length} turns to ${file}`);
      } catch (e) {
        printError(`Save failed: ${(e as Error).message}`);
      }
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
      const providerForCall = state.provider as LLMProvider;
      const supportsStreaming =
        providerForCall === "openai" ||
        providerForCall === "openrouter" ||
        providerForCall === "groq";
      const result = await getLLMResponse(input, history, {
        provider: providerForCall,
        model: state.model,
        apiKey: state.apiKey || getEnvApiKey(providerForCall),
        customBaseUrl: state.customBaseUrl || undefined,
        systemPrompt,
        // Use streaming when supported. The spinner is only used as a
        // fallback for providers that we don't (yet) stream from.
        ...(supportsStreaming
          ? {
              streamChat: chatStream,
              onStreamStart: () => process.stdout.write(`${COLORS.white}`),
              onStreamChunk: (chunk: string) => process.stdout.write(chunk),
              onStreamEnd: () => process.stdout.write(`${COLORS.reset}\n`),
            }
          : {
              withSpinner: spinnerWrapper,
            }),
      });
      // CRITICAL: append ALL new turns (user + assistant + intermediate tool
      // round-trips) so multi-turn memory survives. Old code dropped the
      // tool turns and lost context between prompts.
      history.push(...result.newTurns);
    }
  }
}

export interface ParsedArgs {
  debug: boolean;
  verbose: boolean;
  continueFrom?: string;
  positional: string[];
  unknown: string[];
}

/**
 * Parse argv flags. Exported for tests.
 *
 * Recognised:
 *   --debug | -d           enable debug logging
 *   --verbose | -v         enable verbose LLM request/response logging
 *   --continue <path>      load a saved session file before entering REPL
 *
 * Anything else that looks like a flag goes into `unknown` so the caller
 * can decide what to do (we currently ignore it).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { debug: false, verbose: false, positional: [], unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      out.positional.push(a);
      continue;
    }
    if (a === "--debug" || a === "-d") {
      out.debug = true;
    } else if (a === "--verbose" || a === "-v") {
      out.verbose = true;
    } else if (a === "--continue") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        out.continueFrom = next;
        i++;
      } else {
        out.unknown.push(a);
      }
    } else if (a.startsWith("--continue=")) {
      out.continueFrom = a.slice("--continue=".length);
    } else {
      out.unknown.push(a);
    }
  }
  return out;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.debug) {
    setLogLevel("debug");
    console.log(`${COLORS.yellow}🔍 Debug mode enabled - verbose logging active${COLORS.reset}`);
  }
  if (parsed.verbose) {
    setVerboseMode(true);
    console.log(`${COLORS.cyan}📝 Verbose mode enabled - LLM requests/responses will be logged${COLORS.reset}`);
  }

  if (parsed.positional.length > 0) {
    const result = await runCommand(parsed.positional.join(" "), []);
    console.log(result.stdout || result.stderr || "");
  } else {
    await startInteractive({ resumeFrom: parsed.continueFrom });
  }
}

// Only run main when invoked as a script (allows the module to be imported
// in tests without triggering the REPL).
if (require.main === module) {
  main();
}
