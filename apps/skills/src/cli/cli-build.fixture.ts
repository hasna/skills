import { dirname } from "node:path";

/** Use the release compiler in a fresh process, independent of test module caches. */
export async function buildCliFixture(entrypoint: string, outfile: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "--no-env-file", "build", entrypoint, "--outfile", outfile, "--target", "bun"], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw new Error(`CLI fixture build failed (${status}):\n${stdout.slice(-4_000)}${stderr.slice(-4_000)}`);
  } finally { clearTimeout(deadline); }
}
