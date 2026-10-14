import { AttachmentBuilder, PermissionsBitField, type Message } from "discord.js";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import { fetchAttachment, SEND_LIMIT_BYTES } from "./attachments.js";
import {
  runAi,
  runEdit,
  runHash,
  runRead,
  runScan,
  runStrip,
  type OutFile,
  type RunResult,
} from "./runner.js";
import { isAllowed, parseKeyValueArgs, RateLimiter, type Allowlist } from "./security.js";
import { zipBuffers } from "../core/zip.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PrefixContext {
  prefix: string;
  maxFileBytes: number;
  rateLimiter: RateLimiter;
  allowlist: Allowlist;
  autoscanChannels: Set<string>;
  maxAttachmentsPerCommand: number;
}

export function chunkString(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [""];
}

interface IncomingFile {
  url: string;
  name: string;
}

async function resolveIncoming(message: Message): Promise<IncomingFile[]> {
  const direct = [...message.attachments.values()].map((attachment) => ({
    url: attachment.url,
    name: attachment.name ?? "upload.bin",
  }));
  if (direct.length > 0) {
    return direct;
  }
  if (message.reference?.messageId) {
    try {
      const replied = await message.fetchReference();
      return [...replied.attachments.values()].map((attachment) => ({
        url: attachment.url,
        name: attachment.name ?? "upload.bin",
      }));
    } catch {
      return [];
    }
  }
  return [];
}

function toBuilders(files: OutFile[]): AttachmentBuilder[] {
  return files.map((file) => new AttachmentBuilder(file.buffer, { name: file.name }));
}

async function dmFull(
  message: Message,
  text: string,
  files: OutFile[],
): Promise<{ dmOk: boolean }> {
  try {
    const dm = await message.author.createDM();
    for (const chunk of chunkString(text, 1900)) {
      await dm.send({ content: chunk || "(empty)", files: [] });
    }
    if (files.length > 0) {
      await dm.send({ content: "Files:", files: toBuilders(files) });
    }
    return { dmOk: true };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: number }).code === 50007
    ) {
      return { dmOk: false };
    }
    throw error;
  }
}

async function sendPublic(message: Message, text: string, files: OutFile[]): Promise<void> {
  if (!message.channel.isSendable()) {
    throw new Error("Cannot send messages in this channel.");
  }
  const oversized = files.filter((file) => file.buffer.byteLength > SEND_LIMIT_BYTES);
  const sendable = files.filter((file) => file.buffer.byteLength <= SEND_LIMIT_BYTES);
  const chunks = chunkString(text, 1900);
  try {
    for (const chunk of chunks) {
      await message.channel.send(chunk || "(empty)");
    }
    if (sendable.length > 0) {
      await message.channel.send({ content: "Files:", files: toBuilders(sendable) });
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: number }).code === RESTJSONErrorCodes.RequestEntityTooLarge
    ) {
      await message.channel.send(
        `${chunks[0] ?? ""}\n(Note: attachments too large to post; full files were DM-sent when possible.)`.slice(
          0,
          1900,
        ),
      );
      return;
    }
    throw error;
  }
  if (oversized.length > 0) {
    await message.channel.send(
      `Skipped ${oversized.length} oversized file(s) (over the size ceiling).`,
    );
  }
}

async function fetchAll(
  incoming: IncomingFile[],
  maxBytes: number,
  limit: number,
): Promise<{ filename: string; buffer: Buffer }[]> {
  const out: { filename: string; buffer: Buffer }[] = [];
  for (const file of incoming.slice(0, limit)) {
    out.push(await fetchAttachment(file.url, file.name, maxBytes));
  }
  return out;
}

