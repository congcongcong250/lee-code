# lee-code Refactor & Next Stage Plan

## Context

lee-code is a learning-focused CLI coding assistant. The codebase has a central architectural defect: a single `ChatMessage[]` array is used for two incompatible protocols (schema-JSON mode and native function-calling mode). This causes fragile multi-turn tool calling, broken conversation history, and silent misrouting. Additionally, several documented features don't exist (fake REPL commands), security gates are missing, and key correctness bugs lurk in the tool parser.

The goal is to:
1. Refactor the message layer with a proper typed `Turn[]` model + per-mode serializers
2. Add minimal security gates (workspace boundary + runCommand confirmation)
3. Fix correctness bugs caught during the refactor
4. Implement next-stage features: streaming, `writeFile`/`editFile` tools, session persistence
5. Clean up false README docs

**Provider scope**: OpenRouter only (schema mode + native mode). Anthropic/HuggingFace not in scope for this plan.

---

## Phase 1 — Message Layer Refactor (central fix)

### 1.1 Create `src/conversation.ts` (new file)

```ts
import { ToolCall } from "./tools";

export type Turn =
  | { role: "system"; text: string }
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; text: string };

export type AgentMode = "native" | "schema" | "text-fuzzy";
```

### 1.2 Refactor `src/llm.ts`

**`chat()` signature change:**
- Accept `Turn[]` instead of `ChatMessage[]`
- Accept `AgentMode` as part of config (decided by caller, not hidden inside provider)

**Serializers (per mode):**

- `serializeForNative(turns: Turn[])`: Produces OpenAI-format messages preserving `tool_calls` on assistant turns and `tool_call_id` on tool turns. Never drops IDs.
- `serializeForSchema(turns: Turn[])`: Produces only `{role, content}` messages. Tool results go as `user` messages prefixed `[tool_result name=X id=Y]\n<content>`. Never pushes raw JSON envelopes into history.
- `serializeForOllama(turns: Turn[])`: Like native but strips tool_calls/tool_call_id fields Ollama doesn't understand.

**Mode detection:** moved out of `chatOpenAI` and into `chat()` via `SCHEMAS_MODELS` lookup. Caller can also override via `config.mode`.

**Schema mode fix:** When `mode === "schema"`, do NOT add `tools`/`tool_choice` to the payload. Eliminates the "both response_format AND tools" collision bug (`llm.ts:83-89`).

**`chatOpenAI` return:** Always return `{ message: { content: parsedProse }, toolCalls }` — never return the raw JSON envelope as `content`. Parse the envelope internally, surface the `content` field as the display string.

### 1.3 Refactor `src/cli.ts` — `getLLMResponse`

**New signature:**
```ts
async function getLLMResponse(
  userInput: string,
  history: Turn[]
): Promise<{ response: string; newTurns: Turn[] }>
```

**Internal loop uses `Turn[]`** instead of `ChatMessage[]`.

**History returned** includes all intermediate tool turns (tool calls + results), not just the final assistant reply. `startInteractive` appends `newTurns` to the session history so each new prompt sees what tools were used previously.

**Fix:** `loadProjectContext` called once at the start of `getLLMResponse`, not inside the loop.

---

## Phase 2 — Security Gates

### 2.1 Workspace boundary in `src/fileOps.ts`

In `readFile` (and `writeFile`/`editFile` when added as tools):

```ts
const resolved = path.resolve(filePath);
const workspace = process.cwd();
if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
  return { success: false, error: `Path outside workspace: ${filePath}` };
}
```

### 2.2 Confirmation gate in `src/cli.ts` (tool registration wrapper)

Before `runCommand` executes, print the command and prompt `[y/n/a(lways)]`. Track `alwaysAllow: boolean` in session state. If "n", return `{ success: false, error: "Cancelled by user" }`.

Implemented as a wrapper in `src/cli.ts` tool registration (not inside `shell.ts` itself, to keep `shell.ts` pure).

---

## Phase 3 — Bug Fixes

### 3.1 `src/toolParser.ts`
- **Remove format-6 plain-name fallback** (lines 108–114). It fires on any prose mention of a tool name with empty args → spam loops.
- **Fix dead format-2 regex** (line 46): `[\r\n]+\[\/TOOL_CALL\]` never matches. Either fix the regex or remove the dead branch.
- **Guard `JSON.parse` in `parseFunctionCalls`** (line 144): wrap in try/catch, return `[]` on parse error.

### 3.2 `src/fileOps.ts`
- **Fix `editFile`**: replace `content.replace(oldString, newString)` with `content.split(oldString).join(newString)` to handle all occurrences and avoid `$&` injection.

