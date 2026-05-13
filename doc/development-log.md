# Development Log

## Overview

lee-code is a CLI coding assistant inspired by Claude Code. It's designed to be an agentic coding tool that:
- Reads and edits files in the codebase
- Searches files using glob patterns
- Executes shell commands
- Provides an interactive REPL with history
- Connects to LLMs (Groq, OpenAI, Anthropic, OpenRouter, Ollama, HuggingFace)
- Supports tool calling with vLLM/SGLang server-side parsing or fallback fuzzy client parsing
- Logs all LLM interactions for debugging

**Architecture Strategy**: Use vLLM or SGLang as local server when available for proper tool calling. Fall back to client-side fuzzy parsing for remote APIs that don't support function_calling.

## Entry Template

The log mixes small one-iteration entries with larger retrospectives. Use whichever shape fits the change.

### Small entry (single iteration / one bug)

```markdown
## YYYY-MM-DD HH:MM — Title

> **Iteration**: `<commit or tag>` · **Type**: Feature | Fix | Refactor | Process

**Problem**  — what was wrong
**Solution** — what was done
**Lesson**   — why it happened, what to remember
**Open**     — anything left (omit if none)
```

### Retrospective entry (multi-commit work, reviews, process changes)

```markdown
## YYYY-MM-DD — Title

> **Iteration**: `<tag or commit range>` · **Type**: Review | Refactor | Process

### Context
Why this work happened — the trigger, the constraint, the question.

### What changed
Prose or a short table. For multi-commit work, a stage-by-stage table
beats a wall of bullets.

### Lessons
For future-me. Be specific — "tests caught X because we asserted Y" is
more useful than "tests are good".

### Open items
Anything left undone. Skip if none.
```

**Formatting guidance**
- Lead with a 1–2 sentence summary so the entry is scannable.
- Quote the relevant tag / commit short-sha so `git show` is one step away.
- "Lessons" is the section future-you will actually re-read. Make it earn its place.

---

## 2026-05-08 22:00 - Initial Implementation (One Shot)

**Iteration**: `ed20c13`
**Problem**: N/A - initial commit
**Solution**: Created basic CLI with file operations, search, command execution, interactive CLI, project context
**Caveat**: N/A
**Solved**: ✓
**Not Solved**: LLM integration (added later)
**Reason/Lesson**: Start with core features, then iterate

---

## 2026-05-09 22:30 - Initial LLM Integration

**Iteration**: `8c56c85`
**Problem**: CLI tool didn't connect to any LLM - just local commands
**Solution**: Added LLM integration with multiple providers:
- Groq (default)
- OpenAI
- Anthropic
- Ollama
- OpenRouter
- HuggingFace
**Caveat**: Initially used react-ink but it had TypeScript JSX issues - simplified to readline
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Start simple, add complexity only when needed

---

## 2026-05-09 22:45 - OpenRouter/MiniMax Integration

**Iteration**: `0a9f190`
**Problem**: Wanted free access to MiniMax M2.5 through OpenRouter
**Solution**: Added OpenRouter as new provider with MiniMax M2.5 free model
**Caveat**: User's Groq key (gsk_...) doesn't work with OpenRouter (needs sk-or-...)
**Solved**: ✓ (OpenRouter works, just needs correct key)
**Not Solved**: Getting free OpenRouter key
**Reason/Lesson**: Not all keys work everywhere - always verify

---

## 2026-05-09 23:00 - API Key Management

**Iteration**: `24e9cc2`
**Problem**: API keys from different providers were mixed up (GROQ_API_KEY used for OpenRouter etc.)
**Solution**: Each provider now uses its own specific env variable
- OPENROUTER_API_KEY for OpenRouter
- OPENAI_API_KEY for OpenAI
- GROQ_API_KEY for Groq
- ANTHROPIC_API_KEY for Anthropic
- HF_TOKEN for HuggingFace
**Caveat**: Had to update default provider to Groq (which worked with available key)
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Never mix keys - each provider is independent

---

## 2026-05-09 23:15 - Tool Calling with Agentic Loop

**Iteration**: `d145617`
**Problem**: LLM outputs `[TOOL_CALL]` blocks but wasn't actually calling tools
**Solution**: Added agentic loop that:
1. Sends request to LLM
2. Parses tool calls from response
3. Executes tools and feeds results back
4. Repeats up to 5 iterations
**Caveat**: Groq models may not support function_calling API - uses fuzzy text parsing
**Solved**: ✓ (with fuzzy parsing)
**Not Solved**: Native function_calling support for Groq
**Reason/Lesson**: Need both API-level and text-parsing-level tool calling

