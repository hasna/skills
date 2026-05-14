import type { Palette, SectionKind, WebsiteOptions, WebsiteSection } from "./types";

export function detectKind(section: string): SectionKind {
  if (section.includes("hero")) return "hero";
  if (section.includes("feature") || section.includes("benefit") || section.includes("solution")) return "features";
  if (section.includes("proof") || section.includes("case") || section.includes("testimonial")) return "proof";
  if (section.includes("price") || section.includes("plan")) return "pricing";
  if (section.includes("faq") || section.includes("question")) return "faq";
  if (section.includes("cta") || section.includes("contact") || section.includes("signup")) return "cta";
  return "custom";
}

export function buildPalette(options: WebsiteOptions): Palette {
  const hue = hash(`${options.name}:${options.style}`) % 360;
  return {
    ink: hslToHex(hue, 30, 15),
    paper: hslToHex((hue + 32) % 360, 28, 96),
    accent: hslToHex((hue + 96) % 360, 60, 44),
    support: hslToHex((hue + 178) % 360, 40, 58),
    line: hslToHex(hue, 18, 82),
  };
}

export function deriveName(brief: string) {
  return titleCase(brief.split(/\s+/).filter(Boolean).slice(0, 3).join(" ")) || "Launch Page";
}

export function plainBrief(brief: string) {
  return brief.replace(/\s+/g, " ").trim().toLowerCase();
}

export function navLabel(section: WebsiteSection) {
  if (section.kind === "cta") return "Start";
  return titleCase(section.id);
}

export function splitList(value: unknown, fallback: string[]) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const items = value.split(",").map((item) => slugify(item)).filter(Boolean);
  return items.length ? items : fallback;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function hash(value: string) {
  return Array.from(value).reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 29);
}

function hslToHex(h: number, s: number, l: number) {
  const saturation = s / 100;
  const lightness = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((value) => Math.round(255 * value).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
