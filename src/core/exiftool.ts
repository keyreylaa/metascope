import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExifTool } from "exiftool-vendored";

const execFileAsync = promisify(execFile);

let singleton: ExifTool | null = null;

export function isWindows(): boolean {
  return process.platform === "win32";
}

export async function checkPerl(): Promise<{ ok: boolean; message: string }> {
  if (isWindows()) {
    return { ok: true, message: "Windows: Perl check skipped (not required)." };
  }
  try {
    await execFileAsync("perl", ["-v"]);
    return { ok: true, message: "Perl found." };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    return {
      ok: false,
      message:
        `Perl is required by exiftool-vendored but was not found (code=${code}). ` +
        `Install it first: Debian/Ubuntu/Kali: sudo apt install perl | ` +
        `Termux: pkg install perl | Fedora: sudo dnf install perl.`,
    };
  }
}

export async function getExifTool(): Promise<ExifTool> {
  if (singleton) {
    return singleton;
  }
  const perl = await checkPerl();
  if (!perl.ok) {
    throw new Error(perl.message);
  }
  singleton = new ExifTool();
  try {
    await singleton.version();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    singleton = null;
    throw new Error(
      `Failed to start ExifTool (Perl may be missing or broken): ${message}. ` +
        `Fix: install Perl (apt: sudo apt install perl, Termux: pkg install perl).`,
      { cause: error },
    );
  }
  return singleton;
}

export async function closeExifTool(): Promise<void> {
  if (singleton) {
    const instance = singleton;
    singleton = null;
    await instance.end();
  }
}
