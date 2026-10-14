import { copyFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

export interface OutputTarget {
  output: string;
  inPlace: boolean;
  backup: string | null;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((fulfill, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => fulfill());
    stream.on("error", (error) => reject(error));
  });
  return hash.digest("hex");
}

export function suffixedName(file: string, suffix: string): string {
  const base = basename(file);
  const ext = extname(base);
  return `${base.slice(0, base.length - ext.length)}${suffix}${ext}`;
}

export async function prepareOutput(
  source: string,
  outDir?: string,
  outFile?: string,
  inPlace?: boolean,
  suffix?: string,
): Promise<OutputTarget> {
  if (inPlace === true) {
    const backup = `${source}.metascope.bak`;
    await copyFile(source, backup);
    return { output: source, inPlace: true, backup };
  }
  if (outFile) {
    await mkdir(dirname(resolve(outFile)), { recursive: true });
    await copyFile(source, outFile);
    return { output: outFile, inPlace: false, backup: null };
  }
  const dir = resolve(outDir ?? join(process.cwd(), "metascope-out"));
  await mkdir(dir, { recursive: true });
  const name = suffix ? suffixedName(source, suffix) : basename(source);
  const output = resolve(join(dir, name));
  await copyFile(source, output);
  return { output, inPlace: false, backup: null };
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}
