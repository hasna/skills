import { Command } from "commander";
import { registerMaintenance } from "./maintenance-entry.js";

const program = new Command();
program.name("skills-maintenance");
registerMaintenance(program);
await program.parseAsync(process.argv);
