#!/usr/bin/env bun
/**
 * icon-pack — generate a coordinated icon pack and return SVGs + transparent PNGs.
 *
 * This is a remote skill. The local CLI submits a run to the skills.md platform,
 * which executes the work and returns the artifacts. All processing happens server-side.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type Args = {
  theme: string;
  style: "line" | "filled" | "duotone";
  count: number;
  sizes: number[];
  out: string;
};

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  if (!args.theme) {
    console.error("Usage: icon-pack --theme <theme> [--style line|filled|duotone] [--count 48] [--sizes 256,512] [--out ./icon-pack]");
    process.exit(2);
  }
  const style = (args.style ?? "line") as Args["style"];
  if (!["line", "filled", "duotone"].includes(style)) {
    console.error(`Invalid --style: ${style}`);
    process.exit(2);
  }
  return {
    theme: args.theme,
    style,
    count: Number(args.count ?? 48),
    sizes: (args.sizes ?? "256,512").split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0),
    out: resolve(args.out ?? "./icon-pack"),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

type RunArtifact = {
  path: string;
  content_b64: string;
};

type RunResult = {
  run_id: string;
  status: "succeeded" | "failed";
  artifacts: RunArtifact[];
  error?: string;
};

async function submitRun(args: Args, apiKey: string, apiBase: string): Promise<RunResult> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/runs/icon-pack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        theme: args.theme,
        style: args.style,
        count: args.count,
        sizes: args.sizes,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`icon-pack run failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RunResult;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = requireEnv("SKILLS_API_KEY");
  const apiBase = process.env.SKILLS_API_BASE ?? "https://skills.md";

  await mkdir(args.out, { recursive: true });

  console.log(`[icon-pack] submitting run (theme="${args.theme}", style=${args.style}, count=${args.count})`);
  const result = await submitRun(args, apiKey, apiBase);

  if (result.status !== "succeeded") {
    console.error(`[icon-pack] run failed: ${result.error ?? "unknown error"}`);
    process.exit(1);
  }

  for (const artifact of result.artifacts) {
    const dest = join(args.out, artifact.path);
    await mkdir(join(dest, ".."), { recursive: true });
    await writeFile(dest, Buffer.from(artifact.content_b64, "base64"));
  }

  console.log(`[icon-pack] done · ${args.out}`);
  console.log(
    JSON.stringify(
      {
        run_id: result.run_id,
        out: args.out,
        artifacts: result.artifacts.length,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
