import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isAbsolute } from "node:path";
import { privatePublicationCustomerError, privatePublicationSession } from "../lib/private-publication-customer.js";
import { preparePrivatePublication, continuePrivatePublication, inspectPrivatePublication } from "../lib/private-publication-recovery.js";
import { mcpError, mcpJson } from "./helpers.js";

export function registerPrivatePublicationTools(server: McpServer) {
  const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  const directory = z.string().max(4096).refine(isAbsolute, "Use an absolute local directory");
  const verification = { email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/), userId: uuid, membershipId: uuid, recoveryDirectory: directory };
  const description = "Manage a private source publication using fresh workspace-bound verification and a host-local recovery directory. Publishing requires explicit UUID current-version comparison and upload consent. Resume reuses immutable saved bytes and intent; an uncertain PUT is finalized for server verification, never uploaded twice. Sessions and signed URLs are not returned or persisted. Private execution is unavailable. Host request history may contain the supplied verification code.";
  const handler = (action: "publish" | "get" | "resume" | "cancel") => async (value: Record<string, unknown>) => {
    try {
      const client = await privatePublicationSession(String(value.email), String(value.code), { userId: String(value.userId), membershipId: String(value.membershipId) });
      const recovery = String(value.recoveryDirectory);
      if (action === "publish") await preparePrivatePublication(client, String(value.directory), recovery,
        { skillId: String(value.skillId), expectedCurrentVersionId: value.expectedCurrentVersionId as string | null, idempotencyKey: value.idempotencyKey as string | undefined });
      const result = action === "publish" || action === "resume"
        ? await continuePrivatePublication(client, recovery, { confirm: true, waitMs: value.waitMs as number | undefined })
        : await inspectPrivatePublication(client, recovery, action === "cancel");
      return mcpJson(result);
    } catch (error) { const result = privatePublicationCustomerError(error); return mcpError(result.code, result.error); }
  };
  server.registerTool("publish_private_skill", {
    title: "Publish private skill", description,
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: false },
    inputSchema: z.object({ ...verification, directory, skillId: uuid, expectedCurrentVersionId: uuid.nullable(), idempotencyKey: uuid.optional(), confirm: z.literal(true), waitMs: z.number().int().min(0).max(300000).optional() }).strict(),
  }, handler("publish"));
  server.registerTool("get_private_publication", {
    title: "Get private publication", description,
    annotations: { destructiveHint: false, readOnlyHint: true, idempotentHint: true },
    inputSchema: z.object(verification).strict(),
  }, handler("get"));
  server.registerTool("resume_private_publication", {
    title: "Resume private publication", description,
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: true },
    inputSchema: z.object({ ...verification, confirm: z.literal(true), waitMs: z.number().int().min(0).max(300000).optional() }).strict(),
  }, handler("resume"));
  server.registerTool("cancel_private_publication", {
    title: "Cancel private publication", description,
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: true },
    inputSchema: z.object({ ...verification, confirm: z.literal(true) }).strict(),
  }, handler("cancel"));
}