---

## 2026-05-09 - Verbose Mode Implementation

**Iteration**: `870c3fb`
**Problem**: User wanted to see full LLM requests/responses for debugging
**Solution**: Added `--verbose/-v` flag that logs all LLM interactions to JSONL file
**Caveat**: None
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: LLM integration needs observability - verbose mode is essential

---

## 2026-05-09 - Verbose Logging for LLM Interactions

**Iteration**: `b784118`
**Problem**: Verbose logs only saved on `:quit` - if crash or interruption, logs were lost
**Solution**: Save logs immediately after each LLM interaction (request and response)
**Caveat**: Need to save logs incrementally for crash recovery
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Save early, save often - don't wait for perfect moment

---

## 2026-05-09 - Debug Mode Added

**Iteration**: `0114930`
**Problem**: User couldn't see what was happening when app got stuck
**Solution**: Added `--debug` flag and debug logging system with timestamps
**Caveat**: Initially parsed `--debug` as a command - needed to filter flags separately
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Every feature should be debuggable from the start

---

## 2026-05-09 - Refactored Fuzzy Tool Parser

**Iteration**: `993ecad`
**Problem**: Tool calls from LLM weren't being detected - parsing was too fragile
**Solution**: Rewrote parser to handle multiple formats with fuzzy matching
- Format 1: `[TOOL_CALL]{tool => "name", args => { --key value }}`
- Format 2: `[TOOL_CALL]...[/TOOL_CALL]` multiline
- Format 3: XML-like `<invoke><invokeName>name</invokeName>`
- Format 4: Backtick `tool: value`
**Caveat**: Had multiple duplicate functions that needed cleanup
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: LLM output formats are inconsistent - fuzzy matching is essential

---

## 2026-05-09 - Comprehensive Tool Call Format Tests

**Iteration**: `338fed3`
**Problem**: No tests for all the different tool call formats - hard to verify parser works
**Solution**: Added 21 tests covering all 6 formats: [TOOL_CALL], multiline, XML self-closing, XML paired, backtick, plain name
**Caveat**: Had to fix a failing test that expected "readFile" in text that didn't contain it
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Tests are essential - found issues that would have been missed

---

## 2026-05-09 - Tool Parser Format 6: Simple XML Content

**Iteration**: `9ab9477`
**Problem**: LLM outputs `<searchFiles>*.ts</searchFiles>` but parser didn't handle this simple XML content format
**Solution**: Added regex `/<(\w+)>([^<]+)<\/\1>/gi` to parse `<toolName>value</toolName>` format
**Caveat**: None - simple format works well
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Different LLMs output tool calls in different ways - need to support a wide variety of formats

---

## 2026-05-09 - XML-Style Tool Call Format

**Iteration**: `28902a5`
**Problem**: LLM outputs `<runCommand(command: "ls -la")></runCommand>` but parser didn't support this
**Solution**: Added regex to match XML self-closing and paired tag format with parameters
**Caveat**: Had to fix a typo (`uzzyMatch` -> `fuzzyMatch`)
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: LLMs use varied XML-like formats - need flexible parsing

---

## 2026-05-09 00:05 - vLLM Server-Side Tool Parsing Strategy

**Iteration**: N/A (strategy decision)
**Problem**: LLM outputs various internal formats (python lists like `searchFiles(["chat*.py"])`) that require increasingly complex client-side fuzzy parsing
**Solution**: Use vLLM or SGLang server with built-in tool parsers instead of client-side fuzzy parsing:
```bash
vllm serve MiniMaxAI/MiniMax-M2.5 \
  --tool-call-parser minimax_m2 \
  --reasoning-parser minimax_m2 \
  --enable-auto-tool-choice \
  --trust-remote-code
```
vLLM converts MiniMax's internal XML-ish tool format → proper `tool_calls` API response
**Caveat**: Need to integrate vLLM/SGLang as local server in lee-code
**Solved**: ✓ (identified solution path)
**Not Solved**: vLLM/SGLang server integration implementation
**Reason/Lesson**: Don't bloat client with fuzzy parsing - server should do proper tool parsing. Lesson learned from dealing with 6+ different formats.

