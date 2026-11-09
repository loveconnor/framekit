import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { assertLocalRequest, errorResponse, json } from "@/lib/session/http";
import { SessionError } from "@/lib/session/session";

const Body = z.object({ startIn: z.string().max(2000).optional() });

/**
 * Opens the OS folder picker on the machine running Framekit and returns the chosen absolute path.
 * A browser picker can't do this: it never exposes absolute paths. `path: null` means the user cancelled.
 */
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const { startIn } = Body.parse(await request.json().catch(() => ({})));
    const picked = await pickFolder(await startDirectory(startIn));
    return json({ path: picked });
  } catch (error) {
    return errorResponse(error);
  }
}

/** The closest existing directory to what the user typed, else home. */
async function startDirectory(input: string | undefined): Promise<string> {
  const home = os.homedir();
  if (!input?.trim()) return home;
  let dir = path.resolve(input.trim().replace(/^~(?=$|\/)/, home));
  while (dir !== path.dirname(dir)) {
    if (await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false)) return dir;
    dir = path.dirname(dir);
  }
  return home;
}

type Run = { stdout: string; cancelled: boolean };

function run(cmd: string, args: string[], env?: Record<string, string>): Promise<Run> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10 * 60_000, env: env ? { ...process.env, ...env } : process.env }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout: stdout.trim(), cancelled: false });
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reject(error);
      // Every picker reports "cancel" as a non-zero exit (osascript adds -128 to stderr).
      if (typeof (error as { code?: unknown }).code === "number" || /-128|cancel/i.test(stderr)) return resolve({ stdout: "", cancelled: true });
      reject(error);
    });
  });
}

async function pickFolder(startIn: string): Promise<string | null> {
  const prompt = "Choose a Next.js project folder";
  let result: Run;
  try {
    if (process.platform === "darwin") {
      result = await run("osascript", [
        "-e", "on run argv",
        "-e", "activate",
        "-e", `return POSIX path of (choose folder with prompt "${prompt}" default location (POSIX file (item 1 of argv)))`,
        "-e", "end run",
        startIn,
      ]);
    } else if (process.platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
        `$d.Description = '${prompt}'`,
        "$d.SelectedPath = $env:FK_START",
        "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath } else { exit 1 }",
      ].join("; ");
      result = await run("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { FK_START: startIn });
    } else {
      try {
        result = await run("zenity", ["--file-selection", "--directory", `--title=${prompt}`, `--filename=${startIn}/`]);
      } catch {
        result = await run("kdialog", ["--getexistingdirectory", startIn, "--title", prompt]);
      }
    }
  } catch {
    throw new SessionError("No system folder picker is available. Type the path instead.", "PICKER_UNAVAILABLE", 501);
  }
  if (result.cancelled || !result.stdout) return null;
  return result.stdout.replace(/(.)\/+$/, "$1");
}
