import { dirname, join } from "node:path";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Use the release compiler in a fresh process, independent of test module caches. */
export async function buildCliFixture(entrypoint: string, outfile: string): Promise<void> {
  // Keep import.meta.url in the installed Contracts module: its native helper
  // lives beside that package, not beside the fixture's compiled CLI.
  const dependency = dirname(dirname(fileURLToPath(import.meta.resolve("@hasna/contracts/kernel-lock"))));
  const scope = join(dirname(outfile), "node_modules", "@hasna"), installed = join(scope, "contracts");
  mkdirSync(scope, { recursive: true });
  try { symlinkSync(dependency, installed, "dir"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || realpathSync(installed) !== realpathSync(dependency)) throw error;
  }
  const child = Bun.spawn([process.execPath, "--no-env-file", "build", entrypoint, "--outfile", outfile, "--target", "bun", "--external", "@hasna/contracts/kernel-lock"], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw new Error(`CLI fixture build failed (${status}):\n${stdout.slice(-4_000)}${stderr.slice(-4_000)}`);
  } finally { clearTimeout(deadline); }
}
