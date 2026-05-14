import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

export function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

export function writeFile(path: string, content: string) {
  ensureDir(dirname(path));
  writeFileSync(path, content);
}

export function writeJson(path: string, value: unknown) {
  writeFile(path, JSON.stringify(value, null, 2));
}