---

## 2026-05-09 00:15 - Refactor Fuzzy Parser to Module

**Iteration**: N/A (current refactor)
**Problem**: Tool parsing code scattered in index.ts, hard to maintain
**Solution**: Extracted to `src/toolParser.ts`:
- `fuzzyMatch()` - string fuzzy matching
- `parseToolCallsFromText()` - all text format parsers (6 formats)
- `parseFunctionCalls()` - vLLM/SGLang server format parser
- Added proper TypeScript types
**Caveat**: Need to update all imports
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Separate concerns early - parsing is its own module

---

## 2026-05-09 00:30 - Use OpenRouter Free Model

**Iteration**: N/A (current change)
**Problem**: vLLM/SGLang requires self-hosting which is not practical for this use case
**Solution**: Switch to OpenRouter's built-in free tier which automatically routes to available free models:
- Changed default model from `minimax/minimax-m2.5:free` to `openrouter/free`
- OpenRouter's `free` endpoint auto-selects from available free models
- Removes need for vLLM/SGLang integration
**Caveat**: Model selection is automatic - may get different models per request
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: OpenRouter free tier is simpler than self-hosted vLLM for this use case

---

## 2026-05-09 00:45 - Strict JSON Schema for Tool Calling

**Iteration**: N/A (current change)
**Problem**: OpenRouter model responses vary in format, need strict schema enforcement for consistent tool calling
**Solution**: Use OpenRouter's `response_format` with JSON Schema + provider routing:
1. Added `SCHEMA_JSON` to llm.ts with:
   - `status`: enum ["continue", "finished", "error", "ask_user"]
   - `content`: text to user
   - `tool_calls[]`: array of {id, name, arguments}
   - `version`: "1.0" for schema evolution
2. Added `response_format: { type: 'json_schema', json_schema: {...} }` to OpenRouter API calls
3. Added `provider: { require_parameters: true }` to force routing to schema-supporting models
4. Added `parseSchemaResponse()` helper to parse JSON from model output
   - Strips markdown code fences before parsing
   - Handles malformed JSON gracefully
5. Changed default model from `openrouter/free` to `minimax/minimax-m2.5:free`
   - Red team found generic router doesn't consistently support strict schemas
**Solved**: ✓
**Not Solved**: Need to test actual API calls with the schema
**Reason/Lesson**: Structured outputs require specific model selection, auto-routing is unreliable
**Red Team Issues Addressed**:
- HIGH: Changed from auto-routing to specific model
- HIGH: Added error/ask_user status enums
- MEDIUM: Added markdown stripping before parse
- MEDIUM: Added tool_calls array support

---

## 2026-05-09 01:00 - Schema Parsing + UX Improvements

**Iteration**: N/A (bug fix + UX improvements)
**Problem**: 
1. Schema model responses weren't parsed - fell back to fuzzy parsing
2. Max 5 iterations too short
3. No user feedback during agent loop - UX not good
**Solution**:
1. Fixed `parseSchemaResponse()` to accept partial content (status + version only)
2. Added extraction of `tool_calls` from schema JSON in `chatOpenAI()`
3. Changed MAX_ITERATIONS from 5 to 10
4. Added UX output:
   - Display LLM response (truncated to 500 chars)
   - Show tools being called with `⚙️ Calling:`
   - Show tool results with `→ ` (truncated to 200 chars)
5. Added data-driven model config: OPENROUTER_MODELS with schema/native modes
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Schema tools don't always return full content - need status+version for validation

---

## 2026-05-09 01:15- Code Refactor + Colored UI

**Iteration**: N/A (refactor)
**Problem**: Monolithic index.ts and llm.ts files hard to maintain
**Solution**:
1. Split index.ts into modular structure:
   - cli.ts: Main CLI entry and agent loop
   - ui.ts: Colored UI output functions with COLORS
   - state.ts: Application state management
   - fileOps.ts: File operations (read, write, edit, search)
   - shell.ts: Shell command execution
   - context.ts: Project context loading
2. Split llm.ts into:
   - llm.ts: LLM chat functions
   - providers.ts: Provider configurations
   - schema.ts: JSON schema and parseSchemaResponse
