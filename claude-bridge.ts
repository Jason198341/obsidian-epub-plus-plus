import { App } from "obsidian";
import { spawn } from "child_process";

interface ClaudeWriterSettings {
  claudePath: string;
  model: string;
}

/** Get Claude CLI path from Claude Writer plugin settings */
export function getClaudeConfig(app: App): ClaudeWriterSettings | null {
  const plugins = (app as any).plugins?.plugins;
  if (!plugins) return null;

  const cw = plugins["claude-writer"];
  if (!cw?.settings?.claudePath) return null;

  return {
    claudePath: cw.settings.claudePath,
    model: cw.settings.model || "haiku",
  };
}

/** Check if Claude Writer plugin is installed and has CLI configured */
export function isClaudeAvailable(app: App): boolean {
  return getClaudeConfig(app) !== null;
}

/** Call Claude CLI and return the response as a string */
export function callClaude(
  claudePath: string,
  model: string,
  systemPrompt: string,
  userText: string,
  timeoutMs: number = 60000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "text",
      "--model", model,
      "--no-session-persistence",
      "--effort", "low",
    ];

    let stdout = "";
    let stderr = "";

    const child = spawn(claudePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code: number) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude exit ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    // Send prompt via stdin
    const payload = `${systemPrompt}\n\n---\n\n${userText}`;
    if (child.stdin) {
      child.stdin.write(payload);
      child.stdin.end();
    }
  });
}
