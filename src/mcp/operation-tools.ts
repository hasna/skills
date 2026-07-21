import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };

import {
  CATEGORIES,
  clearRegistryCache,
  getSkill,
  getSkillsByCategory,
  findSimilarSkills,
  loadRegistry,
  type Category,
} from "../lib/registry.js";
import {
  installSkill,
  getInstalledSkills,
  removeSkill,
  resolveAgents,
  getSkillPath,
  getAgentSkillsDir,
  AGENT_TARGETS,
  AGENT_LABELS,
  type AgentTarget,
} from "../lib/installer.js";
import { getSkillRequirements, runSkill } from "../lib/skillinfo.js";
import {
  completeSkillRun,
  createSkillRun,
  findSkillRun,
  updateSkillRun,
  writeRunLogs,
} from "../lib/run-state.js";
import {
  portPortableSkill,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
} from "../lib/portable-skills.js";
import {
  compactRemoteRun,
  compactRunRecord,
  previewText,
} from "../lib/compact-output.js";
import { cacheClear, mcpError, mcpJson, remoteRunNextActions } from "./helpers.js";
import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../lib/remote-run-contract.js";
import { getHostedRunAvailability } from "../lib/hosted-availability.js";
import { resolveCurrentDeploymentMode } from "../lib/deployment-mode.js";
import { loadRemoteSkill } from "../lib/remote-registry.js";
import { toCustomerCreditPayload, toPublicCreditQuote } from "../lib/public-credits.js";

