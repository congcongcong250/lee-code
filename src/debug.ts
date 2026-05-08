export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const logs: LogEntry[] = [];
let minLevel: LogLevel = "info";
let verboseMode = false;
let sessionId = "";

function formatTimestamp(): string {
  return new Date().toISOString().split("T")[1].slice(0, -1);
}

function shouldLog(level: LogLevel): boolean {
  const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return levels[level] >= levels[minLevel];
}

function getSessionId(): string {
  if (!sessionId) {
    sessionId = `lee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return sessionId;
}

export function setLogLevel(level: LogLevel): void {
  const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  minLevel = level;
}

export function setVerboseMode(enabled: boolean): void {
  verboseMode = enabled;
  if (verboseMode) {
    setLogLevel("debug");
  }
}

export function isVerboseMode(): boolean {
  return verboseMode;
}

export function log(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;
  
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    data,
  };
  
  logs.push(entry);
  
  const prefix = {
    debug: "🔍",
    info: "ℹ️",
    warn: "⚠️",
    error: "❌",
  }[level];
  
  console.log(`${formatTimestamp()} ${prefix} ${message}`, data ? JSON.stringify(data).slice(0, 200) : "");
}

export function debug(message: string, data?: unknown): void {
  log("debug", message, data);
}

export function info(message: string, data?: unknown): void {
  log("info", message, data);
}

export function warn(message: string, data?: unknown): void {
  log("warn", message, data);
}

export function error(message: string, data?: unknown): void {
  log("error", message, data);
}

export function getLogs(): LogEntry[] {
  return [...logs];
}

export function clearLogs(): void {
  logs.length = 0;
}

export function saveLogs(filename: string = "lee-code.log"): string {
  const content = logs.map(l => 
    `${l.timestamp} [${l.level.toUpperCase()}] ${l.message}${l.data ? " " + JSON.stringify(l.data) : ""}`
  ).join("\n");
  
  require("fs").writeFileSync(filename, content, "utf-8");
  return filename;
}

export function exportLogs(): string {
  return JSON.stringify(logs, null, 2);
}

// === VERBOSE LOGGING ===
interface LLMEntry {
  sessionId: string;
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool" | "tool_result";
  content: string;
  model?: string;
  provider?: string;
  iteration?: number;
  toolCalls?: string;
  duration?: number;
}

const llmLogs: LLMEntry[] = [];

export function logLLM(
  role: LLMEntry["role"],
  content: string,
  options?: {
    model?: string;
    provider?: string;
    iteration?: number;
    toolCalls?: string;
    duration?: number;
  }
): void {
  const entry: LLMEntry = {
    sessionId: getSessionId(),
    timestamp: new Date().toISOString(),
    role,
    content,
    ...options,
  };
  
  llmLogs.push(entry);
  
  // In verbose mode, also log to console
  if (verboseMode) {
    const roleLabel = { user: "❯", assistant: "🤖", system: "⚙️", tool: "🔧", tool_result: "✅" }[role];
    console.log(`${roleLabel} ${content.slice(0, 500)}${content.length > 500 ? "..." : ""}`);
  }
}

export function getLLMLogs(): LLMEntry[] {
  return [...llmLogs];
}

export function getSessionIdValue(): string {
  return getSessionId();
}

export function saveLLMLogs(filename?: string): string {
  const fn = filename || `${getSessionId()}.jsonl`;
  const fs = require("fs");
  
  // Save as JSONL (one JSON per line)
  const content = llmLogs.map(e => JSON.stringify(e)).join("\n");
  fs.writeFileSync(fn, content, "utf-8");
  
  // Also save as pretty JSON
  const prettyFn = fn.replace(".jsonl", ".pretty.json");
  fs.writeFileSync(prettyFn, JSON.stringify({ sessionId: getSessionId(), logs: llmLogs }, null, 2), "utf-8");
  
  return fn;
}

export function clearLLMLogs(): void {
  llmLogs.length = 0;
}