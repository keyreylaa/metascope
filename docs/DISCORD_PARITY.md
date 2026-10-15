# Discord parity (design; bot wiring stays Phase 5)

One core function stands behind every command, on both surfaces.
`src/core/help.ts` is the single source of truth for grouping,
one-liners, and examples — the CLI top help, `ms help <command>`,
and the future Discord `!help` all render from it.

## Command map

| CLI              | Prefix            | Slash                | Core function                                         |
| ---------------- | ----------------- | -------------------- | ----------------------------------------------------- |
| `scan`           | `!scan`           | `/meta scan`         | `runScan` (`src/discord/runner.ts` over `scanBuffer`) |
| `read`           | `!read`           | `/meta read`         | `runRead`                                             |
| `ai-check`       | `!ai`             | `/meta ai-check`     | `runAi`                                               |
| `hash`           | `!hash`           | `/meta hash`         | `runHash`                                             |
| `privacy-scan`   | `!privacy`        | `/meta privacy-scan` | `runPrivacy`                                          |
| `clean`          | `!clean`          | `/meta strip`        | `runClean` (needs confirm, see below)                 |
| `strip`          | `!strip`          | `/meta strip`        | `runStrip`                                            |
| `edit KEY=VALUE` | `!edit KEY=VALUE` | (prefix only)        | `runEdit`                                             |
| `gps --remove`   | `!gps remove`     | (none)               | `runGpsRemove`                                        |
| `help [cmd]`     | `!help [cmd]`     | (none)               | `renderTopHelp` / `renderCommandHelp`                 |

`copyright`, `dates`, `snapshot`, `batch`, `watch` are CLI-only:
freeform multi-option flows that do not map cleanly onto attachments.

## Reply rules (to enforce in Phase 5 wiring)

- Channel replies are redacted: severity/category/counts and
  verdict flags only. Never coordinates, serials, or owner names.
  `runPrivacy`/`runAi` already split `channelText` (redacted) from
  `dmText` (full) for exactly this.
- Full reports go to DM with file attachments. When DMs are closed,
  fall back to the redacted reply only.
- `!clean` returns the cleaned image as an attachment (zip when many).
  Check the guild upload limit first; never assume a number.
- `!clean` on a file with C2PA/AI provenance requires an explicit
  confirm step (button). `runClean(buffer, name, confirmed)`
  throws until `confirmed === true`.

## !help embed spec (Phase 5)

- One neutral accent color, title "metascope", one short description.
- Fields grouped Analyze / Modify / Info, straight from
  `COMMAND_HELP` groups (Analyze, Modify, Batch→Info label TBD in
  Phase 5; grouping text must come from core, never hardcoded).
- Each command in inline code with its one-liner.
- Footer: prefix and version.
- At most one plain symbol per group, or none. No emoji spam.
- `!help <command>` renders detail + examples from
  `renderCommandHelp`.

## Intent

Prefix commands need the Message Content privileged intent.
Document the enable path (Developer Portal → application → Bot →
Privileged Gateway Intents → MESSAGE CONTENT INTENT) and fail at
startup with those exact steps when the gateway reports
DisallowedIntents (close 4014). Already implemented in
`src/discord/bot.ts`; do not regress it.
