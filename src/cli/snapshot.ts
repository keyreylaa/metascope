import type { Command } from "commander";
import { prepareOutput } from "../core/fileOps.js";
import { resolveSnapshotDir } from "../core/config.js";
import { effectiveOutDir, getConfig } from "./common.js";
import {
  diffTargets,
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
  showSnapshot,
} from "../core/snapshot.js";

export function registerSnapshotCommand(program: Command): void {
  const snapshot = program
    .command("snapshot")
    .description("Save, restore, and diff metadata snapshots")
    .option("--snapshot-dir <dir>", "snapshot directory (default: XDG data dir)");

  snapshot
    .command("save")
    .description("Save full metadata as JSON in the snapshot directory")
    .argument("<file>", "image/video file")
    .action(async (file: string, _options: unknown, command: Command) => {
      const dir = resolveSnapshotDir({ flag: command.parent?.opts()?.snapshotDir });
      const { path, snapshot: snap } = await saveSnapshot(file, dir);
      console.log(`Snapshot saved: ${path}`);
      console.log(`sha256=${snap.file.sha256} size=${snap.file.size} tool=${snap.version}`);
    });

  snapshot
    .command("list")
    .description("List saved snapshots")
    .action(async (_options: unknown, command: Command) => {
      const entries = await listSnapshots(
        resolveSnapshotDir({ flag: command.parent?.opts()?.snapshotDir }),
      );
      if (entries.length === 0) {
        console.log("(no snapshots)");
        return;
      }
      for (const entry of entries) {
        console.log(entry);
      }
    });

  snapshot
    .command("show")
    .description("Print a snapshot JSON")
    .argument("<name>", "snapshot file name or path")
    .action(async (name: string, _options: unknown, command: Command) => {
      const snap = await showSnapshot(
        name,
        resolveSnapshotDir({ flag: command.parent?.opts()?.snapshotDir }),
      );
      console.log(JSON.stringify(snap, null, 2));
    });

  snapshot
    .command("restore")
    .description("Write snapshot tags back where the format allows")
    .argument("<snapshot>", "snapshot file name or path")
    .argument("<file>", "target image/video file")
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify the original (creates .metascope.bak first)", false)
    .action(
      async (
        snapshotName: string,
        file: string,
        options: { out?: string; inPlace: boolean },
        command: Command,
      ) => {
        const snap = await showSnapshot(
          snapshotName,
          resolveSnapshotDir({ flag: command.parent?.opts()?.snapshotDir }),
        );
        const target = await prepareOutput(
          file,
          effectiveOutDir(options.out, await getConfig()),
          undefined,
          options.inPlace === true,
          "_edited",
        );
        if (target.backup) {
          console.error(`Backup created: ${target.backup}`);
        }
        const result = await restoreSnapshot(snap, target.output);
        console.log(`Restored ${result.written.length} tag(s) to ${target.output}`);
        for (const tag of result.written) {
          console.log(`  ok: ${tag}`);
        }
        for (const skipped of result.skipped) {
          console.log(`  skip: ${skipped.tag} (${skipped.reason})`);
        }
      },
    );

  snapshot
    .command("diff")
    .description("Compare two files or snapshots (image paths or snapshot JSONs)")
    .argument("<first>", "image file or snapshot JSON")
    .argument("<second>", "image file or snapshot JSON")
    .action(async (first: string, second: string, _options: unknown, command: Command) => {
      const { added, removed, changed } = await diffTargets(
        first,
        second,
        resolveSnapshotDir({ flag: command.parent?.opts()?.snapshotDir }),
      );
      console.log(`Added (${added.length}):`);
      for (const entry of added) {
        console.log(`  + ${entry.tag}: ${entry.after}`);
      }
      console.log(`Removed (${removed.length}):`);
      for (const entry of removed) {
        console.log(`  - ${entry.tag}: ${entry.before}`);
      }
      console.log(`Changed (${changed.length}):`);
      for (const entry of changed) {
        console.log(`  ~ ${entry.tag}: ${entry.before} -> ${entry.after}`);
      }
    });
}
