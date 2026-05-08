import { spawn } from "child_process";

export interface CommandResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export function runCommand(command: string, args: string[] = []): Promise<CommandResult> {
  return new Promise(resolve => {
    const parts = command.split(" ");
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);
    const allArgs = [...cmdArgs, ...args];
    
    const proc = spawn(cmd, allArgs, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    
    let stdout = "";
    let stderr = "";
    
    proc.stdout?.on("data", data => { stdout += data.toString(); });
    proc.stderr?.on("data", data => { stderr += data.toString(); });
    
    proc.on("close", code => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: code !== 0 ? `Exit code: ${code}` : undefined,
      });
    });
    
    proc.on("error", error => {
      resolve({ success: false, error: error.message });
    });
  });
}