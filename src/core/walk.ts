import { lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { glob, isDynamicPattern } from "tinyglobby";

export interface WalkOptions {
  depth?: number;
  ext?: string[];
  followSymlinks?: boolean;
}

const DEFAULT_SKIPS = new Set(["node_modules", ".git", ".metascope"]);

function normalizeExts(ext?: string[]): Set<string> | null {
  if (!ext || ext.length === 0) {
    return null;
  }
  return new Set(ext.map((entry) => entry.trim().toLowerCase().replace(/^\./, "")));
}

export async function walkDirectory(root: string, options: WalkOptions): Promise<string[]> {
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;
  const exts = normalizeExts(options.ext);
  const follow = options.followSymlinks === true;
  const found: string[] = [];
  const visitedDirs = new Set<string>();
  const stack: { dir: string; depth: number }[] = [{ dir: resolve(root), depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (DEFAULT_SKIPS.has(entry.name)) {
        continue;
      }
      const full = join(current.dir, entry.name);
      const statEntry = entry;
      if (entry.isSymbolicLink()) {
        if (!follow) {
          continue;
        }
        try {
          const real = await realpath(full);
          const target = await lstat(real);
          if (target.isDirectory()) {
            if (visitedDirs.has(real) || current.depth >= maxDepth) {
              continue;
            }
            visitedDirs.add(real);
            stack.push({ dir: real, depth: current.depth + 1 });
          } else if (target.isFile()) {
            found.push(full);
          }
        } catch {
          continue;
        }
        continue;
      }
      if (statEntry.isDirectory()) {
        if (current.depth >= maxDepth) {
          continue;
        }
        try {
          visitedDirs.add(await realpath(full));
        } catch {
          // Unresolvable path: still descend by logical path.
        }
        stack.push({ dir: full, depth: current.depth + 1 });
      } else if (statEntry.isFile()) {
        if (exts) {
          const dot = entry.name.lastIndexOf(".");
          const fileExt = dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
          if (!exts.has(fileExt)) {
            continue;
          }
        }
        found.push(full);
      }
    }
  }
  return found;
}

export function filterByExt(files: string[], ext?: string[]): string[] {
  const exts = normalizeExts(ext);
  if (!exts) {
    return files;
  }
  return files.filter((file) => {
    const base = file.split("/").pop() ?? file;
    const dot = base.lastIndexOf(".");
    const fileExt = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
    return exts.has(fileExt);
  });
}

export async function expandScanInputs(inputs: string[], options: WalkOptions): Promise<string[]> {
  const { lstat: statLink } = await import("node:fs/promises");
  const collected: string[] = [];
  const patterns = inputs.filter((input) => isDynamicPattern(input));
  const literals = inputs.filter((input) => !isDynamicPattern(input));
  if (patterns.length > 0) {
    const matched = await glob(patterns, {
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
    });
    collected.push(...matched.map((entry) => resolve(entry)));
  }
  for (const literal of literals) {
    try {
      const info = await statLink(literal);
      if (info.isDirectory() && !info.isSymbolicLink()) {
        collected.push(...(await walkDirectory(literal, options)));
      } else if (info.isDirectory()) {
        if (options.followSymlinks === true) {
          collected.push(...(await walkDirectory(literal, options)));
        }
      } else if (info.isFile()) {
        collected.push(resolve(literal));
      }
    } catch {
      collected.push(resolve(literal));
    }
  }
  return [...new Set(collected)].sort();
}
