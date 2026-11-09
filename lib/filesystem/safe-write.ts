import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./paths";

/** Write through a temp file in the same directory, then rename, so readers never see a half-written file. */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const temp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.fk-${process.pid}-${Date.now()}.tmp`,
  );
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, filePath);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
