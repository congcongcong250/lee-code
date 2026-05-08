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
## [Date] - [Title]

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