async function bundleZip(files: OutFile[]): Promise<OutFile[]> {
  if (files.length < 2) {
    return files;
  }
  const dir = await mkdtemp(join(tmpdir(), "metascope-zip-"));
  try {
    const outPath = join(dir, "metascope-outputs.zip");
    await zipBuffers(files, outPath);
    return [{ name: "metascope-outputs.zip", buffer: await readFile(outPath) }];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function handlePrefix(message: Message, ctx: PrefixContext): Promise<void> {
  if (message.author.bot) {
    return;
  }
  if (!isAllowed({ guildId: message.guildId, userId: message.author.id }, ctx.allowlist)) {
    return;
  }
  const content = message.content ?? "";
  const isCommand = content.startsWith(ctx.prefix);
  if (!isCommand) {
    if (message.guildId && ctx.autoscanChannels.has(message.channelId)) {
      const incoming = await resolveIncoming(message);
      if (incoming.length > 0 && ctx.rateLimiter.take(message.author.id)) {
        await runScanCommand(message, ctx, incoming, true);
      }
    }
    return;
  }
  if (!ctx.rateLimiter.take(message.author.id)) {
    await message.reply("Slow down: rate limit exceeded, try again in a minute.");
    return;
  }
  const [command, ...args] = content.slice(ctx.prefix.length).trim().split(/\s+/);
  const name = (command ?? "").toLowerCase();
  if (name === "help" || name === "") {
    await message.reply(
      [
        "metascope commands (attach an image/video, or reply to one):",
        `${ctx.prefix}scan — full scan (metadata, privacy, AI, hashes)`,
        `${ctx.prefix}read — metadata namespaces (full dump via DM)`,
        `${ctx.prefix}ai — AI provenance check`,
        `${ctx.prefix}hash — file, pixel, perceptual hashes`,
        `${ctx.prefix}strip — strip all metadata, verified clean`,
        `${ctx.prefix}edit KEY=VALUE ... — write tags`,
        `${ctx.prefix}autoscan on|off — auto-scan uploads here (needs Manage Channels)`,
      ].join("\n"),
    );
    return;
  }
  if (name === "autoscan") {
    const member = message.member;
    const canManage = member?.permissions.has(PermissionsBitField.Flags.ManageChannels) === true;
    if (!canManage) {
      await message.reply("Autoscan needs the Manage Channels permission.");
      return;
    }
    if (args[0]?.toLowerCase() === "on") {
      ctx.autoscanChannels.add(message.channelId);
      await message.reply("Auto-scan enabled for this channel.");
    } else if (args[0]?.toLowerCase() === "off") {
      ctx.autoscanChannels.delete(message.channelId);
      await message.reply("Auto-scan disabled for this channel.");
    } else {
      await message.reply(`Usage: ${ctx.prefix}autoscan on|off`);
    }
    return;
  }
  const incoming = await resolveIncoming(message);
  if (incoming.length === 0) {
    await message.reply("Attach an image/video, or reply to a message that has one.");
    return;
  }
  if (name === "scan") {
    await runScanCommand(message, ctx, incoming, false);
  } else if (
    name === "read" ||
    name === "ai" ||
    name === "hash" ||
    name === "strip" ||
    name === "edit"
  ) {
    await runSingleCommand(message, ctx, incoming, name, args);
  } else {
    await message.reply(`Unknown command. Try ${ctx.prefix}help.`);
  }
}

async function announce(message: Message, text: string): Promise<void> {
  if (!message.channel.isSendable()) {
    throw new Error("Cannot send messages in this channel.");
  }
  await message.channel.send(text);
}

async function runScanCommand(
  message: Message,
  ctx: PrefixContext,
  incoming: IncomingFile[],
  auto: boolean,
): Promise<void> {
  const fetched = await fetchAll(incoming, ctx.maxFileBytes, ctx.maxAttachmentsPerCommand);
  const lines: string[] = [];
  const dmFiles: OutFile[] = [];
  for (const file of fetched) {
    const result = await runScan(file.buffer, file.filename);
    lines.push(result.channelText);
    dmFiles.push(...result.files);
  }
  const header = auto ? "Auto-scan result:\n" : "";
  await sendPublic(message, header + lines.join("\n"), []);
  const { dmOk } = await dmFull(message, "Full scan report(s) attached.", dmFiles);
  if (!dmOk) {
    await announce(message, "DMs are closed: showing the redacted summary only.");
  }
}

async function runSingleCommand(
  message: Message,
  ctx: PrefixContext,
  incoming: IncomingFile[],
  name: string,
  args: string[],
): Promise<void> {
  const fetched = await fetchAll(incoming, ctx.maxFileBytes, ctx.maxAttachmentsPerCommand);
  for (const file of fetched) {
    let result: RunResult;
    let publicFiles: OutFile[] = [];
    if (name === "read") {
      result = await runRead(file.buffer, file.filename);
    } else if (name === "ai") {
      result = await runAi(file.buffer, file.filename);
    } else if (name === "hash") {
      result = await runHash(file.buffer, file.filename);
    } else if (name === "strip") {
      result = await runStrip(file.buffer, file.filename);
      publicFiles = result.files;
    } else {
      const tags = parseKeyValueArgs(args);
      result = await runEdit(file.buffer, file.filename, tags);
      publicFiles = result.files;
    }
    const bundled = await bundleZip(publicFiles);
    await sendPublic(message, result.channelText, bundled);
    const { dmOk } = await dmFull(message, result.dmText, result.files);
    if (!dmOk && result.files.length > 0) {
      await announce(message, "DMs are closed: showing the redacted summary only.");
    }
  }
}
