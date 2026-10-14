import type { Command } from "commander";
import { COMMAND_HELP, renderCommandHelp, renderTopHelp } from "../core/help.js";

export function registerHelpCommand(program: Command): void {
  program
    .command("help")
    .description("Show grouped help or detail for one command")
    .argument("[cmd]", "command name, e.g. scan")
    .action((cmd: string | undefined) => {
      if (!cmd) {
        console.log(renderTopHelp());
        return;
      }
      const text = renderCommandHelp(cmd.toLowerCase());
      if (!text) {
        console.error(
          `Unknown command ${JSON.stringify(cmd)}. Known: ${COMMAND_HELP.map((entry) => entry.name).join(", ")}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(text);
    });
}
