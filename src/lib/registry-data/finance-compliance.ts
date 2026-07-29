import type { SkillMeta } from "../registry-types.js";

export const FINANCE_COMPLIANCE_SKILLS: SkillMeta[] = [
  {
    name: "contract-review-report",
    displayName: "Contract Review Report",
    description: "Generate contract review reports with risk register, clause summary, redline suggestions, negotiation email, and manifest artifacts",
    category: "Finance & Compliance",
    kind: "instruction",
    tags: ["contract", "legal", "review", "risk"],
  },
  {
    name: "invoice",
    displayName: "Invoice",
    description: "Generate professional invoices with company management and PDF export",
    category: "Finance & Compliance",
    tags: ["invoice", "billing", "pdf", "finance"],
  },
  {
    name: "invoice-reconciliation",
    displayName: "Invoice Reconciliation",
    description: "Generate invoice reconciliation reports with matched payments, discrepancies, anomaly notes, summaries, and manifest artifacts",
    category: "Finance & Compliance",
    tags: ["invoice", "payments", "reconciliation", "finance"],
  },
];
