# lee-code

A learning-focused CLI coding assistant inspired by Claude Code. Drives a multi-provider LLM (OpenRouter primary; OpenAI, Groq, Ollama supported) through an agentic tool loop.

## Quick Start

```bash
npm install
npm run build
export OPENROUTER_API_KEY=sk-or-...
node dist/cli.js              # Interactive REPL
```

## Features

- **OpenRouter as primary provider** with both native function-calling and strict-JSON schema modes
- **Typed Turn[] internal history** with per-mode wire-format serializers (no schema-vs-native protocol mixing)
- **Agentic tool loop** with three tools: `readFile`, `searchFiles`, `runCommand`
- **Workspace boundary** on `readFile` / `writeFile` / `editFile` — paths outside `cwd` are rejected
- **Confirmation gate** (`[y/n/a]`) before every `runCommand` execution
- **Fuzzy text tool parser** as a fallback for models that don't return structured tool calls
- **JSONL session log** for debugging the agent loop end-to-end

## Interactive REPL

```
node dist/cli.js
❯ what files are in this project?
❯ :provider     # switch provider / model
❯ :files        # list files in workspace
❯ :context      # show loaded project context
❯ :clear        # reset conversation history
❯ :help         # list commands
❯ :quit
```

### REPL commands

| Command | Effect |
|---|---|
| `:quit` / `:q` | Exit |
| `:help` | Show this list |
| `:clear` | Reset chat history (keeps provider) |
| `:provider` | Pick a provider and model |
| `:files` | Print workspace file list |
| `:context` | Show the project context that was loaded into the system prompt |

## CLI flags

```
--debug, -d     # debug logging (shows iteration / tool / message counts)
--verbose, -v   # verbose mode: logs every LLM request/response to JSONL
```

Any positional arguments after the flags are joined and run via `runCommand` (the agent loop is interactive-only). To use the assistant non-interactively you currently need to drive it via the REPL.

## API keys

Set via env var:

| Provider | Env Variable | Notes |
|----------|------------|---|
| OpenRouter | `OPENROUTER_API_KEY` | Default. Free models supported. |
| OpenAI | `OPENAI_API_KEY` | |
| Groq | `GROQ_API_KEY` | OpenAI-compatible. |
| Ollama | (none) | Runs at `http://localhost:11434` |
| Anthropic | `ANTHROPIC_API_KEY` | ⚠️ Not implemented in the Turn[] refactor — provider stub throws. |
| HuggingFace | `HF_TOKEN` | ⚠️ Not implemented in the Turn[] refactor — provider stub throws. |

## Built-in tools

| Tool | Effect | Gated? |
|---|---|---|
| `readFile(path)` | Read a file inside the workspace | Workspace boundary |
| `searchFiles(pattern)` | Glob search inside the workspace | — |
| `runCommand(command)` | Run a shell command | Workspace boundary + `[y/n/a]` confirmation |

The model can also output tools in fuzzy text format (`[TOOL_CALL]`, `<toolName>...</toolName>`, etc.) — see `src/toolParser.ts` for the supported shapes.

## Session log files

When `--verbose` is on (or simply during normal operation), the agent writes a JSONL log of every turn to `lee-<sessionId>.jsonl` and a pretty JSON copy. These are gitignored.

## Project context

`loadProjectContext()` reads `package.json` and `tsconfig.json` at session start and injects a short summary into the system prompt. `CLAUDE.md` / `MEMORY.md` are not yet read — that's a planned feature.

## Architecture notes

The agent uses a typed internal history (`Turn[]` in `src/conversation.ts`) that is serialised to the right wire shape per provider+mode in `src/serializers.ts`. This avoids the common bug where one `messages` array tries to serve two incompatible protocols (native function calling vs strict-JSON-schema response mode). See `doc/Code-Review-opus-4.7-05-11.md` §9 for the long-form rationale.

## Development

```bash
npm run build    # tsc to dist/
npm test         # vitest run
```

The agent loop in `src/agent.ts` accepts an injected `chat` function, so it can be exercised end-to-end without real network calls (see `tests/agent.test.ts`).
