import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import { resolveNextPackage } from "@/lib/preview/workspace";

export type DevServerStatus = "starting" | "ready" | "stopped" | "failed";

export type DevServerEvent =
  | { type: "status"; status: DevServerStatus; message?: string }
  | { type: "output"; line: string }
  | { type: "compile"; ok: boolean; message?: string };

const MAX_LOG_LINES = 300;

/** Owns the `next dev` child process for one workspace. */
export class DevServer extends EventEmitter {
  private child: ChildProcess | null = null;
  private logLines: string[] = [];
  status: DevServerStatus = "stopped";
  port = 0;
  lastError: string | null = null;

  constructor(
    private readonly workspaceDir: string,
    /** Top of the workspace copy; for a monorepo app `next` may be hoisted up to here. */
    private readonly mirrorRoot?: string,
  ) {
    super();
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get log(): string {
    return this.logLines.join("\n");
  }

  async start(): Promise<void> {
    await this.killStale();
    this.port = await findFreePort();
    this.setStatus("starting");
    this.logLines = [];
    this.lastError = null;

    const nextPackage = await resolveNextPackage(this.workspaceDir, this.mirrorRoot ?? this.workspaceDir);
    if (!nextPackage) throw new Error("next is not installed in the preview workspace.");
    const nextBin = path.join(nextPackage, "dist", "bin", "next");
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      // Framekit's own Next.js dev process leaks framework internals; the preview gets a clean slate.
      if (key.startsWith("__NEXT") || key.startsWith("NEXT_") || key === "PORT" || key === "NODE_ENV" || key === "TURBOPACK") continue;
      env[key] = value;
    }
    env.PORT = String(this.port);
    env.FORCE_COLOR = "0";
    env.NO_COLOR = "1";
    env.NEXT_TELEMETRY_DISABLED = "1";
    env.BROWSER = "none";
    env.CI = "1";

    const child: ChildProcess = spawn(process.execPath, [nextBin, "dev", "-p", String(this.port), "-H", "127.0.0.1"], {
      cwd: this.workspaceDir,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    await fs.writeFile(path.join(this.workspaceDir, ".framekit-dev.pid"), String(child.pid ?? "")).catch(() => {});

    const onLine = (line: string) => {
      if (!line.trim()) return;
      this.logLines.push(line);
      if (this.logLines.length > MAX_LOG_LINES) this.logLines.shift();
      this.emit("event", { type: "output", line } satisfies DevServerEvent);
      if (/✓ Compiled|Compiled .* in|✓ Ready|Ready in/i.test(line)) {
        this.emit("event", { type: "compile", ok: true } satisfies DevServerEvent);
      } else if (/⨯|Error:|Failed to compile|Module not found/i.test(line)) {
        this.lastError = line;
        this.emit("event", { type: "compile", ok: false, message: line } satisfies DevServerEvent);
      }
    };
    pipeLines(child.stdout!, onLine);
    pipeLines(child.stderr!, onLine);

    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.child = null;
      if (this.status !== "stopped") {
        this.setStatus("failed", `The preview server exited (${signal ?? `code ${code}`}).`);
      }
    });

    await this.waitUntilResponding(180_000);
    if (this.status === "starting") this.setStatus("ready");
  }

  private async waitUntilResponding(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.status === "failed") throw new Error(this.lastError ?? "The preview server stopped before it was ready.");
      try {
        const response = await fetch(this.url, { method: "HEAD", signal: AbortSignal.timeout(3000) });
        if (response.status > 0) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("The preview server did not start in time.");
  }

  async stop(): Promise<void> {
    this.setStatus("stopped");
    const child = this.child;
    this.child = null;
    if (child && child.pid) {
      await killTree(child.pid);
    }
    await fs.rm(path.join(this.workspaceDir, ".framekit-dev.pid"), { force: true }).catch(() => {});
  }

  private async killStale(): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.workspaceDir, ".framekit-dev.pid"), "utf8");
      const pid = Number(raw);
      if (pid > 0) await killTree(pid);
    } catch {
      // no stale pid
    }
  }

  private setStatus(status: DevServerStatus, message?: string) {
    this.status = status;
    if (message) this.lastError = message;
    this.emit("event", { type: "status", status, message } satisfies DevServerEvent);
  }
}

function pipeLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    if (buffer) onLine(buffer);
  });
}

async function killTree(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
