import { watch } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface WatchCoreOptions {
  depth?: number;
  ext?: string[];
  followSymlinks?: boolean;
  debounceMs?: number;
}

export interface WatchHandle {
  close: () => Promise<void>;
  dirs: string[];
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".metascope"]);

function matchesExt(file: string, ext?: string[]): boolean {
  if (!ext || ext.length === 0) {
    return true;
  }
  const base = file.split("/").pop() ?? file;
  const dot = base.lastIndexOf(".");
  const fileExt = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  return ext.map((entry) => entry.trim().toLowerCase().replace(/^\./, "")).includes(fileExt);
}

export async function collectWatchDirs(
  roots: string[],
  options: WatchCoreOptions,
): Promise<string[]> {
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;
  const found = new Set<string>();
  const stack: { dir: string; depth: number }[] = [];
  for (const root of roots) {
    try {
      const info = await lstat(root);
      if (info.isDirectory()) {
        stack.push({ dir: resolve(root), depth: 0 });
      }
    } catch {
      continue;
    }
  }
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (found.has(current.dir)) {
      continue;
    }
    found.add(current.dir);
    if (current.depth >= maxDepth) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (entry.isSymbolicLink() && options.followSymlinks !== true) {
        continue;
      }
      stack.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  return [...found].sort();
}

export async function watchPaths(
  roots: string[],
  options: WatchCoreOptions,
  onFile: (file: string) => void | Promise<void>,
): Promise<WatchHandle> {
  const dirs = await collectWatchDirs(roots, options);
  const watchers: { close: () => void }[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const debounceMs = options.debounceMs ?? 500;
  let closed = false;

  const fire = (file: string): void => {
    if (closed || !matchesExt(file, options.ext)) {
      return;
    }
    const pending = timers.get(file);
    if (pending) {
      clearTimeout(pending);
    }
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file);
        void (async () => {
          try {
            const info = await lstat(file);
            if (info.isFile()) {
              await onFile(file);
            }
          } catch {
            // Deleted or unreadable between event and scan: skip quietly.
          }
        })();
      }, debounceMs),
    );
  };

  const depths = new Map<string, number>();
  const addDir = (dir: string, depth: number): void => {
    if (closed || depths.has(dir)) {
      return;
    }
    depths.set(dir, depth);
    try {
      const watcher = watch(dir, (event, filename) => {
        if (typeof filename !== "string" || filename.length === 0) {
          return;
        }
        const full = join(dir, filename);
        void lstat(full)
          .then((info) => {
            if (info.isDirectory()) {
              const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;
              if (depth < maxDepth && !SKIP_DIRS.has(filename)) {
                addDir(full, depth + 1);
              }
              return;
            }
            fire(full);
          })
          .catch(() => undefined);
      });
      watchers.push(watcher);
    } catch {
      // Unwatchable directory (permissions): skip it, keep the rest.
    }
  };

  for (const dir of dirs) {
    const root = roots.map((entry) => resolve(entry)).find((entry) => dir.startsWith(entry));
    const depth = root ? relative(root, dir).split("/").filter(Boolean).length : 0;
    addDir(dir, depth);
  }

  return {
    dirs,
    close: async () => {
      closed = true;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
