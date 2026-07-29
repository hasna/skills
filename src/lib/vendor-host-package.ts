import { decodeForScanning, looksBinary } from "./file-bytes.js";
import type { CodeUrlFinding } from "./vendor-host-code-scan.js";
import type { ScanSource, VendorHostFinding } from "./vendor-host-url.js";

// ---------------------------------------------------------------------------
// Reading the package, and proving we actually read it.
// ---------------------------------------------------------------------------

export interface PackedFs {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { isFile: () => boolean };
  readFileSync: (path: string) => Buffer;
}

/**
 * Read every file in the published package as a scan source.
 *
 * Driven by the packer's own file list rather than by walking `src/`: the `files`
 * negation globs mean the repository and the published tarball are different
 * sets of bytes, and the tarball is what a user installs.
 *
 * Bytes that will not decode are recorded as `undecodable` rather than skipped.
 * Skipping is how a single NUL byte makes a whole file invisible to a scanner.
 */
export function readPackedSources(
  packedFiles: readonly string[],
  root: string,
  fs: PackedFs,
  joinPath: (...parts: string[]) => string,
): ScanSource[] {
  const sources: ScanSource[] = [];
  for (const file of packedFiles) {
    const absolute = joinPath(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const buffer = fs.readFileSync(absolute);
    // Decoding is shared with the rest of the guards (`file-bytes.ts`), which
    // handle UTF-16 and strip NULs rather than skipping the file. Only genuinely
    // compiled/compressed content is set aside, and for a source file that is
    // itself reported rather than passed over.
    if (looksBinary(buffer)) {
      sources.push({ file, content: "", undecodable: "compiled or compressed binary content" });
      continue;
    }
    sources.push({ file, content: decodeForScanning(buffer) });
  }
  return sources;
}

export interface EntryPointCoverage {
  path: string;
  packed: boolean;
  read: boolean;
  certified: boolean;
}

/** Every path a consumer can `require`/`import`/execute, from package.json. */
export function declaredEntryPoints(manifest: unknown): string[] {
  const paths = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.startsWith("./") || value.startsWith("bin/") || value.startsWith("dist/")) {
        paths.add(value.replace(/^\.\//, ""));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(collect);
    }
  };
  const record = (manifest ?? {}) as Record<string, unknown>;
  collect(record.bin);
  collect(record.main);
  collect(record.exports);
  collect(record.module);
  return [...paths].filter((path) => !path.endsWith(".d.ts")).sort();
}

/**
 * Anti-vacuity, per entry point.
 *
 * A global "we scanned more than N files" is satisfiable by files that have
 * nothing to do with the code under test: on an unbuilt tree the skill corpus
 * alone cleared the old threshold while `bin/`, `dist/` and everything they are
 * built from went unscanned. Coverage has to be asserted against the specific
 * artifacts a consumer runs.
 */
export function checkEntryPointCoverage(
  manifest: unknown,
  packedFiles: readonly string[],
  scanned: ReadonlyMap<string, { certified: boolean }>,
): EntryPointCoverage[] {
  const packed = new Set(packedFiles);
  return declaredEntryPoints(manifest).map((path) => {
    const entry = scanned.get(path);
    return {
      path,
      packed: packed.has(path),
      read: entry !== undefined,
      certified: entry?.certified ?? false,
    };
  });
}

export function uncoveredEntryPoints(coverage: readonly EntryPointCoverage[]): EntryPointCoverage[] {
  return coverage.filter((entry) => !entry.packed || !entry.read || !entry.certified);
}

export function formatFindings(
  findings: ReadonlyArray<VendorHostFinding | CodeUrlFinding>,
): string {
  return findings
    .map((finding) => {
      if (!("kind" in finding)) return `  ${finding.file}: ${finding.url}`;
      const where = `${finding.file}:${finding.line}`;
      switch (finding.kind) {
        case "vendor-host":
          return `  ${where}: ${finding.url} (${finding.position}; host ${finding.domain} — VENDOR-CONTROLLED)`;
        case "unapproved-host":
          return `  ${where}: ${finding.url} (${finding.position}; host ${finding.domain} — not on APPROVED_CODE_HOSTS)`;
        case "undeterminable-host":
          return `  ${where}: ${finding.url} (${finding.position}; ${finding.detail})`;
        case "vendor-domain-token":
          return `  ${where}: ${finding.position}; ${finding.detail} — VENDOR-CONTROLLED`;
        default:
          return `  ${where}: cannot certify — ${finding.detail}`;
      }
    })
    .join("\n");
}

