import type { PureExecutionContract } from "../sdk/execution/types.js";
import pkg from "../../package.json";
import { readBoundedResponse } from "./remote-files.js";
import {
  resolveSkillsConnection,
  skillsApiRequestUrl,
} from "./fleet-credentials.js";
export interface CloudEligibility {
  contractVersion: 1;
  eligible: boolean;
  skill: string;
  version: string;
  bundleDigest: string;
  reason?: string;
  runtimeImageDigest?: string;
  executionContract?: PureExecutionContract | { id: "pdf.v1" };
  secrets?: "none";
  egress?: "deny";
}
export interface CloudExecution {
  contractVersion: 1;
  id: string;
  target: "cloud";
  skill: string;
  version: string;
  bundleDigest: string;
  inputDigest: string;
  runtimeImageDigest: string;
  executionContract?: PureExecutionContract | { id: "pdf.v1" };
  status:
    | "admitted"
    | "leased"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled";
  exitCode?: number;
  artifacts: {
    name: string;
    contentType: string;
    sha256: string;
    byteSize: number;
  }[];
}
export class CloudExecutionClient {
  constructor(
    private apiOrigin: string,
    private apiKey: string,
  ) {}
  static async configured(): Promise<CloudExecutionClient> {
    const c = await resolveSkillsConnection();
    if (!c)
      throw Error(
        "Cloud execution requires a configured Skills API credential",
      );
    return new CloudExecutionClient(c.apiOrigin, c.apiKey);
  }
  private async request(
    route: string,
    method = "GET",
    value?: unknown,
  ): Promise<Response> {
    const response = await fetch(
      skillsApiRequestUrl(this.apiOrigin, "/api/v1/executions/" + route),
      {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "User-Agent": `hasna-skills/${pkg.version}`,
          ...(value === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      void response.body?.cancel();
      throw Error(`Skills cloud execution refused: HTTP ${response.status}`);
    }
    return response;
  }
  /** Metadata only: never creates, starts or reconciles a task. */
  async eligibility(slug: string, version: string, bundleDigest?: string): Promise<CloudEligibility> {
    if (!/^[a-z0-9-]+$/.test(slug) || !/^\d+\.\d+\.\d+$/.test(version) ||
        (bundleDigest !== undefined && !/^(sha256:)?[a-f0-9]{64}$/.test(bundleDigest)))
      throw Error("Cloud eligibility requires an exact skill version and valid digest");
    const query = new URLSearchParams({ version, ...(bundleDigest ? { bundleDigest } : {}) });
    const v = await jsonBody(await this.request(`${slug}/eligibility?${query}`)) as CloudEligibility;
    if (!v || v.contractVersion !== 1 || typeof v.eligible !== "boolean" || v.skill !== slug || v.version !== version ||
        !/^[a-f0-9]{64}$/.test(v.bundleDigest) || (bundleDigest && bundleDigest.replace(/^sha256:/, "") !== v.bundleDigest) ||
        (v.eligible && (!v.executionContract || !["pdf.v1", "regex-test.v1"].includes(v.executionContract.id))))
      throw Error("Invalid cloud eligibility receipt");
    return v;
  }
  async submit(
    slug: string,
    version: string,
    input: unknown,
    key: string,
    selection?: {
      bundleDigest: string;
      workspaceId?: string;
      authority?: string;
    },
  ): Promise<CloudExecution> {
    if (!/^[a-z0-9-]+$/.test(slug) || !/^\d+\.\d+\.\d+$/.test(version))
      throw Error("Cloud execution requires skill@exact-version");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      throw Error("Invalid idempotency key");
    if (
      selection?.authority &&
      selection.authority !==
        skillsApiRequestUrl(this.apiOrigin, "/api/v1/").replace(/\/$/, "")
    )
      throw Error("Selected skill belongs to another Skills authority");
    const execution = parseExecution(
      await jsonBody(
        await this.request(slug, "POST", {
          version,
          input,
          idempotencyKey: key,
          ...(selection
            ? {
                bundleDigest: selection.bundleDigest,
                workspaceId: selection.workspaceId,
              }
            : {}),
        }),
      ),
    );
    if (
      execution.skill !== slug ||
      execution.version !== version ||
      (selection &&
        execution.bundleDigest.replace(/^sha256:/, "") !==
          selection.bundleDigest.replace(/^sha256:/, ""))
    )
      throw Error(
        "Cloud execution receipt does not match the selected exact skill",
      );
    return execution;
  }
  async get(id: string) {
    return parseExecution(await jsonBody(await this.request(runId(id))));
  }
  async logs(id: string): Promise<unknown> {
    return jsonBody(await this.request(runId(id) + "/logs"));
  }
  async artifacts(id: string): Promise<CloudExecution["artifacts"]> {
    return (await this.get(id)).artifacts;
  }
  async download(id: string, name: string): Promise<Uint8Array> {
    if (!["document.pdf", "document.html"].includes(name))
      throw Error("Invalid cloud artifact name");
    const response = await this.request(
      runId(id) + "/artifacts/" + encodeURIComponent(name),
    );
    if (!response.body) throw Error("Cloud artifact body is missing");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw Error("Cloud artifact exceeds limit");
      }
      chunks.push(r.value);
    }
    return Buffer.concat(chunks);
  }
  async cancel(id: string) {
    return parseExecution(
      await jsonBody(await this.request(runId(id) + "/cancel", "POST", {})),
    );
  }
  async wait(
    id: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<CloudExecution> {
    const timeout = options.timeoutMs ?? 300000,
      interval = options.intervalMs ?? 1000;
    if (
      !Number.isFinite(timeout) ||
      timeout < 1 ||
      timeout > 1200000 ||
      !Number.isFinite(interval) ||
      interval < 100 ||
      interval > 60000
    )
      throw Error("Invalid cloud polling bounds");
    const until = Date.now() + timeout;
    for (;;) {
      const run = await this.get(id);
      if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
      if (Date.now() >= until)
        throw Error(
          "Cloud execution is still running; poll the returned execution id",
        );
      await Bun.sleep(interval);
    }
  }
}
function runId(id: string) {
  if (!/^run_[a-z0-9_]+$/.test(id)) throw Error("Invalid cloud execution id");
  return id;
}
function parseExecution(value: unknown): CloudExecution {
  const v = value as CloudExecution;
  if (
    !v ||
    v.contractVersion !== 1 ||
    v.target !== "cloud" ||
    ![
      "admitted",
      "leased",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ].includes(v.status) ||
    typeof v.skill !== "string" ||
    typeof v.version !== "string" ||
    !Array.isArray(v.artifacts)
  )
    throw Error("Unsupported cloud execution response");
  runId(v.id);
  for (const field of [
    "bundleDigest",
    "inputDigest",
    "runtimeImageDigest",
  ] as const)
    if (
      typeof v[field] !== "string" ||
      !/^(sha256:)?[a-f0-9]{64}$/.test(v[field])
    )
      throw Error("Invalid cloud execution integrity receipt");
  return v;
}

async function jsonBody(response: Response): Promise<unknown> {
  const bytes = await readBoundedResponse(response, 100000);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw Error("Invalid cloud execution JSON response");
  }
}
