import {
  AttachmentBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import { fetchAttachment } from "./attachments.js";
import { runAi, runHash, runPrivacy, runRead, runScan, runStrip, type OutFile } from "./runner.js";
import { mlPixelDetector } from "../core/detectors/mlPixel.js";
import { isAllowed, RateLimiter, type Allowlist } from "./security.js";

export interface SlashContext {
  maxFileBytes: number;
  rateLimiter: RateLimiter;
  allowlist: Allowlist;
}

export function buildMetaCommand(): SlashCommandBuilder {
  const command = new SlashCommandBuilder()
    .setName("meta")
    .setDescription("Photo/video metadata toolkit");
  command.addSubcommand((sub) =>
    sub
      .setName("read")
      .setDescription("Dump metadata grouped by namespace")
      .addAttachmentOption((option) =>
        option.setName("file").setDescription("Image or video attachment").setRequired(true),
      ),
  );
  command.addSubcommand((sub) =>
    sub
      .setName("strip")
      .setDescription("Remove all metadata (verified clean)")
      .addAttachmentOption((option) =>
        option.setName("file").setDescription("Image or video attachment").setRequired(true),
      ),
  );
  command.addSubcommand((sub) =>
    sub
      .setName("ai-check")
      .setDescription("AI-generation provenance check")
      .addAttachmentOption((option) =>
        option.setName("file").setDescription("Image or video attachment").setRequired(true),
      ),
  );
  command.addSubcommand((sub) =>
    sub
      .setName("hash")
      .setDescription("File, pixel, and perceptual hashes")
      .addAttachmentOption((option) =>
        option.setName("file").setDescription("Image or video attachment").setRequired(true),
      )
      .addAttachmentOption((option) =>
        option
          .setName("compare")
          .setDescription("Second file to compare against")
          .setRequired(false),
      ),
  );
  command.addSubcommand((sub) =>
    sub
      .setName("scan")
      .setDescription("Full scan: metadata, privacy, AI provenance, hashes")
      .addAttachmentOption((option) =>
        option.setName("file").setDescription("Image or video attachment").setRequired(true),
      ),
  );
  command.addSubcommand((sub) =>
    sub
      .setName("privacy-scan")
      .setDescription("Privacy scan: location, serials, owner info, timestamps")
      .addAttachmentOption((option) =>
        option.setName("file").setDescription("Image or video attachment").setRequired(true),
      ),
  );
  return command as SlashCommandBuilder;
}

function toBuilders(files: OutFile[]): AttachmentBuilder[] {
  return files.map((file) => new AttachmentBuilder(file.buffer, { name: file.name }));
}

async function guard(
  interaction: ChatInputCommandInteraction,
  ctx: SlashContext,
): Promise<boolean> {
  if (!isAllowed({ guildId: interaction.guildId, userId: interaction.user.id }, ctx.allowlist)) {
    await interaction.reply({ content: "You are not allowed to use this bot.", ephemeral: true });
    return false;
  }
  if (!ctx.rateLimiter.take(interaction.user.id)) {
    await interaction.reply({
      content: "Slow down: rate limit exceeded, try again in a minute.",
      ephemeral: true,
    });
    return false;
  }
  return true;
}

export async function handleSlash(interaction: Interaction, ctx: SlashContext): Promise<void> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "meta") {
    return;
  }
  if (!(await guard(interaction, ctx))) {
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const sub = interaction.options.getSubcommand();
    const attachment = interaction.options.getAttachment("file", true);
    const fetched = await fetchAttachment(
      attachment.url,
      attachment.name ?? "upload.bin",
      ctx.maxFileBytes,
    );
    if (sub === "read") {
      const result = await runRead(fetched.buffer, fetched.filename);
      await interaction.editReply({
        content: result.dmText.slice(0, 1900),
        files: toBuilders(result.files),
      });
    } else if (sub === "strip") {
      const result = await runStrip(fetched.buffer, fetched.filename);
      await interaction.editReply({
        content: result.channelText.slice(0, 1900),
        files: toBuilders(result.files),
      });
    } else if (sub === "ai-check") {
      const result = await runAi(fetched.buffer, fetched.filename, [mlPixelDetector]);
      await interaction.editReply({
        content: `${result.channelText}\n${result.dmText}`.slice(0, 1900),
      });
    } else if (sub === "hash") {
      const other = interaction.options.getAttachment("compare", false);
      const result = other
        ? await runHash(
            fetched.buffer,
            fetched.filename,
            (await fetchAttachment(other.url, other.name ?? "other.bin", ctx.maxFileBytes)).buffer,
          )
        : await runHash(fetched.buffer, fetched.filename);
      await interaction.editReply({ content: result.channelText.slice(0, 1900) });
    } else if (sub === "scan") {
      const result = await runScan(fetched.buffer, fetched.filename, [mlPixelDetector]);
      await interaction.editReply({
        content: `${result.channelText}\n${result.dmText}`.slice(0, 1900),
        files: toBuilders(result.files),
      });
    } else if (sub === "privacy-scan") {
      const result = await runPrivacy(fetched.buffer, fetched.filename);
      await interaction.editReply({
        content: `${result.channelText}\n${result.dmText}`.slice(0, 1900),
      });
    } else {
      await interaction.editReply({ content: `Unknown subcommand: ${sub}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply({ content: `Failed: ${message.slice(0, 1500)}` });
  }
}