3. Add colored terminal output:
   - Header with cyan background
   - User prompt in cyan
   - Assistant messages in white
   - Tool calls in yellow
   - Results in green
   - Errors in red
   - Provider/model selection shows schema/native mode
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Modular structure easier to test and maintain

---

## 2026-05-10 23:55 - Critical Tool Calling Fixes After Refactoring (COMPREHENSIVE)

**Iteration**: Multiple commits (`12a39dd` through `7162c95`)
**Problem**: After MiniMax M2.5 refactoring, tool calling was COMPLETELY BROKEN. User had to manually fix 7 critical bugs.
**Solution**: Fixed through 12+ commits:
1. Tools never registered - added `registerTool()` calls at CLI startup
2. Empty string content parsing failed - changed `parsed.content &&` to `parsed.content !== undefined`
3. Tool schemas not sent to LLM - added schema definitions with parameters
4. Wrong message order - assistant now pushed BEFORE tool results
5. Duplicate assistant messages - moved outside loop
6. Duplicate code - extracted `executeToolCalls()` reusable function
7. Tool argument mismatches - accept multiple property names (pattern/path, command/cmd)

**Caveat**: NONE - these were all critical bugs that should NEVER have happened

**Solved**: ✓ (but at high manual cost)

**Not Solved**: 
- No try-catch in tool execution (throws will crash function)
- Unknown tool handling still inconsistent between paths
- No E2E verification that tool results reach LLM

### RED TEAM: What You Had to Fix Manually (Root Cause Analysis)

#### Bug 1: Tools Never Registered
- **Root Cause**: Post-refactoring, `registerTool()` was defined but NEVER CALLED
- **Why**: Function existed in tools.ts but CLI never called it
- **Fix**: Added registration at CLI startup in cli.ts
- **Why Forced to Fix Manually**: No test verified tools were registered and callable

#### Bug 2: Empty String Schema Parsing
- **Root Cause**: `parsed.content && parsed.version` - empty string "" is FALSY in JavaScript!
- **Why**: Used truthy check instead of explicit undefined check  
- **Fix**: Changed to `parsed.content !== undefined && parsed.version`
- **Why Forced to Fix Manually**: Edge case not tested - tests used non-empty strings

#### Bug 3: Tool Schemas Not Sent
- **Root Cause**: `registerTool(fn)` stored function but NOT schema definition
- **Why**: No schema parameter in registration, no `getToolSchema()` function
- **Fix**: Added `registerTool(name, fn, schema)` with schema parameter
- **Why Forced to Fix Manually**: No test verified LLM received correct parameter names

#### Bug 4: Wrong Message Order  
- **Root Cause**: Push inside loop - tool pushed BEFORE assistant
- **Why**: Loop structure confused placement of messages.push()
- **Fix**: Pushed assistant first, then tool results
- **Why Forced to Fix Manually**: No test verified actual message ORDER in chain

#### Bug 5: Duplicate Assistant Messages
- **Root Cause**: `messages.push(assistant)` was INSIDE the tool loop
- **Why**: Each iteration = one more assistant message
- **Fix**: Moved outside loop
- **Why Forced to Fix Manually**: No test counted messages after multiple tools

#### Bug 6: Duplicate Code
- **Root Cause**: Identical tool execution code in 2 places (schema path + non-schema path)
- **Why**: Copied logic instead of extracting function
- **Fix**: Extracted `executeToolCalls()` function
- **Why Forced to Fix Manually**: No abstraction - just copy-paste

#### Bug 7: Argument Name Mismatch
- **Root Cause**: Model sent `path`, tool expected `pattern`
- **Why**: System prompt said one thing, code expected another
- **Fix**: Accept both: `(args.pattern || args.path)`
- **Why Forced to Fix Manually**: No alignment between prompt and code

### RED TEAM: What Was Missed

1. **No integration test for full agent loop** - Unit tests existed but none tested full flow
2. **No try-catch in tool execution** - If tool throws, entire function crashes
3. **No verification that tool results REACH LLM** - Trusting but not verifying
4. **Unknown tool handling inconsistent** - Schema path silently skips, non-schema adds error message
5. **Test coverage is misleading** - 65 tests but ~18% meaningful (rest are trivial)

### KEY LEARNINGS

1. **After ANY refactoring, MUST verify core functionality works**
   - Not just "tests pass" - need actual E2E verification

2. **Unit tests are NOT enough**
   - Need integration tests that test the full agent loop
   - Need tests that verify message ORDER and CONTENT

