// Single source of truth for command help text. The CLI top-level help,
// `ms help <command>`, and the Discord !help output all render from this
// module so the grouping and wording can never drift apart.

export type HelpGroup = "Analyze" | "Modify" | "Batch";

export interface CommandHelp {
  name: string;
  group: HelpGroup;
  oneLiner: string;
  examples: [string, string];
  cli: string;
  prefix: string;
  slash: string;
}

export const COMMAND_HELP: CommandHelp[] = [
  {
    name: "scan",
    group: "Analyze",
    oneLiner: "Everything in one read-only command: metadata, privacy, AI provenance, hashes.",
    examples: ["ms scan ./photos --out ./report", "ms scan a.jpg --format json,html --no-hash"],
    cli: "scan",
    prefix: "!scan",
    slash: "/meta scan",
  },
  {
    name: "read",
    group: "Analyze",
    oneLiner: "Dump metadata grouped by namespace.",
    examples: ["ms read photo.jpg", "ms read photo.jpg --format json --raw"],
    cli: "read",
    prefix: "!read",
    slash: "/meta read",
  },
  {
    name: "ai-check",
    group: "Analyze",
    oneLiner: "Layered AI-generation provenance check (metadata + optional ML pixel check).",
    examples: ["ms ai-check image.png", "ms ai-check image.png --no-ml"],
    cli: "ai-check",
    prefix: "!ai",
    slash: "/meta ai-check",
  },
  {
    name: "hash",
    group: "Analyze",
    oneLiner: "File, pixel, and perceptual hashes (integrity/duplicates, NOT AI detection).",
    examples: ["ms hash photo.jpg", "ms hash a.jpg --compare b.jpg"],
    cli: "hash",
    prefix: "!hash",
    slash: "/meta hash",
  },
  {
    name: "privacy-scan",
    group: "Analyze",
    oneLiner: "Privacy risk report with severity per finding.",
    examples: ["ms privacy-scan photo.jpg", "ms privacy-scan ./photos"],
    cli: "privacy-scan",
    prefix: "!privacy",
    slash: "/meta privacy-scan",
  },
  {
    name: "models",
    group: "Analyze",
    oneLiner: "Download and manage the optional ML pixel-classifier model.",
    examples: ["ms models install", "ms models list"],
    cli: "models",
    prefix: "(CLI only)",
    slash: "(none)",
  },
  {
    name: "clean",
    group: "Modify",
    oneLiner: "Maximum-privacy strip with verification; prints clean only when proven.",
    examples: ["ms clean photo.jpg", "ms clean photo.jpg --rename random --yes"],
    cli: "clean",
    prefix: "!clean",
    slash: "/meta strip",
  },
  {
    name: "strip",
    group: "Modify",
    oneLiner: "Remove metadata by mode (default privacy); originals untouched.",
    examples: ["ms strip photo.jpg --verify", "ms strip photo.jpg --mode gps --verify"],
    cli: "strip",
    prefix: "!strip",
    slash: "/meta strip",
  },
  {
    name: "edit",
    group: "Modify",
    oneLiner: "Write tags (alias: edit = write); reports every tag not written.",
    examples: ['ms edit photo.jpg --set Artist="Aku"', "ms write photo.jpg --from-json tags.json"],
    cli: "edit|write",
    prefix: "!edit KEY=VALUE",
    slash: "(prefix only)",
  },
  {
    name: "copyright",
    group: "Modify",
    oneLiner: "Set owner/notice/URL/usage-terms fields.",
    examples: ['ms copyright photo.jpg --owner "Aku"', "ms copyright photo.jpg --owner X --sync"],
    cli: "copyright",
    prefix: "(CLI only)",
    slash: "(none)",
  },
  {
    name: "gps",
    group: "Modify",
    oneLiner: "Show, set, or remove all location data (offline; never geocodes).",
    examples: ["ms gps photo.jpg --show", "ms gps photo.jpg --remove"],
    cli: "gps",
    prefix: "!gps remove",
    slash: "(none)",
  },
  {
    name: "dates",
    group: "Modify",
    oneLiner: "Set or shift date/time tags.",
    examples: ['ms dates photo.jpg --set "2024:01:02 03:04:05"', "ms dates photo.jpg --shift 3600"],
    cli: "dates",
    prefix: "(CLI only)",
    slash: "(none)",
  },
  {
    name: "snapshot",
    group: "Modify",
    oneLiner: "Save, restore, and diff full-metadata snapshots.",
    examples: ["ms snapshot save photo.jpg", "ms snapshot diff a.jpg b.jpg"],
    cli: "snapshot",
    prefix: "(CLI only)",
    slash: "(none)",
  },
  {
    name: "batch",
    group: "Batch",
    oneLiner: "Bulk strip/write over directories with a concurrency pool.",
    examples: ["ms batch strip ./photos --dry-run", "ms batch write ./photos --set Artist=X"],
    cli: "batch",
    prefix: "(CLI only)",
    slash: "(none)",
  },
  {
    name: "watch",
    group: "Batch",
    oneLiner: "Watch directories and scan new/changed images until Ctrl+C.",
    examples: ["ms watch ./incoming --out ./sidecars", "ms watch ./a ./b --ext jpg,png"],
    cli: "watch",
    prefix: "(CLI only)",
    slash: "(none)",
  },
];

const GROUP_ORDER: HelpGroup[] = ["Analyze", "Modify", "Batch"];

export function renderTopHelp(): string {
  const lines = ["metascope — photo/video metadata toolkit", ""];
  for (const group of GROUP_ORDER) {
    lines.push(`${group}:`);
    for (const entry of COMMAND_HELP.filter((item) => item.group === group)) {
      lines.push(`  ${entry.cli}  ${entry.oneLiner}`);
      for (const example of entry.examples) {
        lines.push(`    e.g. ${example}`);
      }
    }
    lines.push("");
  }
  lines.push("Run `ms help <command>` for detail and examples.");
  return lines.join("\n");
}

export function renderCommandHelp(name: string): string | null {
  const entry = COMMAND_HELP.find((item) => item.name === name);
  if (!entry) {
    return null;
  }
  return [
    `${entry.cli} — ${entry.oneLiner}`,
    ...entry.examples.map((example) => `  e.g. ${example}`),
    `Discord: ${entry.prefix} / ${entry.slash}`,
    `Full flags: ms ${entry.name} --help`,
  ].join("\n");
}
