import type { Command } from "commander";
import { getConfig } from "./common.js";
import { INTENT_GUIDE, startBot } from "../discord/bot.js";
import { loadDotEnv } from "../discord/dotenv.js";
import { resolveMaxFileBytes } from "../discord/security.js";

export function registerBotCommand(program: Command): void {
  program
    .command("bot")
    .description("Start the Discord bot (token from DISCORD_TOKEN in .env, never logged)")
    .option("--prefix <prefix>", "command prefix (default: ! or config)")
    .option("--max-file-mb <n>", "max download MB (default: 10)")
    .action(async (options: { prefix?: string; maxFileMb?: string }) => {
      await loadDotEnv();
      const token = process.env["DISCORD_TOKEN"];
      if (!token) {
        console.error(
          "Missing DISCORD_TOKEN. Create a .env file (see .env.example) with DISCORD_TOKEN=<token>.",
        );
        console.error(INTENT_GUIDE);
        process.exitCode = 1;
        return;
      }
      const config = await getConfig();
      const maxFileBytes = resolveMaxFileBytes({
        envMb: options.maxFileMb ?? process.env["MAX_FILE_MB"],
        configMb: config.discord?.maxFileMb,
      });
      await startBot({
        token,
        prefix: options.prefix ?? config.discord?.prefix ?? "!",
        maxFileBytes,
        allowlist: {
          guildIds: config.discord?.guildAllowlist,
          userIds: config.discord?.userAllowlist,
        },
        devGuildId: config.discord?.devGuildId,
        ratePerMinute: config.discord?.ratePerMinute,
      });
      console.log("Bot is running (Ctrl+C to stop).");
      await new Promise(() => undefined);
    });
}
