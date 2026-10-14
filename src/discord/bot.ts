import { Client, Events, GatewayIntentBits, type Interaction, type Message } from "discord.js";
import { buildMetaCommand, handleSlash, type SlashContext } from "./commands.js";
import { handlePrefix, type PrefixContext } from "./prefix.js";
import { isAllowed, RateLimiter, resolveMaxFileBytes, type Allowlist } from "./security.js";

export interface BotOptions {
  token: string;
  prefix?: string;
  maxFileBytes: number;
  allowlist: Allowlist;
  devGuildId?: string;
  ratePerMinute?: number;
}

export const INTENT_GUIDE =
  "Enable the Message Content intent: Discord Developer Portal -> your application -> " +
  "Bot -> Privileged Gateway Intents -> turn on MESSAGE CONTENT INTENT, then restart the bot.";

export async function startBot(options: BotOptions): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const rateLimiter = new RateLimiter(options.ratePerMinute ?? 5);
  const autoscanChannels = new Set<string>();
  const slashCtx: SlashContext = {
    maxFileBytes: options.maxFileBytes,
    rateLimiter,
    allowlist: options.allowlist,
  };
  const prefixCtx: PrefixContext = {
    prefix: options.prefix ?? "!",
    maxFileBytes: options.maxFileBytes,
    rateLimiter,
    allowlist: options.allowlist,
    autoscanChannels,
    maxAttachmentsPerCommand: 3,
  };

  client.on(Events.ClientReady, async () => {
    const tag = client.user?.tag ?? "(unknown)";
    console.log(`Logged in as ${tag}`);
    const command = buildMetaCommand();
    try {
      if (options.devGuildId) {
        const guild = await client.guilds.fetch(options.devGuildId);
        await guild.commands.set([command]);
        console.log(`Slash commands registered for dev guild ${options.devGuildId}.`);
      } else {
        await client.application?.commands.set([command]);
        console.log("Slash commands registered globally (may take up to an hour to appear).");
      }
    } catch (error) {
      console.error(
        `Command registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    void handleSlash(interaction, slashCtx).catch((error: unknown) => {
      console.error(
        `Slash handler failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });

  client.on(Events.MessageCreate, (message: Message) => {
    if (!isAllowed({ guildId: message.guildId, userId: message.author.id }, options.allowlist)) {
      return;
    }
    void handlePrefix(message, prefixCtx).catch((error: unknown) => {
      console.error(
        `Prefix handler failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });

  client.on(Events.Error, (error: Error) => {
    if (/disallowedintents/i.test(error.message)) {
      console.error(`[DisallowedIntents] ${INTENT_GUIDE}`);
      process.exitCode = 1;
      return;
    }
    console.error(`Discord client error: ${error.message}`);
  });

  client.on(Events.ShardDisconnect, (event) => {
    if (event.code === 4014) {
      console.error(`[DisallowedIntents, close 4014] ${INTENT_GUIDE}`);
      process.exitCode = 1;
    }
  });

  await client.login(options.token);
  return client;
}

export function resolveBotMaxBytes(envMb?: string, configMb?: number): number {
  return resolveMaxFileBytes({ envMb, configMb });
}
