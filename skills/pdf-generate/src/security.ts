export function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  const lowerUrl = trimmed.toLowerCase();
  if (lowerUrl.startsWith("javascript:") || lowerUrl.startsWith("data:") || lowerUrl.startsWith("vbscript:")) {
    return "";
  }
  return escapeHtml(trimmed);
}

export function sanitizeTemplateData(data: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("linkedin") ||
      lowerKey.includes("website") ||
      lowerKey.includes("url") ||
      lowerKey.includes("href")
    ) {
      sanitized[key] = sanitizeUrl(value);
    } else {
      sanitized[key] = escapeHtml(value);
    }
  }
  return sanitized;
}
