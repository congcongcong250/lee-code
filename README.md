# lee-code

A CLI coding assistant inspired by Claude Code. Connects to LLMs (Ollama, Groq, OpenAI, Anthropic, HuggingFace).

## Quick Start

```bash
cd lee-code
npm install
npm run build
node dist/index.js              # Interactive mode
node dist/index.js help       # Show help
```

## Features

- **File Operations** - Read, write, edit files
- **Codebase Search** - Glob patterns via fast-glob
- **Command Execution** - Run shell commands
- **Interactive CLI** - REPL with history
- **Project Context** - CLAUDE.md / MEMORY.md
- **LLM Integration** - Connect to Ollama, Groq, OpenAI, Anthropic, HuggingFace
- **Tool Calling** - Agentic loop with fuzzy tool parsing
- **Verbose Logging** - Complete LLM request/response history

## Usage

### Interactive Mode

```bash
node dist/index.js
❯ help
❯ search "src/**/*.ts"
❯ read src/index.ts
❯ run npm test
❯ :provider    # Change LLM provider
❯ :quit
```

### Commands

```bash
node dist/index.js read <file>        # Read file
node dist/index.js write <file> <content>  # Write file  
node dist/index.js search <pattern>  # Search files
node dist/index.js run <command>   # Run command
node dist/index.js context         # Show project context
node dist/index.js help          # Show help
```

### Flags

```bash
--debug, -d     # Enable debug mode (shows iteration logs)
--verbose, -v    # Enable verbose mode (logs all LLM requests/responses)
```

## Verbose Logging

In verbose mode, lee-code logs all LLM interactions to a JSONL file.

### Enable Verbose Mode

```bash
# Via flag
node dist/index.js --verbose

# In interactive mode
❯ :logs
```

### Log Files

- Session ID format: `lee-<timestamp>-<random>.jsonl`
- Auto-saved after each interaction
- Also saved on `:quit`

### Log Format (JSONL)

```json
{"sessionId":"lee-123456-abc123","timestamp":"2024-01-01T12:00:00.000Z","role":"user","content":"Hello","provider":"groq","model":"llama-3.3-70b-versatile","iteration":1}
{"sessionId":"lee-123456-abc123","timestamp":"2024-01-01T12:00:01.000Z","role":"assistant","content":"Hi! How can I help?","provider":"groq","model":"llama-3.3-70b-versatile","iteration":1,"duration":1500}
```

### View Logs

```bash
# In interactive mode
❯ :logs           # Show session stats + recent logs
❯ :logs stats    # Same as above
❯ :logs save    # Save debug logs to file
❯ :logs save verbose  # Save verbose LLM logs
```

## Tool Calling

lee-code has an agentic loop that executes tools when the LLM requests them.

### Available Tools

- `readFile(path)` - Read a file
- `searchFiles(pattern)` - Find files using glob pattern
- `runCommand(command)` - Execute shell command

### Fuzzy Tool Parsing

The LLM may output tools in various formats - lee-code parses them all:

```
[TOOL_CALL]{tool => "searchFiles" args => { --pattern: "**/*.ts" }}
`searchFiles: **/*.ts`
```

## API Keys Required

Set via env vars or use `:apikey` in interactive mode:

| Provider | Env Variable | Default Model |
|----------|------------|---------------|
| Groq (free) | `GROQ_API_KEY` | llama-3.3-70b-versatile |
| OpenAI | `OPENAI_API_KEY` | gpt-4o-mini |
| Anthropic | `ANTHROPIC_API_KEY` | claude-3-haiku |
| Ollama | (local) | llama3 |
| HuggingFace | `HF_TOKEN` | meta-llama/Llama-3.1-70b-instruct |

Get free API keys:
- **Groq**: https://console.groq.com
- **OpenAI**: https://platform.openai.com
- **Anthropic**: https://console.anthropic.com
- **HuggingFace**: https://huggingface.co

## Project Context

Create these files in your project root:
- `CLAUDE.md` - Project instructions, conventions, coding standards
- `MEMORY.md` - Auto-saved learnings across sessions

## Dependencies

- fast-glob - File searching
- Node.js built-in: fs, path, readline, child_process, fetch

## Requirements Met

1. ✅ File Operations (read, write, edit)
2. ✅ Codebase Search (fast-glob)
3. ✅ Command Execution (shell)
4. ✅ Interactive CLI (REPL)
5. ✅ LLM Integration (multiple providers)