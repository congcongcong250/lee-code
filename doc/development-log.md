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

```
## [YYYY-MM-DD HH:MM] - [Title]

**Iteration**: [commit or version]
**Problem**: [What was the issue]
**Solution**: [How it was solved]
**Caveat**: [Any gotchas or注意事项]
**Solved**: [✓ or what's left]
**Not Solved**: [if any]
**Reason/Lesson**: [Why this happened, what was learned]
```

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

## 2026-05-09 - Comprehensive Tool Call Format Tests

**Iteration**: `338fed3`
**Problem**: No tests for all the different tool call formats - hard to verify parser works
**Solution**: Added 21 tests covering all 6 formats: [TOOL_CALL], multiline, XML self-closing, XML paired, backtick, plain name
**Caveat**: Had to fix a failing test that expected "readFile" in text that didn't contain it
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Tests are essential - found issues that would have been missed

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

## 2026-05-09 - Debug Mode Added

**Iteration**: `0114930`
**Problem**: User couldn't see what was happening when app got stuck
**Solution**: Added `--debug` flag and debug logging system with timestamps
**Caveat**: Initially parsed `--debug` as a command - needed to filter flags separately
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: Every feature should be debuggable from the start

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

## 2026-05-09 - Verbose Mode Implementation

**Iteration**: `870c3fb`
**Problem**: User wanted to see full LLM requests/responses for debugging
**Solution**: Added `--verbose/-v` flag that logs all LLM interactions to JSONL file
**Caveat**: None
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: LLM integration needs observability - verbose mode is essential

---

## 2026-05-09 - Tool Calling with Agentic Loop

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

## 2026-05-09 - API Key Management

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

## 2026-05-09 - OpenRouter/MiniMax Integration

**Iteration**: `0a9f190`
**Problem**: Wanted free access to MiniMax M2.5 through OpenRouter
**Solution**: Added OpenRouter as new provider with MiniMax M2.5 free model
**Caveat**: User's Groq key (gsk_...) doesn't work with OpenRouter (needs sk-or-...)
**Solved**: ✓ (OpenRouter works, just needs correct key)
**Not Solved**: Getting free OpenRouter key
**Reason/Lesson**: Not all keys work everywhere - always verify

---

## 2026-05-09 - Initial LLM Integration

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

## 2026-05-09 - Initial Implementation (One Shot)

**Iteration**: `ed20c13`
**Problem**: N/A - initial commit
**Solution**: Created basic CLI with file operations, search, command execution, interactive CLI, project context
**Caveat**: N/A
**Solved**: ✓
**Not Solved**: LLM integration (added later)
**Reason/Lesson**: Start with core features, then iterate

---

## 2026-05-09 - vLLM Server-Side Tool Parsing Strategy

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

## 2026-05-09 - Refactor Fuzzy Parser to Module

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

## 2026-05-09 14:55 - Use OpenRouter Free Model

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

## 2026-05-09 15:30 - Strict JSON Schema for Tool Calling

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

## 2026-05-09 16:00 - Schema Parsing + UX Improvements

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

## 2026-05-09 16:30 - Code Refactor + Colored UI

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

## Plan: vLLM/SGLang Integration

### Research Findings

1. **vLLM** provides built-in tool parsers:
   - `--tool-call-parser` selects parser (llama3_json, hermes, minimax_m2)
   - `--enable-auto-tool-choice` enables automatic tool calling
   - Provides OpenAI-compatible API at `http://localhost:8000/v1`

2. **Usage**:
   ```bash
   # Start vLLM with MiniMax model
   vllm serve MiniMaxAI/MiniMax-M2.5 \
     --tool-call-parser minimax_m2 \
     --reasoning-parser minimax_m2 \
     --enable-auto-tool-choice \
     --trust-remote-code
   ```

3. **lee-code Integration**:
   - Add vLLM as new provider in llm.ts
   - Base URL: `http://localhost:8000/v1`
   - No API key needed for local server
   - vLLM handles all tool parsing internally
   -lee-code receives clean `tool_calls` in response

### Implementation Steps

1. Add vLLM provider to `llm.ts` with base URL `http://localhost:8000/v1`
2. Add vLLM config options (model, parser settings)
3. Add `:vllm` interactive command to start/stop vLLM server
4. Keep fuzzy parser as fallback for remote APIs
5. Document vLLM setup in README

---

## 2026-05-10 23:31 - Critical Tool Calling Fixes After Refactoring

**Iteration**: Multiple commits (`12a39dd` through `7162c95`)
**Problem**: After MiniMax M2.5 refactoring, tool calling was completely broken. Multiple critical bugs required manual fixes through 12+ commits.
**Solution**: Fixed 7 critical bugs:
1. Tools never registered - added `registerTool()` calls at CLI startup
2. Empty string content parsing failed - changed `parsed.content &&` to `parsed.content !== undefined`
3. Tool schemas not sent to LLM - added schema definitions when registering tools
4. Wrong message order -assistant now pushed before tool results
5. Duplicate assistant messages - moved outside loop
6. Duplicate code - extracted `executeToolCalls()` function
7. Tool argument mismatches - accept multiple property names

**Caveat**: Post-refactoring verification is critical - core functionality was silently broken.
**Solved**: ✓
**Not Solved**: -
**Reason/Lesson**: After any refactoring, ALWAYS verify core functionality works. Unit tests existed but didn't catch that tools were never registered or that message accumulation was broken. Key bugs:
- `registerTool()` was defined but NEVER CALLED
- Empty string `""` is falsy - used wrong check
- Functions registered but no parameter schemas defined
- Message chain order was wrong (tool before assistant)

These bugs were invisible without integration testing the full agent loop. Test coverage showed 65 tests but only ~18% tested actual system behavior - most were trivial unit tests that didn't verify real functionality.

---