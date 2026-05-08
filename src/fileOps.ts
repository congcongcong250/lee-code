import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";

export interface FileOperationResult {
  success: boolean;
  data?: string;
  error?: string;
}

export async function readFile(filePath: string): Promise<FileOperationResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    return { success: true, data: content };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function writeFile(filePath: string, content: string): Promise<FileOperationResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absolutePath, content, "utf-8");
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function editFile(filePath: string, oldString: string, newString: string): Promise<FileOperationResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    if (!content.includes(oldString)) {
      return { success: false, error: "String not found" };
    }
    const newContent = content.replace(oldString, newString);
    await fs.writeFile(absolutePath, newContent, "utf-8");
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function searchFiles(pattern: string, cwd?: string): Promise<string[]> {
  const rootDir = cwd || process.cwd();
  const resolved = path.isAbsolute(pattern) ? pattern : path.join(rootDir, pattern);
  const files = await fg(resolved, { cwd: rootDir, absolute: false });
  return files;
}