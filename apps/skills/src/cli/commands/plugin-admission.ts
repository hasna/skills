import type { Command } from "commander";
import { writeCliOutput } from "../output.js";
import { admitPlugin, planPluginAdmission, resolveAdmittedPlugin, validatePluginTarget } from "../../lib/plugin-admission.js";
import { readPluginJson } from "../../lib/plugin-projection-store.js";
import { SkillSelectionError } from "../../lib/selection-cache.js";

export function registerPluginAdmission(parent: Command): void {
  const plugin = parent.command("integration").description("Reviewed native-agent integrations").command("plugin").description("Admit private versioned plugin projections before native discovery");
  for (const name of ["plan", "admit"] as const) {
    const command = plugin.command(`${name} <skill>`).requiredOption("--selection-profile <id>", "API profile selecting the integration bundle and migrated payloads")
      .requiredOption("--target <file>", "Owner-only JSON target with exact native scopes and executable witnesses")
      .description(name === "plan" ? "Validate original provenance, payload migration and preserved components using the Skills API" : "Materialize the exact reviewed plan and record its immutable admission");
    if (name === "admit") command.requiredOption("--plan-digest <sha256>", "Exact digest returned by the reviewed plan")
      .requiredOption("--evidence-digest <sha256>", "Exact authenticated routing-evidence digest returned by the reviewed plan");
    command.action(async (skill, options) => {
      try {
        const target = readPluginJson(options.target); validatePluginTarget(target);
        const result = name === "plan" ? await planPluginAdmission(skill, options.selectionProfile, target) : await admitPlugin(skill, options.selectionProfile, target, options.planDigest, options.evidenceDigest);
        await writeCliOutput(JSON.stringify(result, null, 2));
      } catch (error) { report(error); }
    });
  }
  plugin.command("resolve").requiredOption("--binding <sha256>", "Approved owner-local integration binding")
    .description("Freshly authorize and return one complete immutable directory for a Claude command source")
    .action(async options => {
      try { await writeCliOutput(await resolveAdmittedPlugin(options.binding)); }
      catch (error) { report(error); }
    });
}
function report(error: unknown): void {
  // Foreign provider/OS errors are never printed: command-source stderr must not leak credentials.
  const code = error instanceof SkillSelectionError ? error.code : "PLUGIN_ADMISSION_REFUSED";
  process.stderr.write(`${code}: Plugin admission failed. Check the selected profile, approved plan and immutable package integrity.\n`);
  process.exitCode = 1;
}
