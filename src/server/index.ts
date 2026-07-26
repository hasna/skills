#!/usr/bin/env bun
import { resolveServerConfig } from "./config.js";
import { resolveDatabaseTarget } from "./database-url.js";
import { startSkillsServer } from "./app.js";

const config = resolveServerConfig();
const server = await startSkillsServer({ config });

console.log(`open-skills API listening on http://${config.host}:${server.port}`);
// Name the backend and, for SQLite, the file. An operator should never have to guess
// where their runs are being written - and if this line ever says "memory", it now took
// an explicit opt-in to get there rather than a forgotten environment variable.
console.log(`storage: ${resolveDatabaseTarget(config.databaseUrl).label}`);
