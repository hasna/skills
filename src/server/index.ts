#!/usr/bin/env bun
import { resolveServerConfig } from "./config.js";
import { startSkillsServer } from "./app.js";

const config = resolveServerConfig();
const server = await startSkillsServer({ config });

console.log(`open-skills API listening on http://${config.host}:${server.port}`);