3. **Be explicit with JavaScript checks**
   - Use `!== undefined` not truthy checks
   - Test edge cases: "", null, undefined

4. **Trust but verify**
   - Don't assume schema enforcement works - test it
   - Don't assume tool results reach LLM - verify logs

5. **Extract reusable code**
   - Don't duplicate logic - creates maintenance nightmares

6. **Log at each step for debugging**
   - Would have caught these issues much faster

### What Tests Should Have Caught These Bugs

1. Test that calls a tool and verifies tool result IS in next LLM message
2. Test that multiple tools = ONE assistant message (not N duplicates)
3. Test with empty string content ""
4. Test that schemas DEFINITIONS are accessible (not just functions)
5. Test actual message chain order after tool execution

### Final Status: 2026-05-10 23:55

Tool calling NOW WORKS but required 12+ manual fixes. This should have been caught by proper integration testing, not by manual debugging.

---

## 2026-05-11 — Red-Team Code Review (Opus 4.7)

> **Iteration**: tag `stage-opencode-minimax-M2.5-Free` · **Type**: Review

### Context
After the 2026-05-10 firefight ("12+ manual fixes for tool calling"), the codebase finally *worked* on the happy path — but only after a string of fragile patches. Before going further, I wanted an honest read of what was actually broken vs. what just happened to work. I ran a structured red-team review with Opus 4.7 in two independent passes (primary reviewer + isolated sub-agent) so I could trust findings that both passes reached. Output landed in `doc/Code-Review-opus-4.7-05-11.md`.

### What changed
No code changed in this entry — it's the diagnostic. The review produced:

| Bucket | Count | Examples |
|---|---|---|
| 🔴 Critical security | 5 | `runCommand` shells with no allow-list, `readFile` traverses anywhere on disk, API keys un-redacted in JSONL logs |
| 🐛 Provider correctness | 6 | `chatAnthropic` only sends the first user message; OpenAI `tool_call_id` dropped on the wire; default OpenRouter model id doesn't exist |
| 🐛 Tool / parser bugs | 5 | format-2 regex is dead; format-6 plain-name fallback spam-loops on prose; `editFile` uses `String.replace` which expands `$&` |
| 🐛 Lifecycle / leaks | 7 | log arrays unbounded; `saveLLMLogs` rewrites JSONL every iteration; spinner always reports success |
| 📚 Doc lies | 3 | CLI subcommands and REPL commands (`:apikey`, `:logs`, `:save`) documented but never implemented |

The most valuable section was §9 — a deep dive on **the central architectural defect**: one `ChatMessage[]` array trying to be two incompatible protocols (native function-calling and strict-JSON schema). That single insight reframed many "individual" bugs as symptoms of one structural problem.

### Lessons
- **Two independent reviews converge on the real bugs.** The `[A+B]` findings (both passes agreed) had a much higher signal-to-noise ratio than `[A]`-only or `[B]`-only ones. Worth the extra pass.
- **A patch list and an architecture diagnosis are different deliverables.** The "Top 10" table told me *what to fix*; §9 told me *why those bugs existed*. Without §9, the fix list would have been whack-a-mole.
- **The yesterday-firefight bugs were predictable from the architecture.** Most of the 12 manual fixes from 2026-05-10 mapped to the protocol-mixing problem. Fixing the architecture would have prevented them.

### Open items
The review is read-only — every finding still needed to be addressed. That became the 2026-05-14 work below.

---

## 2026-05-14 — Tooling Switch: Claude Code + Superpowers + a Custom `grill-me` Skill

> **Iteration**: pre-implementation setup · **Type**: Process

### Context
The 2026-05-10 entry already flagged that "trust but verify" and "integration tests, not just unit tests" were the missing disciplines. The review on 2026-05-11 made that explicit. Going into the fix work, I wanted a session shape that *forced* explicit decisions and scope-narrowing **before** any code was written — not after.