### 3.3 `src/llm.ts`
- **Guard `JSON.parse(tc.function.arguments)`** (line 118) in `chatOpenAI`.

### 3.4 `src/providers.ts` + `src/state.ts`
- **Fix default OpenRouter model**: change from `nvidia/nemotron-3-super-120b-a12b:free` (non-existent) to a working free model (e.g. `google/gemma-3-27b-it:free`).

### 3.5 `src/cli.ts`
- **Fix `-d` shorthand**: add `flag === "-d"` alongside the existing `"--debug"` check (line 332).
- **Guard `fn(tc.arguments)` in `executeToolCalls`**: wrap in try/catch so a throwing tool doesn't crash the whole loop.

---

## Phase 4 — README Cleanup

Remove the following false sections from `README.md`:
- CLI subcommands (`read`, `write`, `search`, `run`, `help`, `context`) — these run args as shell commands, not subcommands
- REPL commands `:apikey`, `:logs`, `:save` — not implemented

Update README to accurately reflect what exists: `:quit`, `:help`, `:clear`, `:provider`, `:files`, `:context`.

---

## Phase 5 — Next Stage Features

### 5.1 Streaming responses

**Scope**: OpenRouter/OpenAI-compatible only (both schema and native modes).

**Implementation in `chatOpenAI`:**
- Add `stream: true` to payload
- Use `response.body` (ReadableStream) + `TextDecoder` to parse SSE lines
- Each `data: {...}` line: extract `choices[0].delta.content` and write to stdout with `process.stdout.write()`
- For schema mode: accumulate full content string, parse JSON envelope at end-of-stream
- For native mode: accumulate content + tool_call argument deltas, parse complete args at end-of-stream
- Remove spinner; streaming replaces it as the "working" indicator

**UI**: print the assistant prefix once, then stream chunks inline. Print newline when stream completes.

### 5.2 `writeFile` + `editFile` tools

Register both as tools in `src/cli.ts`:

**`writeFile` schema:**
```json
{ "name": "writeFile", "parameters": { "path": "string", "content": "string" } }
```

**`editFile` schema:**
```json
{ "name": "editFile", "parameters": { "path": "string", "oldString": "string", "newString": "string" } }
```

Both use the fixed `fileOps.ts` implementations with workspace boundary checks. Both require the same `[y/n/a]` confirmation as `runCommand` (destructive ops need a gate).

Update system prompt to document the two new tools.

### 5.3 Session persistence

**Save:** `:save` REPL command serializes `Turn[]` history to `.lee-sessions/SESSIONID.json`.

**Resume:** `--continue <file>` CLI flag loads a saved session file into `history` before entering the interactive loop.

**Format:**
```json
{ "sessionId": "...", "savedAt": "...", "turns": [...] }
```

---

## Critical Files

| File | Changes |
|---|---|
| `src/conversation.ts` | **New** — `Turn` type, `AgentMode` type |
| `src/llm.ts` | Accept `Turn[]`, add serializers, fix schema/native collision, fix JSON.parse guard |
| `src/cli.ts` | Use `Turn[]` history, new `getLLMResponse` signature, security gates, new tools, streaming wiring, session flags |
| `src/fileOps.ts` | Workspace boundary, fix `editFile` split/join |
| `src/shell.ts` | Stays pure; confirmation wrapper lives in cli.ts |
| `src/toolParser.ts` | Remove format-6, fix format-2 regex, guard JSON.parse |
| `src/providers.ts` + `src/state.ts` | Fix default model |
| `README.md` | Remove false docs |

---

## Verification

1. **Build**: `npm run build` — zero TypeScript errors
2. **Tests**: `npm test` — existing tests pass; add tests for:
   - `editFile` with `$&` in replacement string
   - `readFile` with path outside cwd → rejected
   - `parseFunctionCalls` with malformed JSON arguments → returns `[]`
3. **Manual — multi-turn with schema mode**:
   - Start with OpenRouter qwen3 (schema model)
   - Ask: "What files are in this project?"
   - Ask follow-up: "Now read the package.json" — verify model knows it already did a `searchFiles`
4. **Manual — native mode**:
   - Switch to a native-mode OpenRouter model
   - Ask a question requiring a tool call
   - Verify second iteration doesn't 400 from missing `tool_call_id`
5. **Security**:
   - Ask model to read `../../etc/passwd` → workspace boundary rejects it
   - Ask model to run `echo hello` → confirmation prompt appears
6. **Streaming**: verify tokens appear progressively, no spinner shown