export function registerOperationTools(server: McpServer): void {
  server.registerTool("scaffold_skill", {
    title: "Scaffold Skill",
    description: "Create a portable skill folder under ~/.hasna/skills/<name> with SKILL.md, skill.json, AGENTS.md, package.json, and src/index.ts.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
  }, async ({ name, description, overwrite }) => {
    try {
      const result = scaffoldPortableSkill(name, { description, overwrite });
      clearRegistryCache();
      cacheClear();
      return mcpJson(result);
    } catch (err) {
      return mcpError("SCAFFOLD_FAILED", (err as Error).message);
    }
  });

  server.registerTool("port_skill", {
    title: "Port Skill",
    description: "Import an existing skill folder into the portable ~/.hasna/skills/<name> standard and add missing standard files.",
    inputSchema: {
      path: z.string(),
      name: z.string().optional(),
      overwrite: z.boolean().optional(),
      allowShadow: z.boolean().optional(),
    },
  }, async ({ path, name, overwrite, allowShadow }) => {
    try {
      const result = portPortableSkill(path, { name, overwrite, allowShadow });
      const validation = validatePortableSkillDirectory(result.name, result.path);
      clearRegistryCache();
      cacheClear();
      return {
        content: [{ type: "text", text: JSON.stringify({ ...result, valid: validation.valid, issues: validation.issues, warnings: validation.warnings }, null, 2) }],
        isError: !validation.valid,
      };
    } catch (err) {
      return mcpError("PORT_FAILED", (err as Error).message);
    }
  });

  server.registerTool("pin_skill", {
    title: "Pin Skill",
    description: "Pin a skill to .skills/project.json. Agent skill-folder installs are disabled; use skills mcp --register.",
    inputSchema: {
      name: z.string(),
      for: z.string().optional(),
      scope: z.string().optional(),
    },
  }, async ({ name, for: agentArg, scope }) => {
    if (agentArg) {
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(agentArg);
      } catch (err) {
        return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
      }

      const results = agents.map(a => ({
        skill: name,
        success: false,
        agent: a,
        scope: (scope as "global" | "project") || "global",
        error: `Direct agent skill-folder installs are disabled. Register Skills MCP instead: skills mcp --register ${a}`,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        isError: results.some(r => !r.success),
      };
    }

    const result = installSkill(name);
    if (result.success) cacheClear();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  });

  server.registerTool("pin_category", {
    title: "Pin Category",
    description: "Pin all skills in a category. Agent skill-folder installs are disabled.",
    inputSchema: {
      category: z.string(),
      for: z.string().optional(),
      scope: z.string().optional(),
    },
  }, async ({ category, for: agentArg, scope }) => {
    // Validate category
    const matchedCategory = CATEGORIES.find(
      (c) => c.toLowerCase() === category.toLowerCase()
    );
    if (!matchedCategory) {
      return {
        ...mcpError("UNKNOWN_CATEGORY", `Unknown category: ${category}`, CATEGORIES.slice()),
      };
    }

    const categorySkills = getSkillsByCategory(matchedCategory as Category);
    const names = categorySkills.map((s) => s.name);

    if (agentArg) {
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(agentArg);
      } catch (err) {
        return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
      }

      const results = [];
      for (const name of names) {
        for (const a of agents) {
          const r = {
            skill: name,
            success: false,
            error: `Direct agent skill-folder installs are disabled. Register Skills MCP instead: skills mcp --register ${a}`,
          };
          results.push({ ...r, agent: a, scope: scope || "global" });
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ category: matchedCategory, count: names.length, results }, null, 2) }],
        isError: results.some(r => !r.success),
      };
    }

    const results = names.map(name => installSkill(name));
    return {
      content: [{ type: "text", text: JSON.stringify({ category: matchedCategory, count: names.length, results }, null, 2) }],
      isError: results.some(r => !r.success),
    };
  });

  server.registerTool("unpin_skill", {
    title: "Unpin Skill",
    description: "Unpin a skill from .skills/project.json. Agent skill folders are unmanaged.",
    inputSchema: {
      name: z.string(),
      for: z.string().optional(),
      scope: z.string().optional(),
    },
  }, async ({ name, for: agentArg, scope }) => {
    if (agentArg) {
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(agentArg);
      } catch (err) {
        return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
      }

      const results = agents.map(a => ({
        skill: name,
        agent: a,
        removed: false,
        error: `Agent skill folders are unmanaged. Register Skills MCP instead: skills mcp --register ${a}`,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    const removed = removeSkill(name);
    if (removed) cacheClear();
    return {
      content: [{ type: "text", text: JSON.stringify({ skill: name, removed }, null, 2) }],
    };
  });

  server.registerTool("list_categories", {
    title: "List Categories",
    description: "List all 17 skill categories with skill counts.",
  }, async () => {
    const cats = CATEGORIES.map(category => ({
      name: category,
      count: getSkillsByCategory(category).length,
    }));
    return { content: [{ type: "text", text: JSON.stringify(cats, null, 2) }] };
  });

  server.registerTool("list_tags", {
    title: "List Tags",
    description: "List all unique skill tags with occurrence counts.",
  }, async () => {
    const tagCounts = new Map<string, number>();
    for (const skill of loadRegistry()) {
      for (const tag of skill.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const sorted = Array.from(tagCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
    return { content: [{ type: "text", text: JSON.stringify(sorted, null, 2) }] };
  });

  server.registerTool("get_requirements", {
    title: "Get Requirements",
    description: "Get env vars, system deps, and npm dependencies for a skill.",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }) => {
    const reqs = getSkillRequirements(name);
    if (!reqs) {
      return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
    }
    return { content: [{ type: "text", text: JSON.stringify(reqs, null, 2) }] };
  });

  server.registerTool("quote_skill", {
    title: "Quote Skill",
    description: "Quote a skill run in credits before approval.",
    inputSchema: {
      name: z.string(),
      input: z.record(z.string(), z.unknown()).optional(),
      args: z.array(z.string()).optional(),
    },
  }, async ({ name, input, args }) => {
    const skill = getSkill(name);
    if (!skill) {
      return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
    }

    const { ARTICLE_GENERATION_SLUG, getSkillCreditQuote, validateBlogArticleRunOptions } = await import("../lib/pricing.js");
    const runInput = input || {};
    const runArgs = args || [];
    if (skill.name === ARTICLE_GENERATION_SLUG) {
      const validation = validateBlogArticleRunOptions(runInput, runArgs);
      if (!validation.ok) {
        return mcpError("INVALID_BLOG_ARTICLE_OPTIONS", validation.errors.join(" "));
      }
    }

    const mode = resolveCurrentDeploymentMode();
    let creditQuote = getSkillCreditQuote(skill.name, runInput, runArgs);
    let quoteToken: string | undefined;
    let quoteExpiresAt: string | undefined;
    let availability: { status: "available" | "unavailable"; code?: string; message?: string; details?: string[] } = { status: "available" };
    if (mode === "local" && creditQuote.tier === "premium") {
      return mcpError("REMOTE_MODE_REQUIRED", `${skill.name} requires cloud or self-hosted mode.`, ["skills setup --mode cloud"]);
    }
    if (mode === "cloud") {
      try {
        const remoteSkill = await loadRemoteSkill(skill.name);
        if (remoteSkill.creditQuote) creditQuote = remoteSkill.creditQuote;
        availability = remoteSkill.availability ?? {
          status: "unavailable",
          code: "REMOTE_AVAILABILITY_MISSING",
          message: "The cloud service did not publish run availability for this skill.",
        };
        const { getApiKey } = await import("../lib/auth-store.js");
        const apiKey = getApiKey();
        if (apiKey && availability.status === "available") {
          const { RemoteSkillsClient } = await import("../lib/remote-client.js");
          const liveQuote = await new RemoteSkillsClient(apiKey).quoteSkill(skill.name, runInput, runArgs);
          if (liveQuote?.error || liveQuote?.availability?.status === "unavailable") {
            availability = {
              status: "unavailable",
              code: String(liveQuote?.availability?.code || liveQuote?.code || "CLOUD_QUOTE_UNAVAILABLE"),
              message: String(liveQuote?.availability?.message || liveQuote?.detail || liveQuote?.error || "Cloud execution is unavailable"),
              details: Array.isArray(liveQuote?.availability?.details)
                ? liveQuote.availability.details.map(String)
                : ["No credits were charged."],
            };
          } else if (liveQuote?.creditQuote) {
            creditQuote = toPublicCreditQuote(liveQuote.creditQuote);
          } else {
            return mcpError("CLOUD_QUOTE_INVALID", "The selected cloud service did not return a creditQuote. No credits were charged.");
          }
          quoteToken = typeof liveQuote?.quoteToken === "string" ? liveQuote.quoteToken : undefined;
          quoteExpiresAt = typeof liveQuote?.expiresAt === "string" ? liveQuote.expiresAt : undefined;
        } else if (!apiKey && availability.status === "available" && creditQuote.credits > 0) {
          return mcpError("AUTH_REQUIRED", `An authenticated signed quote is required for ${skill.name}.`, ["skills auth login"]);
        }
      } catch (error) {
        return mcpError("CLOUD_CAPABILITY_CHECK_FAILED", `Unable to verify cloud availability: ${(error as Error).message}`);
      }
    } else if (mode === "self-hosted") {
      const { getApiKey } = await import("../lib/auth-store.js");
      const apiKey = getApiKey();
      if (apiKey) {
        try {
          const { RemoteSkillsClient } = await import("../lib/remote-client.js");
          const liveQuote = await new RemoteSkillsClient(apiKey).quoteSkill(skill.name, runInput, runArgs);
          if (liveQuote?.error || liveQuote?.availability?.status === "unavailable") {
            availability = {
              status: "unavailable",
              code: String(liveQuote?.availability?.code || liveQuote?.code || "SELF_HOSTED_QUOTE_UNAVAILABLE"),
              message: String(liveQuote?.availability?.message || liveQuote?.detail || liveQuote?.error || "Self-hosted execution is unavailable"),
              details: Array.isArray(liveQuote?.availability?.details)
                ? liveQuote.availability.details.map(String)
                : ["No credits were charged."],
            };
          } else if (liveQuote?.creditQuote) {
            creditQuote = toPublicCreditQuote(liveQuote.creditQuote);
            quoteToken = typeof liveQuote?.quoteToken === "string" ? liveQuote.quoteToken : undefined;
            quoteExpiresAt = typeof liveQuote?.expiresAt === "string" ? liveQuote.expiresAt : undefined;
          } else {
            return mcpError("SELF_HOSTED_QUOTE_INVALID", "The selected self-hosted service did not return a creditQuote. No credits were charged.");
          }
        } catch (error) {
          return mcpError("SELF_HOSTED_QUOTE_FAILED", `Unable to obtain the selected self-hosted credit quote: ${(error as Error).message}`);
        }
      } else {
        return mcpError("AUTH_REQUIRED", `An authenticated quote from the selected self-hosted service is required for ${skill.name}.`, ["skills auth login"]);
      }
    }
    if (availability.status === "unavailable") {
      return {
        ...mcpJson(toCustomerCreditPayload({
          skill: skill.name,
          creditQuote,
          error: availability.message || "remote execution is unavailable",
          code: availability.code || "REMOTE_UNAVAILABLE",
          details: availability.details || ["No credits were charged."],
          availability: {
            status: "unavailable",
            code: availability.code || "REMOTE_UNAVAILABLE",
            message: availability.message || "remote execution is unavailable",
            details: availability.details || ["No credits were charged."],
          },
        })),
        isError: true,
      };
    }

    return mcpJson({
      skill: skill.name,
      creditQuote,
      availability: { status: "available" },
      ...(quoteToken ? { quoteToken } : {}),
      ...(quoteExpiresAt ? { expiresAt: quoteExpiresAt } : {}),
    });
  });

  server.registerTool("run_skill", {
    title: "Run Skill",
    description: "Run a skill by name with optional arguments.",
    inputSchema: {
      name: z.string(),
      input: z.record(z.string(), z.unknown()).optional(),
      args: z.array(z.string()).optional(),
      approved: z.boolean().optional(),
      quoteToken: z.string().optional(),
      detail: z.boolean().optional(),
    },
  }, async ({ name, input, args, approved, quoteToken, detail }) => {
    const skill = getSkill(name);
    if (!skill) {
      return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
    }

    const { getApiKey } = await import("../lib/auth-store.js");
    const {
      ARTICLE_GENERATION_SLUG,
      isPremiumSkill,
      getSkillCreditQuote,
      validateBlogArticleRunOptions,
    } = await import("../lib/pricing.js");
    const skillName = skill.name;
    const runInput = input || {};
    const runArgs = args || [];
    if (skillName === ARTICLE_GENERATION_SLUG) {
      const validation = validateBlogArticleRunOptions(runInput, runArgs, { requireTopic: true });
      if (!validation.ok) {
        return mcpError("INVALID_BLOG_ARTICLE_OPTIONS", validation.errors.join(" "));
      }
    }

    const apiKey = getApiKey();
    const mode = resolveCurrentDeploymentMode();
    let creditQuote = getSkillCreditQuote(skillName, runInput, runArgs);
    let credits = isPremiumSkill(skillName) ? creditQuote.credits : undefined;

    if (isPremiumSkill(skillName) && mode === "local") {
      return mcpError("REMOTE_MODE_REQUIRED", `${skillName} requires cloud or self-hosted mode.`, ["skills setup --mode cloud"]);
    }

    const runContext = createSkillRun({
      skill: skillName,
      args: runArgs,
      remote: isPremiumSkill(skillName),
      credits,
    });

    if (isPremiumSkill(skillName)) {
      let availability: { status: "available" | "unavailable"; code?: string; message?: string; details?: string[] } = { status: "available" };
      if (mode === "cloud") {
        try {
          const remoteSkill = await loadRemoteSkill(skillName);
          if (remoteSkill.creditQuote) {
            creditQuote = remoteSkill.creditQuote;
            credits = creditQuote.credits;
          }
          availability = remoteSkill.availability ?? {
            status: "unavailable",
            code: "REMOTE_AVAILABILITY_MISSING",
            message: "The cloud service did not publish run availability for this skill.",
          };
        } catch (error) {
          return mcpError("CLOUD_CAPABILITY_CHECK_FAILED", `Unable to verify cloud availability: ${(error as Error).message}`);
        }
      } else {
        if (!apiKey) {
          const hostedAvailability = getHostedRunAvailability(skillName);
          if (!hostedAvailability.ok) {
            availability = {
              status: "unavailable",
              code: hostedAvailability.code,
              message: hostedAvailability.message,
              details: hostedAvailability.details,
            };
          }
        }
      }
      if (availability.status === "unavailable") {
        const error = `${availability.code || "REMOTE_UNAVAILABLE"}: ${availability.message || "remote execution is unavailable"}`;
        writeRunLogs(runContext, "", `${error}\n${(availability.details || []).join("\n")}\n`);
        const run = completeSkillRun(runContext, { status: "failed", error, credits });
        return mcpError(
          availability.code || "REMOTE_UNAVAILABLE",
          `${availability.message || "remote execution is unavailable"}. ${(availability.details || ["No credits were charged."]).join(" ")} Local run metadata: ${run.paths.runDir}/run.json`,
        );
      }
    }

    if (isPremiumSkill(skillName) && !apiKey) {
      const error = `${skillName} is a remote skill (${creditQuote.formattedCredits}). Run: skills setup --mode ${mode === "cloud" ? "cloud" : "self-hosted"} && skills auth login`;
      writeRunLogs(runContext, "", error + "\n");
      const run = completeSkillRun(runContext, { status: "failed", error, credits });
      return mcpError("AUTH_REQUIRED", `${error}. Local run metadata: ${run.paths.runDir}/run.json`, ["skills auth login"]);
    }

    let remoteClient: import("../lib/remote-client.js").RemoteSkillsClient | undefined;
    let runQuoteToken = quoteToken;
    if (isPremiumSkill(skillName) && apiKey) {
      try {
        const { RemoteSkillsClient } = await import("../lib/remote-client.js");
        remoteClient = new RemoteSkillsClient(apiKey);
        if (mode === "cloud" && approved === true) {
          if (!runQuoteToken) {
            return mcpError(
              "CLOUD_QUOTE_TOKEN_REQUIRED",
              "The approved cloud run is missing the previously quoted token. Call quote_skill with the exact input and args, obtain user approval, then retry run_skill with that quoteToken.",
              ["quote_skill", "run_skill approved=true quoteToken=<approved token>"],
            );
          }
        } else {
          const liveQuote = await remoteClient.quoteSkill(skillName, runInput, runArgs);
          if (liveQuote?.error || liveQuote?.availability?.status === "unavailable") {
            const message = String(liveQuote?.availability?.message || liveQuote?.detail || liveQuote?.error || "Cloud execution is unavailable");
            return mcpError(String(liveQuote?.availability?.code || liveQuote?.code || "CLOUD_QUOTE_UNAVAILABLE"), `${message}. No credits were charged.`);
          }
          if (liveQuote?.creditQuote) {
            creditQuote = toPublicCreditQuote(liveQuote.creditQuote);
            credits = creditQuote.credits;
            if (mode === "self-hosted" && typeof liveQuote?.quoteToken === "string") {
              runQuoteToken = liveQuote.quoteToken;
            }
          } else {
            return mcpError("REMOTE_QUOTE_INVALID", "The selected remote service did not return a creditQuote. No credits were charged.");
          }
        }
      } catch (error) {
        return mcpError(
          mode === "cloud" ? "CLOUD_QUOTE_FAILED" : "SELF_HOSTED_QUOTE_FAILED",
          `Unable to obtain the selected ${mode} credit quote: ${(error as Error).message}`,
        );
      }
    }

    if (isPremiumSkill(skillName) && apiKey && creditQuote.credits > 0 && approved !== true) {
      const error = `${skillName} requires ${creditQuote.formattedCredits}. Call quote_skill first, then call run_skill with approved: true after user approval.`;
      writeRunLogs(runContext, "", error + "\n");
      const run = completeSkillRun(runContext, { status: "failed", error, credits });
      return mcpError("APPROVAL_REQUIRED", `${error}. Local run metadata: ${run.paths.runDir}/run.json`, [
        "quote_skill",
        "run_skill approved=true",
      ]);
    }

    if (isPremiumSkill(skillName) && apiKey) {
      try {
        const { RemoteSkillsClient } = await import("../lib/remote-client.js");
        const client = remoteClient ?? new RemoteSkillsClient(apiKey);
        const run = await client.submitRun(
          skillName,
          runInput,
          runArgs,
          mode === "cloud" || runQuoteToken ? { quoteToken: runQuoteToken, approved: true } : {},
        );
        if (run.error) {
          writeRunLogs(runContext, "", String(run.error) + "\n");
          const localRun = completeSkillRun(runContext, { status: "failed", error: String(run.error) });
          return mcpError("RUN_FAILED", `${run.error}. Local run metadata: ${localRun.paths.runDir}/run.json`);
        }
        const localRun = updateSkillRun(runContext, {
          status: run.status === "running" || run.status === "completed" || run.status === "failed" ? run.status : "queued",
          remoteRunId: typeof run.id === "string" ? run.id : undefined,
        });
        writeRunLogs(runContext, "", "");
        const remoteRunId = typeof run.id === "string" ? run.id : undefined;
        const payload = {
          contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
          id: run.id,
          localRunId: localRun.id,
          skill: skillName,
          status: run.status,
          correlationId: run.correlationId,
          remote: true,
          creditQuote,
          remoteRun: run,
          run: localRun,
          nextActions: remoteRunNextActions(remoteRunId),
        };
        return mcpJson(toCustomerCreditPayload(detail ? payload : compactRunToolPayload(payload, "Call run_skill again with detail:true for full remote/local run records.")));
      } catch (err) {
        const error = `Remote skill ${skillName} requires access to the selected ${mode} service: ${(err as Error).message}`;
        writeRunLogs(runContext, "", error + "\n");
        const localRun = completeSkillRun(runContext, { status: "failed", error });
        return mcpError("PLATFORM_ERROR", `${error}. Local run metadata: ${localRun.paths.runDir}/run.json`);
      }
    }

    const result = await runSkill(skillName, runArgs, {
      stdio: "pipe",
      env: {
        SKILLS_RUN_ID: runContext.record.id,
        SKILLS_RUN_DIR: runContext.runDir,
        SKILLS_EXPORT_DIR: runContext.exportDir,
      },
    });
    writeRunLogs(runContext, result.stdout ?? "", result.stderr ?? result.error ?? "");
    const localRun = completeSkillRun(runContext, {
      status: result.exitCode === 0 ? "completed" : "failed",
      error: result.error,
    });
    const payload = { exitCode: result.exitCode, skill: skillName, stdout: result.stdout, stderr: result.stderr, run: localRun };
    if (result.error) {
      return {
        content: [{ type: "text", text: JSON.stringify(toCustomerCreditPayload(detail ? { ...payload, error: result.error } : compactRunToolPayload({ ...payload, error: result.error }, "Call run_skill again with detail:true for full stdout/stderr and run metadata."))) }],
        isError: true,
      };
    }
    return mcpJson(toCustomerCreditPayload(detail ? payload : compactRunToolPayload(payload, "Call run_skill again with detail:true for full stdout/stderr and run metadata.")));
  });

  server.registerTool("get_run_status", {
    title: "Get Run Status",
    description: "Fetch remote run status. Accepts a remote run id or a local run id linked to a remote run.",
    inputSchema: {
      run_id: z.string(),
      detail: z.boolean().optional(),
    },
  }, async ({ run_id, detail }) => {
    const { getApiKey } = await import("../lib/auth-store.js");
    const apiKey = getApiKey();
    if (!apiKey) {
      return mcpError("AUTH_REQUIRED", "Remote run status requires self-hosted API access. Run: skills auth login", ["skills auth login"]);
    }

    const localRun = findSkillRun(run_id);
    const remoteRunId = localRun?.remoteRunId || run_id;
    if (localRun && !localRun.remoteRunId) {
      return mcpError("LOCAL_RUN", `Run '${run_id}' is local and has no remote run id`);
    }

    try {
      const { RemoteSkillsClient } = await import("../lib/remote-client.js");
      const client = new RemoteSkillsClient(apiKey);
      const run = await client.getRun(remoteRunId);
      if (!run) return mcpError("RUN_NOT_FOUND", `Remote run '${remoteRunId}' not found`);
      const payload = {
        contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
        runId: remoteRunId,
        ...(localRun ? { localRunId: localRun.id } : {}),
        run,
        nextActions: remoteRunNextActions(remoteRunId),
      };
      return mcpJson(toCustomerCreditPayload(detail ? payload : {
        contractVersion: payload.contractVersion,
        runId: payload.runId,
        ...(localRun ? { localRunId: localRun.id } : {}),
        run: compactRemoteRun(run),
        nextActions: payload.nextActions,
        detailHint: "Call get_run_status with detail:true for the complete remote run payload.",
      }));
    } catch (err) {
      return mcpError("SKILLS_MD_ERROR", (err as Error).message);
    }
  });

  server.registerTool("export_skills", {
    title: "Export Pinned Skills",
    description: "Export pinned skills as a JSON payload for import elsewhere.",
  }, async () => {
    const skills = getInstalledSkills();
    const payload = {
      version: 1,
      skills,
      timestamp: new Date().toISOString(),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  });

  server.registerTool("import_skills", {
    title: "Import Pinned Skills",
    description: "Pin skills from an export payload. Supports MCP setup guidance via 'for'.",
    inputSchema: {
      skills: z.array(z.string()),
      for: z.string().optional(),
      scope: z.string().optional(),
    },
  }, async ({ skills: skillList, for: agentArg, scope }) => {
    if (!skillList || skillList.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ imported: 0, results: [] }, null, 2) }] };
    }

    const results: Array<{ skill: string; success: boolean; error?: string }> = [];

    if (agentArg) {
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(agentArg);
      } catch (err) {
        return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
      }

      for (const name of skillList) {
        results.push({
          skill: name,
          success: false,
          error: `Direct agent skill-folder installs are disabled. Register Skills MCP instead: skills mcp --register ${agents.join(",")}`,
        });
      }
    } else {
      for (const name of skillList) {
        const result = installSkill(name);
        results.push({ skill: result.skill, success: result.success, ...(result.error ? { error: result.error } : {}) });
      }
    }

    const imported = results.filter((r) => r.success).length;
    const hasErrors = results.some((r) => !r.success);

    return {
      content: [{ type: "text", text: JSON.stringify({ imported, total: skillList.length, results }, null, 2) }],
      isError: hasErrors,
    };
  });

  server.registerTool("whoami", {
    title: "Skills Whoami",
    description: "Show setup summary: version, pinned skills, agent configs, cwd.",
  }, async () => {
    const version = pkg.version;
    const cwd = process.cwd();

    const installed = getInstalledSkills();

    const agents: Array<{ agent: string; label: string; path: string; exists: boolean; skillCount: number }> = [];
    for (const agent of AGENT_TARGETS) {
      const agentSkillsPath = getAgentSkillsDir(agent, "global");
      const exists = existsSync(agentSkillsPath);
      let skillCount = 0;
      if (exists) {
        try {
          skillCount = readdirSync(agentSkillsPath).filter((f) => {
            const full = join(agentSkillsPath, f);
            return !f.startsWith(".") && statSync(full).isDirectory();
          }).length;
        } catch {}
      }
      agents.push({ agent, label: AGENT_LABELS[agent], path: agentSkillsPath, exists, skillCount });
    }

    const skillsDir = getSkillPath("image").replace(/[/\\][^/\\]*$/, "");

    const result = {
      version,
      installedCount: installed.length,
      installed,
      agents,
      skillsDir,
      cwd,
    };

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

}

function compactRunToolPayload(payload: Record<string, any>, detailHint: string): Record<string, unknown> {
  const stdout = previewText(payload.stdout ?? "");
  const stderr = previewText(payload.stderr ?? "");
  return {
    ...(payload.contractVersion !== undefined ? { contractVersion: payload.contractVersion } : {}),
    ...(payload.id !== undefined ? { id: payload.id } : {}),
    ...(payload.localRunId !== undefined ? { localRunId: payload.localRunId } : {}),
    ...(payload.exitCode !== undefined ? { exitCode: payload.exitCode } : {}),
    skill: payload.skill,
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.remote !== undefined ? { remote: payload.remote } : {}),
    ...(payload.correlationId !== undefined ? { correlationId: payload.correlationId } : {}),
    ...(payload.creditQuote !== undefined ? { creditQuote: payload.creditQuote } : {}),
    ...(payload.error !== undefined ? { error: payload.error } : {}),
    ...(payload.remoteRun !== undefined ? { remoteRun: compactRemoteRun(payload.remoteRun) } : {}),
    run: compactRunRecord(payload.run),
    stdoutPreview: stdout,
    stderrPreview: stderr,
    stdoutChars: stdout.length,
    stderrChars: stderr.length,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    ...(payload.nextActions !== undefined ? { nextActions: payload.nextActions } : {}),
    detailHint,
  };
}
