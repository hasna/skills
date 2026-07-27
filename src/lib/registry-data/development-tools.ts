import type { SkillMeta } from "../registry-types.js";

export const DEVELOPMENT_TOOLS_SKILLS: SkillMeta[] = [
  {
    name: "repo-onboarding-report",
    displayName: "Repo Onboarding Report",
    description: "Generate repository onboarding packages with architecture maps, setup guides, risk registers, and first-week plans",
    category: "Development Tools",
    kind: "instruction",
    tags: ["repository", "onboarding", "architecture", "developer-tools"],
  },
  {
    name: "security-audit-report",
    displayName: "Security Audit Report",
    description: "Generate application security hardening reports covering auth, secrets, headers, webhooks, RLS, permissions, dependencies, and prioritized fixes",
    category: "Development Tools",
    kind: "instruction",
    tags: ["security", "audit", "hardening", "rls", "webhooks"],
  },
  {
    name: "performance-audit-report",
    displayName: "Performance Audit Report",
    description: "Generate performance audit reports with metrics, findings, budgets, remediation plans, and manifest artifacts",
    category: "Development Tools",
    kind: "instruction",
    tags: ["performance", "audit", "latency", "budget", "web"],
  },
  {
    name: "migration-plan-pack",
    displayName: "Migration Plan Pack",
    description: "Generate migration plans for frameworks, libraries, databases, infrastructure, and architecture upgrades with risk matrix, checklist, rollout, and test strategy artifacts",
    category: "Development Tools",
    kind: "instruction",
    tags: ["migration", "upgrade", "planning", "frameworks", "databases"],
  },
  {
    name: "test-suite-generator",
    displayName: "Test Suite Generator",
    description: "Generate runnable API, unit, and browser test suite packages with coverage notes",
    category: "Development Tools",
    kind: "instruction",
    tags: ["testing", "qa", "api-tests", "browser-tests", "coverage"],
  },
];
