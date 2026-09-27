export const DEFAULT_LIST_LIMIT = 30;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_TAG_LIMIT = 80;
export const DEFAULT_MCP_LIMIT = 25;
export const MAX_PAGE_LIMIT = 200;
export const DEFAULT_PREVIEW_CHARS = 600;

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export function truncateText(value: unknown, maxChars = 96): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function previewText(value: unknown, maxChars = DEFAULT_PREVIEW_CHARS): {
  text: string;
  length: number;
  truncated: boolean;
} {
  const text = String(value ?? "");
  return {
    text: text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text,
    length: text.length,
    truncated: text.length > maxChars,
  };
}

export function parsePageLimit(
  value: string | number | undefined,
  fallback: number,
  options: { max?: number; allowAll?: boolean } = {},
): number {
  const max = options.max ?? MAX_PAGE_LIMIT;
  if (typeof value === "string" && options.allowAll && value.trim().toLowerCase() === "all") {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (options.allowAll && parsed === 0) return Number.POSITIVE_INFINITY;
  if (parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function parsePageOffset(value: string | number | undefined, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function paginate<T>(
  items: T[],
  options: { limit: number; offset?: number },
): Page<T> {
  const offset = Math.min(parsePageOffset(options.offset), items.length);
  const effectiveLimit = Number.isFinite(options.limit)
    ? Math.max(0, Math.min(options.limit, MAX_PAGE_LIMIT))
    : Math.max(0, items.length - offset);
  const pageItems = items.slice(offset, offset + effectiveLimit);
  const nextOffset = offset + pageItems.length < items.length ? offset + pageItems.length : null;
  return {
    items: pageItems,
    total: items.length,
    offset,
    limit: effectiveLimit,
    hasMore: nextOffset !== null,
    nextOffset,
  };
}

export function showingLabel(total: number, shown: number, offset: number): string {
  if (offset > 0 || shown < total) return `showing ${shown} of ${total}, cursor ${offset}`;
  return String(total);
}

export function compactRunRecord(run: any): Record<string, unknown> {
  if (!run || typeof run !== "object") return {};
  return {
    id: run.id,
    skill: run.skill,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.remoteRunId ? { remoteRunId: run.remoteRunId } : {}),
    ...(run.costCents !== undefined ? { costCents: run.costCents } : {}),
    ...(run.error ? { error: truncateText(run.error, 240) } : {}),
    artifactCount: Array.isArray(run.artifacts) ? run.artifacts.length : 0,
    paths: run.paths,
  };
}

export function compactRemoteRun(run: any): Record<string, unknown> {
  if (!run || typeof run !== "object") return {};
  return {
    ...(run.contractVersion !== undefined ? { contractVersion: run.contractVersion } : {}),
    id: run.id,
    skill: run.skill ?? run.requestedSlug,
    status: run.status,
    ...(run.correlationId ? { correlationId: run.correlationId } : {}),
    ...(run.createdAt ? { createdAt: run.createdAt } : {}),
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.error || run.errorMessage ? { error: truncateText(run.error ?? run.errorMessage, 240) } : {}),
  };
}
