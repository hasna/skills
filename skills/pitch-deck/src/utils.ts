import { mkdirSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import type { Audience, Tone } from "./types";

export function buyerForAudience(audience: Audience): string {
  return {
    investors: "founders, operators, and category-aware investors",
    sales: "economic buyers and hands-on champions",
    internal: "executives, team leads, and operational owners",
  }[audience];
}

export function askForAudience(audience: Audience): string {
  return {
    investors: "Align on the raise narrative, target check size, and milestone plan.",
    sales: "Book a focused pilot with clear success criteria and decision date.",
    internal: "Approve the next milestone, owner, and operating cadence.",
  }[audience];
}

export function audienceGoalPhrase(audience: Audience): string {
  return {
    investors: "fundraising conversations",
    sales: "customer buying conversations",
    internal: "stakeholder alignment",
  }[audience];
}

export function tonePhrase(tone: Tone): string {
  return {
    concise: "Concise, direct",
    bold: "Bold, high-conviction",
    technical: "Precise, systems-aware",
  }[tone];
}

export function shorten(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trim()}...`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isAudience(value: string): value is Audience {
  return value === "investors" || value === "sales" || value === "internal";
}

export function isTone(value: string): value is Tone {
  return value === "concise" || value === "bold" || value === "technical";
}

export function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path: string, value: unknown) {
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}