### What changed
- **Switched the driver model** from the previous opencode setup to Claude Code with Opus 4.7.
- **Installed the `superpowers` plugin** — gives access to disciplined skills like `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, etc. Each skill is a small contract the model agrees to follow.
- **Created a custom `grill-me` skill** at `~/.claude/skills/grill-me/SKILL.md`. The skill instructs the model to interview me relentlessly about a plan, walking the decision tree branch-by-branch and providing a recommended answer for each question, before any implementation begins.

The `grill-me` session before the implementation produced 6 forced decisions:
1. Goal of the project (learning vs. daily-driver vs. portfolio) → **learning** ⇒ architectural depth is worth the time.
2. Which providers are actually tested → **OpenRouter schema + native only** ⇒ Anthropic/HF are explicitly out of scope.
3. Patch-by-patch vs. proper refactor for the message layer → **full refactor** (typed `Turn[]` + per-mode serializers) ⇒ fixes 6 bugs by construction instead of independently.
4. Add security gates? → **yes, minimal** (workspace boundary + `[y/n/a]` for `runCommand`).
5. Which "next stage" features → **streaming + writeFile/editFile tools + session persistence**.
6. Implement or delete fake REPL commands (`:apikey`, `:logs`, `:save`) → **delete the docs**, not the code.

### Lessons
- **`AskUserQuestion` + `grill-me` flipped the cost of indecision.** Cheap to ask, expensive to discover mid-implementation. Decision #6 alone (delete vs. implement) saved an entire stage's worth of work.
- **A "recommended answer" beside each question keeps the interview moving.** Pure open-ended questions stall; defaults that I can say "yes, recommended" or "no, here's why" to converge fast.
- **Plan mode forced a written plan before any edits.** The plan file (`/Users/lirenxn/.claude/plans/vectorized-munching-thimble.md`, then copied as `doc/Code-Fix-Plan-sonnet-4.7-05-14.md`) became the contract for the 13 stages below — every commit could be traced back to a stage in the plan.
- **Skills are leverage but only if they're *invoked*.** `using-superpowers` is the meta-skill that nags the model to check for relevant skills before acting. Without it, I'd have skipped `brainstorming` on the first task and re-learned 2026-05-10 the hard way.

### Open items
The plugin/skill workflow is great for big greenfield decisions but heavier than needed for micro-fixes. Worth re-evaluating after a few more sessions whether the ceremony cost stays in line.

---

## 2026-05-14 — Full Refactor + Next-Stage Features (13 Stages)

> **Iteration**: `stage-opencode-minimax-M2.5-Free` → `9bd6c30` (14 commits) · **Type**: Refactor + Feature

### Context
Executing the plan locked in by the `grill-me` interview. The plan separated concerns into 13 stages, each with its own commit, so reviewability stayed high. Test count grew from 65 → 228 (+163).

### What changed

| # | Commit | Stage | Key change |
|---|---|---|---|
| 1 | `ca8f9cb` | Turn type | `Turn` discriminated union + `AgentMode` in `src/conversation.ts` |
| 2 | `0ce6a67` | Serializers | Pure `serializeForOpenAINative / OpenAISchema / Ollama` in `src/serializers.ts` |
| 3 | `58e1e6f` | Agent refactor | `chat()` accepts `Turn[]`; new `src/agent.ts` owns the loop with injectable `chat` fn; loop returns full `newTurns[]` delta (regression fix for the lost-history bug) |
| — | `c403f01` | chore | Gitignore session-log artifacts so tests don't dirty the worktree |
| 4 | `e2c1724` | Workspace boundary | `resolveWithinWorkspace()` rejects `../` and absolute escapes; gates `readFile / writeFile / editFile` (closes S2) |
| 5 | `ded28b6` | Confirm gate | `[y/n/a(lways)]` prompt before `runCommand`; per-tool / per-session always-set (closes S1, S4) |
| 6 | `d058858` | toolParser | Killed plain-name fallback (B7), fixed dead format-2 regex (B8), guarded `JSON.parse` (B5) |
| 7 | `61f686b` | editFile | `split/join` instead of `String.replace`; require unique match unless `replaceAll:true` (closes B9 + a silent multi-match bug) |
| 8 | `8b09ea8` | Default model | Switched from the non-existent `nvidia/nemotron-...` to `qwen/qwen3-next-80b-a3b-instruct:free` (closes B6) |
| 9 | `3aaf490` | `-d` flag | Recognise `-d` as shorthand; extracted `parseArgs` for testability (closes B21) |
| 10 | `c273f4d` | README | Removed fake CLI subcommands, fake REPL commands, the false "writes files" claim, and the silently-broken Anthropic/HF promises |
| 11 | `61e21ba` | Streaming | SSE streaming for OpenAI-shaped providers; tool-call deltas accumulated by `index`; partial frames across read boundaries handled; spinner kept as fallback |
| 12 | `eef28a5` | Write/Edit tools | Registered `writeFile`/`editFile` as agent tools, gated by `ConfirmGate` and workspace boundary; system prompt updated to teach them to the model |
| 13 | `9bd6c30` | Session persistence | `:save` REPL command + `--continue <file>` flag; strict v1 schema validation on load |

**The architectural pivot — Stage 3 — is the highest-leverage commit.** Once `Turn[]` is the canonical history and each provider+mode has its own serializer, several "independent" bugs from the review (B1, B4, schema-envelope-in-history, parallel-tool-call id collisions) disappear by construction. Streaming, write/edit tools, and session persistence all sit cleanly on top because the type already knows what an `AssistantTurn` and a `ToolTurn` look like.

### Test posture (the thing yesterday's fires demanded)
Every stage adds at least one regression test that would catch the bug if it were reintroduced. Highlights:
- `tests/agent.test.ts` — fakes `chat()` and proves the loop returns *all* tool turns in the delta. The lost-history bug from 2026-05-10 cannot return silently.
- `tests/llm-wire.test.ts` — mocks `fetch` and asserts the request body. Schema-mode payload must NOT contain `tools`; native-mode must NOT contain `response_format`. The architectural collision can't recur.
- `tests/streaming.test.ts` — builds a real `ReadableStream<Uint8Array>` and feeds the parser SSE frames split across read boundaries. Proves the assembler works on the byte-level path that production hits.
- `tests/fileOps-boundary.test.ts` — includes the classic prefix-collision case (workspace `/tmp/a` vs. resolved `/tmp/abc/x`), the one that a naive `startsWith` would miss.
- `tests/editFile.test.ts` — explicit cases for `$&`, `$1`, `$$` in `newString` to lock in B9's fix.

### Lessons
- **One typed internal model + per-mode serializers > one polymorphic message array.** Said in the review §9; proven by Stage 3. Bugs B1, B4, B5, parallel-id collision, and schema-envelope-in-history were all fixed by the *shape change*, not by separate patches.
- **Dependency injection at the agent boundary unlocks real integration tests.** `getLLMResponse` accepts an injected `chat` function. That single seam is why `tests/agent.test.ts` exists — and why "did the loop pass the prior tool turn to iteration 2?" became a real test instead of a fingers-crossed manual check.
- **Mocked-`fetch` integration tests catch protocol bugs that unit tests can't.** The schema/native collision was invisible at the function level. It only showed up in the request body. The wire-level tests are now the contract.
- **Splitting commits by concern, not by file, makes review tractable.** Stages 6 (parser), 7 (editFile), 8 (default model) each touched different concerns and each has its own commit. The diff for any single concern is small enough to review carefully.
- **"Just delete the false docs" can be a legitimate fix.** Plan question #6 (implement vs. delete `:apikey/:logs/:save`) ended up choosing delete. Reduced scope by an entire stage and the README is now honest. Honesty in docs is a feature.
- **Tests pollute the worktree if you don't think about side effects.** `saveLLMLogs()` ran during the agent test suite and left JSONL files at repo root. Caught it after Stage 3; gitignored before it became a habit. Worth a teardown hook if more side-effects creep in.
- **Mocks are acceptable for integration tests** (per the user's explicit instruction). For everything that wasn't a real fetch (auth/model availability), a queued-prompt or scripted-`chat` mock was enough to prove the contract held.

### Open items
- `chatAnthropic` and `chatHuggingFace` are explicit "not implemented in Turn[] refactor" stubs. They were out of scope per Plan question #2. Re-enabling them is a future-stage refactor (one serializer + one HTTP path each).
- `loadProjectContext` still only reads `package.json` and `tsconfig.json`. The README's `CLAUDE.md / MEMORY.md` mention was deferred, not yet implemented.
- The `chatLegacy` shim in `src/llm.ts` is back-compat for callers that want the old `ChatResponse` shape. Once `:logs`-style callers (none today) are sure not to need it, it can be removed.
- `saveLLMLogs()` still uses sync `require("fs")` from `debug.ts` and rewrites the whole JSONL on every iteration (review's B13 / debug.ts mixed-module note). Not addressed in this batch; flagged for the next round of cleanup.

---