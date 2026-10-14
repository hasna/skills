/**
 * The station opt-out for managed-hook session pin migration. Only a missing
 * global configuration, or a readable JSON object without the key or with
 * exactly "auto", turns migration on; anything damaged or unexpected keeps the
 * refusal, so a broken file can never silently defeat an operator's "off".
 */
import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DATA_DIR_ENV, getConfigPathReadOnly, saveConfig, sessionPinMigrationEnabled } from "./config.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const configPath = () => getConfigPathReadOnly("global");
function write(text: string): void {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), text, { mode: 0o600 });
}

test("a missing global configuration, or one without the key or with exactly auto, keeps migration on", () => {
  // Missing means lstat finds no entry inside an existing data directory.
  mkdirSync(dirname(configPath()), { recursive: true });
  expect(existsSync(configPath())).toBe(false);
  expect(sessionPinMigrationEnabled()).toBe(true);
  for (const document of [{}, { format: "json" }, { sessionPinMigration: "auto" }]) {
    write(JSON.stringify(document));
    expect(sessionPinMigrationEnabled()).toBe(true);
  }
});

const disabling: Array<[string, string]> = [
  ["off", JSON.stringify({ sessionPinMigration: "off" })],
  ["malformed JSON meant as off", '{"sessionPinMigration": "off",}'],
  ["a truncated write", '{"sessionPinMigration": "o'],
  ["an empty file", ""],
  ["the value OFF", JSON.stringify({ sessionPinMigration: "OFF" })],
  ["the value false", JSON.stringify({ sessionPinMigration: false })],
  ["the value null", JSON.stringify({ sessionPinMigration: null })],
  ["an empty value", JSON.stringify({ sessionPinMigration: "" })],
  ["an array document", "[]"],
  ["a string document", JSON.stringify("auto")],
  ["a null document", "null"],
  ["a retired key", JSON.stringify({ mode: "local", sessionPinMigration: "auto" })],
];
for (const [name, text] of disabling) test(`a global configuration with ${name} keeps the refusal`, () => {
  write(text);
  expect(sessionPinMigrationEnabled()).toBe(false);
});

test("an unreadable global configuration keeps the refusal", () => {
  // A directory where the file belongs cannot be read either.
  mkdirSync(configPath(), { recursive: true });
  expect(sessionPinMigrationEnabled()).toBe(false);
  rmSync(configPath(), { recursive: true });
  write(JSON.stringify({ sessionPinMigration: "off" }));
  chmodSync(configPath(), 0o000);
  try {
    // An account that bypasses file modes reads it and honours "off" anyway.
    expect(sessionPinMigrationEnabled()).toBe(false);
  } finally { chmodSync(configPath(), 0o600); }
});

test("the project configuration refuses sessionPinMigration, which managed hooks never read there", () => {
  const cwd = process.cwd(), project = mkdtempSync(join(tmpdir(), "skills-config-project-"));
  process.chdir(project);
  try {
    expect(() => saveConfig("sessionPinMigration", "off", "project")).toThrow("sessionPinMigration is read only from the global configuration. Use: skills config set sessionPinMigration <auto|off> --global");
    expect(() => saveConfig("sessionPinMigration", "off")).toThrow("--global");
    expect(existsSync(join(project, "skills.config.json"))).toBe(false);
    expect(sessionPinMigrationEnabled()).toBe(true);
    saveConfig("sessionPinMigration", "off", "global");
    expect(sessionPinMigrationEnabled()).toBe(false);
    saveConfig("sessionPinMigration", "auto", "global");
    expect(sessionPinMigrationEnabled()).toBe(true);
  } finally { process.chdir(cwd); rmSync(project, { recursive: true, force: true }); }
});

test("a dangling symlink at the global configuration is unreadable, not missing", () => {
  mkdirSync(dirname(configPath()), { recursive: true });
  symlinkSync(`${configPath()}.missing-off-target`, configPath());
  expect(sessionPinMigrationEnabled()).toBe(false);
});

test("a symlinked global configuration keeps the refusal even when its target allows migration", () => {
  mkdirSync(dirname(configPath()), { recursive: true });
  const target = `${configPath()}.target`;
  writeFileSync(target, JSON.stringify({ sessionPinMigration: "auto" }), { mode: 0o600 });
  symlinkSync(target, configPath());
  expect(sessionPinMigrationEnabled()).toBe(false);
});

for (const ancestry of ["missing", "dangling"] as const) test(`a ${ancestry} data directory keeps the refusal`, () => {
  const prior = process.env[DATA_DIR_ENV], root = mkdtempSync(join(tmpdir(), "skills-config-ancestry-"));
  const data = join(root, "skills");
  if (ancestry === "dangling") symlinkSync(join(root, "gone"), data);
  process.env[DATA_DIR_ENV] = data;
  try {
    expect(configPath()).toBe(join(data, "config.json"));
    expect(sessionPinMigrationEnabled()).toBe(false);
  } finally {
    if (prior === undefined) delete process.env[DATA_DIR_ENV]; else process.env[DATA_DIR_ENV] = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
