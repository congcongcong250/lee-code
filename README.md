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

## Usage

### Interactive Mode

```bash
node dist/index.js
❯ help
❯ search "src/**/*.ts"
❯ read src/index.ts
❯ run npm test
❯ :provider    # Change LLM provider
❯ :apikey    # Set API key
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

## API Keys Required

Set via env vars or use `:apikey` in interactive mode:

| Provider | Env Variable | Default Model |
|----------|------------|---------------|
| Groq (free) | `GROQ_API_KEY` | llama-3.1-70b-versatile |
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