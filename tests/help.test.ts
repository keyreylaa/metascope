import { describe, expect, it } from "vitest";
import { COMMAND_HELP, renderCommandHelp, renderTopHelp } from "../src/core/help.js";

describe("help single source of truth", () => {
  it("groups every command under Analyze, Modify, or Batch", () => {
    const groups = new Set(COMMAND_HELP.map((entry) => entry.group));
    expect([...groups].sort()).toEqual(["Analyze", "Batch", "Modify"]);
    for (const entry of COMMAND_HELP) {
      expect(entry.oneLiner.length).toBeGreaterThan(0);
      expect(entry.examples).toHaveLength(2);
    }
  });

  it("renders grouped top help with examples", () => {
    const text = renderTopHelp();
    expect(text).toContain("Analyze:");
    expect(text).toContain("Modify:");
    expect(text).toContain("Batch:");
    expect(text).toContain("ms help <command>");
  });

  it("renders one command and rejects unknown names", () => {
    const text = renderCommandHelp("scan");
    expect(text).toContain("read-only");
    expect(text).toContain("!scan");
    expect(renderCommandHelp("nope")).toBeNull();
  });
});
