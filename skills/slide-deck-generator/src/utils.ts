export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
    .replace(/(^|\s)_([^_]+)_/g, "$1$2")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleCase(value: string): string {
  const cleaned = value.trim().replace(/[.:;,]+$/, "");
  if (!cleaned) return "Untitled";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function shorten(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-\s]+$/, "")}…`;
}

export function headlineFrom(sentence: string): string {
  const stripped = stripInlineMarkdown(sentence).replace(/^(the|a|an)\s+/i, "");
  const words = stripped.split(" ").slice(0, 8).join(" ");
  return titleCase(shorten(words, 60));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Slide model construction                                                    */
/* -------------------------------------------------------------------------- */


