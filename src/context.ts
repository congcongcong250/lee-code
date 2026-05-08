import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";

export async function loadProjectContext(rootDir: string): Promise<string> {
  const files = await fg("**/{package.json,tsconfig.json,.gitignore,README.md}", {
    cwd: rootDir,
    absolute: false,
  });
  
  const info: string[] = [];
  
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(rootDir, file), "utf-8");
      if (file === "package.json") {
        const pkg = JSON.parse(content);
        info.push(`Project: ${pkg.name || "unknown"}`);
        info.push(`Scripts: ${Object.keys(pkg.scripts || {}).join(", ")}`);
      } else if (file === "tsconfig.json") {
        const ts = JSON.parse(content);
        info.push(`TypeScript: ${ts.compilerOptions?.target || "unknown"}`);
      }
    } catch {}
  }
  
  if (info.length === 0) return "No project files found";
  return info.join("\n");
}