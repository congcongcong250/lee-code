export const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",
  
  // Foreground - use named for max compatibility
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
  
  // Background
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
  bgGray: "\x1b[100m",
};

export function enableColors() {
  process.env.FORCE_COLOR = "1";
  process.env.NODE_DISABLE_COLORS = "0";
  require('tty').setRawMode && process.stdout.isTTY ? null : null;
}

export const isTTY = (): boolean => {
  if (process.stdout.isTTY) return true;
  if (process.env.FORCE_COLOR === "1") return true;
  if (process.env.NODE_DISABLE_COLORS === "0") return true;
  return false;
};

export function printHeader() {
  console.log("");
  console.log(`${COLORS.bgCyan}${COLORS.black}+=============================================================+${COLORS.reset}`);
  console.log(`${COLORS.bgCyan}${COLORS.black}|              lee-code v1.0.0 - AI Coding Assistant          |${COLORS.reset}`);
  console.log(`${COLORS.bgCyan}${COLORS.black}+=============================================================+${COLORS.reset}`);
  console.log("");
}

export function printUser(text: string) {
  console.log(`${COLORS.cyan}❯ ${text}${COLORS.reset}`);
}

export function printAssistant(text: string) {
  const lines = text.split("\n");
  lines.forEach(line => {
    console.log(`${COLORS.white}${line}${COLORS.reset}`);
  });
}

export function printTool(text: string) {
  console.log(`${COLORS.yellow}⚙️  ${text}${COLORS.reset}`);
}

export function printResult(text: string) {
  console.log(`${COLORS.green}→ ${text}${COLORS.reset}`);
}

export function printError(text: string) {
  console.log(`${COLORS.red}⚠️  ${text}${COLORS.reset}`);
}

export function printInfo(text: string) {
  console.log(`${COLORS.blue}ℹ️  ${text}${COLORS.reset}`);
}

export function printSuccess(text: string) {
  console.log(`${COLORS.green}✓ ${text}${COLORS.reset}`);
}

export function printDim(text: string) {
  console.log(`${COLORS.dim}${text}${COLORS.reset}`);
}

export function printProvider(name: string, model: string) {
  console.log(`${COLORS.bgBlue}${COLORS.white} Provider: ${name} (${model}) ${COLORS.reset}`);
}

export function printModel(name: string, mode: string) {
  const modeColor = mode === "schema" ? COLORS.green : COLORS.yellow;
  console.log(`  ${name} ${modeColor}${mode}${COLORS.reset}`);
}

export async function promptQuestion(question: string): Promise<string> {
  const rl = await import("readline");
  const r = rl.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    r.question(question, answer => {
      r.close();
      resolve(answer);
    });
  });
}

export function printPrompt(): string {
  return `${COLORS.cyan}❯ ${COLORS.reset}`;
}