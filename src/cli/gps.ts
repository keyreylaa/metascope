import type { Command } from "commander";
import { prepareOutput } from "../core/fileOps.js";
import { effectiveOutDir, getConfig } from "./common.js";
import { parseLatLon, removeGps, setGps, showLocation } from "../core/gps.js";
import { gpsOptionsSchema } from "../core/schemas.js";

export function registerGpsCommand(program: Command): void {
  program
    .command("gps")
    .description("Show, set, or remove location data (offline; never geocodes)")
    .argument("<file>", "target file")
    .option("--show", "list all location fields with decimal coordinates", false)
    .option("--set <lat,lon>", 'coordinates, e.g. --set "-6.2,106.8"')
    .option("--remove", "remove all location tags, then verify by re-read", false)
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify the original (creates .metascope.bak first)", false)
    .action(
      async (
        file: string,
        options: { show: boolean; set?: string; remove: boolean; out?: string; inPlace: boolean },
      ) => {
        const parsed = gpsOptionsSchema.safeParse({
          out: options.out,
          outFile: undefined,
          inPlace: options.inPlace === true,
          set: options.set,
          remove: options.remove === true,
          show: options.show === true,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        if (parsed.data.show === true) {
          if (parsed.data.set || parsed.data.remove) {
            console.error("Combine --show with nothing else.");
            process.exitCode = 1;
            return;
          }
          const shown = await showLocation(file);
          if (shown.entries.length === 0) {
            console.log(`No location data in ${file}.`);
            return;
          }
          console.log(`Location data in ${file}:`);
          for (const entry of shown.entries) {
            console.log(`  ${entry.tag} = ${entry.value}`);
          }
          if (shown.lat !== null && shown.lon !== null) {
            console.log(`Decimal: ${shown.lat},${shown.lon}`);
            console.log(`Map: ${shown.mapsLink} (link text only, nothing was fetched)`);
          }
          return;
        }
        if ((parsed.data.set ? 1 : 0) + (parsed.data.remove ? 1 : 0) !== 1) {
          console.error("Provide exactly one of --set lat,lon or --remove.");
          process.exitCode = 1;
          return;
        }
        const target = await prepareOutput(
          file,
          effectiveOutDir(parsed.data.out, await getConfig()),
          undefined,
          parsed.data.inPlace,
          "_edited",
        );
        if (target.backup) {
          console.error(`Backup created: ${target.backup}`);
        }
        if (parsed.data.set) {
          const { lat, lon } = parseLatLon(parsed.data.set);
          await setGps(target.output, lat, lon);
          console.log(`GPS set to ${lat},${lon} in ${target.output} (verified on re-read).`);
        } else {
          const result = await removeGps(target.output);
          console.log(`GPS removed in ${target.output} (${result.removed.length} tag(s) cleared).`);
          if (result.residual.length > 0) {
            console.log(`Residual GPS: ${result.residual.join(", ")}`);
          }
        }
      },
    );
}
