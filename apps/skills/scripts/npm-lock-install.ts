/**
 * SH-00058. npm leaves an optional package the registry refuses out of the lock
 * it writes, and `npm ci` then refuses that lock as out of sync ("Missing:
 * @hasna/secrets@ from lock file"). An install without access to the optional,
 * private @hasna/secrets therefore uses `npm install` from the lock, as Skills'
 * self-update does. This names the command a consumer fixture runs for a lock:
 * `npm ci` where the lock is complete, `npm install` where it leaves only Skills'
 * own @hasna/secrets unresolved, and a refusal for any other gap.
 */
export const REFUSED_OPTIONAL_PACKAGE = "@hasna/secrets";

export function npmLockInstallCommand(lockText: string): "ci" | "install" {
  const packages = (JSON.parse(lockText) as { packages?: Record<string, { optionalDependencies?: Record<string, string>; link?: boolean }> }).packages ?? {};
  const resolves = (from: string, name: string) => {
    for (let base = from; ; ) {
      if (packages[base ? `${base}/node_modules/${name}` : `node_modules/${name}`]) return true;
      if (!base) return false;
      const at = base.lastIndexOf("node_modules/");
      base = at > 0 ? base.slice(0, at - 1) : "";
    }
  };
  const gaps = Object.entries(packages).filter(([, entry]) => !entry.link)
    .flatMap(([from, entry]) => Object.keys(entry.optionalDependencies ?? {}).filter(name => !resolves(from, name)).map(name => `${from} ${name}`));
  if (!gaps.length) return "ci";
  if (gaps.every(gap => gap === `node_modules/@hasna/skills ${REFUSED_OPTIONAL_PACKAGE}`)) return "install";
  throw new Error(`The npm lock leaves optional packages unresolved: ${gaps.join(", ")}`);
}
