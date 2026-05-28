export function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Sanitize a URL to prevent javascript: and data: URL injection
 * Only allows http:, https:, relative paths, and protocol-relative URLs
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  const lowerUrl = trimmed.toLowerCase();
  // Block dangerous protocols
  if (
    lowerUrl.startsWith("javascript:") ||
    lowerUrl.startsWith("data:") ||
    lowerUrl.startsWith("vbscript:")
  ) {
    return "";
  }
  // Allow safe protocols and relative URLs
  if (
    lowerUrl.startsWith("http://") ||
    lowerUrl.startsWith("https://") ||
    lowerUrl.startsWith("mailto:") ||
    lowerUrl.startsWith("tel:") ||
    lowerUrl.startsWith("/") ||
    !lowerUrl.includes(":")
  ) {
    return escapeHtml(trimmed);
  }
  return "";
}
