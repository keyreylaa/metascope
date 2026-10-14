#!/usr/bin/env node
import { Command, Help } from "commander";
import { closeExifTool } from "../core/exiftool.js";
import { renderTopHelp } from "../core/help.js";
import { registerAiCheckCommand } from "./aiCheck.js";
import { registerBatchCommand } from "./batch.js";
import { registerBotCommand } from "./bot.js";
import { registerCleanCommand } from "./clean.js";
import { registerCopyrightCommand } from "./copyright.js";
import { registerDatesCommand } from "./dates.js";
import { registerGpsCommand } from "./gps.js";
import { registerHashCommand } from "./hash.js";
import { registerHelpCommand } from "./help.js";
import { registerPrivacyScanCommand } from "./privacyScan.js";
import { registerReadCommand } from "./read.js";
import { registerScanCommand } from "./scan.js";
import { registerSnapshotCommand } from "./snapshot.js";
import { registerStripCommand } from "./strip.js";
import { registerWatchCommand } from "./watch.js";
import { registerWriteCommand } from "./write.js";

export function buildProgram(): Command {
  const program = new Command();
  program.name("metascope").description("Photo/video metadata toolkit").version("0.1.0");
  program.configureHelp({
    formatHelp: (cmd, helper) => {
      if (cmd === program) {
        return renderTopHelp();
      }
      return Help.prototype.formatHelp.call(helper, cmd, helper);
    },
  });
  registerReadCommand(program);
  registerWriteCommand(program);
  registerCopyrightCommand(program);
  registerGpsCommand(program);
  registerDatesCommand(program);
  registerStripCommand(program);
  registerCleanCommand(program);
  registerSnapshotCommand(program);
  registerHashCommand(program);
  registerAiCheckCommand(program);
  registerPrivacyScanCommand(program);
  registerScanCommand(program);
  registerBatchCommand(program);
  registerWatchCommand(program);
  registerBotCommand(program);
  registerHelpCommand(program);
  return program;
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await closeExifTool();
  } finally {
    if (signal === "SIGINT") {
      process.exit(130);
    }
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message.split("\n")[0]}`);
    process.exitCode = 1;
  } finally {
    await closeExifTool();
  }
}

void main();
