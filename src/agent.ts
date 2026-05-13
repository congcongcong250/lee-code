import { Turn, AssistantTurn, ToolTurn, AgentMode } from "./conversation";
import { ToolCall, getTool, listToolSchemas } from "./tools";
import { chat, chatStream, LLMConfig, LLMProvider, getEnvApiKey, resolveMode } from "./llm";
import { debug, logLLM, saveLLMLogs } from "./debug";
import { printAssistant, printTool, printResult, printError, createSpinner } from "./ui";

export const MAX_ITERATIONS = 10;

export interface AgentDeps {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  customBaseUrl?: string;
  systemPrompt: string;
  /** Where the chat() function comes from; injected for testability. */
  chat?: typeof chat;
  /**
   * If provided, streaming path is used: chatStream is invoked, chunks
   * are emitted to `onStreamChunk`, and the spinner is skipped. The
   * agent still resolves to the assembled AssistantTurn at the end.
   */
  streamChat?: typeof chatStream;
  /** Receives every visible text chunk as it streams. */
  onStreamChunk?: (chunk: string) => void;
  /** Called before the first chunk of a streamed assistant turn. */
  onStreamStart?: () => void;
  /** Called when the streamed assistant turn finishes. */
  onStreamEnd?: () => void;
  /** Optional logging hooks; default to debug.ts. */
  onAssistantText?: (text: string) => void;
  onToolCall?: (calls: ToolCall[]) => void;
  onToolResult?: (call: ToolCall, fullResult: string) => void;
  onError?: (message: string) => void;
  /** Optional spinner controller; default uses ui.ts spinner. */
  withSpinner?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface AgentResult {
  /** Final assistant prose returned to the user. */
  response: string;
  /** Turns to append to session history: the new user turn + assistant/tool turns. */
  newTurns: Turn[];
}

/**
 * Execute the agent loop for one user prompt.
 *
 * Contract:
 *   - Input: the prior session history as Turn[] (read-only) and the new user input.
 *   - Output: { response: string; newTurns: Turn[] } where newTurns starts with
 *     the user turn and ends with the final assistant turn. ALL intermediate
 *     tool calls and tool results are included so multi-turn memory stays
 *     coherent (fixes the bug where history previously dropped tool round-trips).
 *
 * The loop never mutates the input `history` array — it builds a working
 * Turn[] internally and returns the new turns as a delta.
 */
export async function getLLMResponse(
  userInput: string,
  history: Turn[],
  deps: AgentDeps
): Promise<AgentResult> {
  const chatFn = deps.chat ?? chat;
  const mode: AgentMode = resolveMode(deps.model);

  // Build the working history. The system prompt always leads.
  const newTurns: Turn[] = [{ role: "user", text: userInput }];
  let working: Turn[] = [
    { role: "system", text: deps.systemPrompt },
    ...history,
    ...newTurns,
  ];

  const cfg: Partial<LLMConfig> = {
    provider: deps.provider,
    model: deps.model,
    tools: listToolSchemas(),
    mode,
  };
  if (deps.customBaseUrl) cfg.baseUrl = deps.customBaseUrl;
  if (["openai", "anthropic", "groq", "huggingface", "openrouter"].includes(deps.provider)) {
    cfg.apiKey = deps.apiKey || getEnvApiKey(deps.provider);
  }

  const useStreaming =
    !!deps.streamChat && !!deps.onStreamChunk;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    debug(`Iteration ${i + 1}: Calling LLM`, {
      provider: deps.provider,
      model: deps.model,
      messagesIn: working.length,
      streaming: useStreaming,
    });

    let assistantTurn: AssistantTurn;
    try {
      const startTime = Date.now();
      if (useStreaming) {
        deps.onStreamStart?.();
        assistantTurn = await deps.streamChat!(working, cfg, {
          onText: deps.onStreamChunk!,
        });
        deps.onStreamEnd?.();
      } else {
        assistantTurn = deps.withSpinner
          ? await deps.withSpinner(() => chatFn(working, cfg))
          : await chatFn(working, cfg);
      }
      const duration = Date.now() - startTime;
      logLLM("assistant", assistantTurn.text, {
        provider: deps.provider,
        model: deps.model,
        iteration: i + 1,
        duration,
      });
      saveLLMLogs();
    } catch (error) {
      const msg = (error as Error).message;
      if (deps.onError) deps.onError(msg);
      else printError(msg);
      const failTurn: AssistantTurn = { role: "assistant", text: `Error: ${msg}` };
      newTurns.push(failTurn);
      return { response: `Error: ${msg}`, newTurns };
    }

    // Append the assistant turn to both working history and the delta.
    working.push(assistantTurn);
    newTurns.push(assistantTurn);

    // Surface assistant prose to the user.
    //
    // When streaming, chunks have already been delivered to the user via
    // onStreamChunk; we do NOT replay the assembled text here to avoid
    // double-printing.
    if (!useStreaming && assistantTurn.text) {
      if (deps.onAssistantText) deps.onAssistantText(assistantTurn.text);
      else printAssistant(assistantTurn.text.slice(0, 500));
    }

    const calls = assistantTurn.toolCalls ?? [];
    if (calls.length === 0) {
      // Final answer — stop.
      return { response: assistantTurn.text, newTurns };
    }

    // Surface tool calls.
    if (deps.onToolCall) deps.onToolCall(calls);
    else
      printTool(
        calls
          .map((tc) => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 50)})`)
          .join(", ")
      );

    // Execute each tool call. Wrap each call so a throwing tool does not
    // crash the whole loop (regression: B18).
    for (const tc of calls) {
      const fn = getTool(tc.name);
      let fullResult: string;
      if (!fn) {
        fullResult = `Unknown tool: ${tc.name}`;
      } else {
        try {
          const r = await fn(tc.arguments);
          fullResult = r.success ? (r.result || "") : (r.error || "Error");
        } catch (e) {
          fullResult = `Tool ${tc.name} threw: ${(e as Error).message}`;
        }
      }

      if (deps.onToolResult) deps.onToolResult(tc, fullResult);
      else {
        const display =
          fullResult.length > 200
            ? fullResult.slice(0, 200) + "......" + fullResult.slice(-50)
            : fullResult;
        printResult(display);
      }
      logLLM("tool_result", fullResult, {
        provider: deps.provider,
        model: deps.model,
        iteration: i + 1,
        toolCalls: tc.name,
      });

      const toolTurn: ToolTurn = {
        role: "tool",
        callId: tc.id,
        name: tc.name,
        text: fullResult,
      };
      working.push(toolTurn);
      newTurns.push(toolTurn);
    }
    saveLLMLogs();
  }

  const exhausted: AssistantTurn = {
    role: "assistant",
    text: "Max iterations reached",
  };
  newTurns.push(exhausted);
  return { response: "Max iterations reached", newTurns };
}

/**
 * Spinner adapter for the interactive REPL. Tests can pass a no-op
 * withSpinner to avoid TTY side effects.
 */
export function spinnerWrapper<T>(fn: () => Promise<T>): Promise<T> {
  const s = createSpinner();
  s.start();
  return fn()
    .then((r) => {
      s.stop();
      return r;
    })
    .catch((e) => {
      s.stop();
      throw e;
    });
}
