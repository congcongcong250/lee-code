export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const logs: LogEntry[] = [];
let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  minLevel = level;
}

function formatTimestamp(): string {
  return new Date().toISOString().split("T")[1].slice(0, -1);
}

function shouldLog(level: LogLevel): boolean {
  const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return levels[level] >= levels[minLevel];
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