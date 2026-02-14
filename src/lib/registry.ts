/**
 * Skill registry - metadata about all available skills
 */

export interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
}

export const CATEGORIES = [
  "Development Tools",
  "Business & Marketing",
  "Productivity & Organization",
  "Project Management",
  "Content Generation",
  "Finance & Compliance",
  "Data & Analysis",
  "Media Processing",
  "Design & Branding",
  "Web & Browser",
  "Research & Writing",
  "Science & Academic",
  "Education & Learning",
  "Communication",
  "Health & Wellness",
  "Travel & Lifestyle",
  "Event Management",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SKILLS: SkillMeta[] = [
  // Development Tools
  {
    name: "api-test-suite",
    displayName: "API Test Suite",
    description: "Generate and run API test suites with comprehensive endpoint coverage",
    category: "Development Tools",
    tags: ["api", "testing", "automation", "qa"],
  },
  {
    name: "apidocs",
    displayName: "API Docs",
    description: "Agentic web crawler for API documentation indexing and semantic search",
    category: "Development Tools",
    tags: ["api", "documentation", "search", "indexing"],
  },
  {
    name: "codefix",
    displayName: "Code Fix",
    description: "Code quality CLI for auto-linting, formatting, fixing, and style enforcement",
    category: "Development Tools",
    tags: ["code", "linting", "formatting", "quality"],
  },
  {
    name: "consolelog",
    displayName: "Console Log",
    description: "Monitor console logs from web applications using Playwright headless browser",
    category: "Development Tools",
    tags: ["console", "monitoring", "debugging", "logs"],
  },
  {
    name: "database-explorer",
    displayName: "Database Explorer",
    description: "Explore and query databases with an interactive interface",
    category: "Development Tools",
    tags: ["database", "explorer", "sql", "query"],
  },
  {
    name: "deploy",
    displayName: "Deploy",
    description: "Deployment CLI for managing EC2 deployments with automated health checks",
    category: "Development Tools",
    tags: ["deployment", "ec2", "aws", "ci-cd"],
  },
  {
    name: "diff-viewer",
    displayName: "Diff Viewer",
    description: "View and analyze file differences with visual diff representation",
    category: "Development Tools",
    tags: ["diff", "comparison", "files", "code-review"],
  },
  {
    name: "e2bswarm",
    displayName: "E2B Swarm",
    description: "Spawn E2B sandbox instances for parallel Claude Code task execution",
    category: "Development Tools",
    tags: ["e2b", "sandbox", "parallel", "execution"],
  },
  {
    name: "generate-api-client",
    displayName: "Generate API Client",
    description: "Generate API client libraries from OpenAPI specs and documentation",
    category: "Development Tools",
    tags: ["api", "client", "code-generation", "openapi"],
  },
  {
    name: "generate-dockerfile",
    displayName: "Generate Dockerfile",
    description: "Generate optimized Dockerfiles for containerized applications",
    category: "Development Tools",
    tags: ["docker", "dockerfile", "containers", "devops"],
  },
  {
    name: "generate-documentation",
    displayName: "Generate Documentation",
    description: "Generate project documentation including READMEs, architecture docs, and API references from codebase analysis",
    category: "Development Tools",
    tags: ["documentation", "generation", "code", "docs"],
  },
  {
    name: "generate-env",
    displayName: "Generate Env",
    description: "Generate environment variable files from templates and configurations",
    category: "Development Tools",
    tags: ["env", "environment", "configuration", "dotenv"],
  },
  {
    name: "generate-mock-data",
    displayName: "Generate Mock Data",
    description: "Generate realistic mock data for testing and development",
    category: "Development Tools",
    tags: ["mock-data", "testing", "generation", "fake-data"],
  },
  {
    name: "generate-pr-description",
    displayName: "Generate PR Description",
    description: "Generate pull request descriptions from code diffs and commit history",
    category: "Development Tools",
    tags: ["pr", "github", "description", "code-review"],
  },
  {
    name: "generate-regex",
    displayName: "Generate Regex",
    description: "Generate regular expressions from natural language descriptions",
    category: "Development Tools",
    tags: ["regex", "generation", "pattern", "matching"],
  },
  {
    name: "generate-sitemap",
    displayName: "Generate Sitemap",
    description: "Generate XML sitemaps for websites and web applications",
    category: "Development Tools",
    tags: ["sitemap", "seo", "xml", "web"],
  },
  {
    name: "generate-sql",
    displayName: "Generate SQL",
    description: "Generate SQL queries and database schemas from natural language",
    category: "Development Tools",
    tags: ["sql", "database", "generation", "queries"],
  },
  {
    name: "github-manager",
    displayName: "GitHub Manager",
    description: "Manage GitHub repositories, issues, PRs, and workflows",
    category: "Development Tools",
    tags: ["github", "repository", "management", "issues"],
  },
  {
    name: "hook",
    displayName: "Hook",
    description: "Claude Code hook creation skill - generates standardized hook scaffolds",
    category: "Development Tools",
    tags: ["hooks", "scaffold", "claude-code", "automation"],
  },
  {
    name: "http-server",
    displayName: "HTTP Server",
    description: "Spin up local HTTP servers for development and testing",
    category: "Development Tools",
    tags: ["http", "server", "development", "local"],
  },
  {
    name: "lorem-generator",
    displayName: "Lorem Generator",
    description: "Generate placeholder text in various styles and lengths",
    category: "Development Tools",
    tags: ["lorem", "placeholder", "text", "mockup"],
  },
  {
    name: "managehook",
    displayName: "Manage Hook",
    description: "Manage Claude Code hooks with install, configure, and lifecycle operations",
    category: "Development Tools",
    tags: ["hooks", "management", "claude-code", "configuration"],
  },
  {
    name: "managemcp",
    displayName: "Manage MCP",
    description: "Manage MCP servers with install, configure, and lifecycle operations",
    category: "Development Tools",
    tags: ["mcp", "management", "servers", "configuration"],
  },
  {
    name: "manageskill",
    displayName: "Manage Skill",
    description: "Manage Claude Code skills with install, configure, and lifecycle operations",
    category: "Development Tools",
    tags: ["skills", "management", "claude-code", "configuration"],
  },
  {
    name: "markdown-validator",
    displayName: "Markdown Validator",
    description: "Validate markdown files for syntax, links, and formatting issues",
    category: "Development Tools",
    tags: ["markdown", "validation", "linting", "formatting"],
  },
  {
    name: "mcp-builder",
    displayName: "MCP Builder",
    description: "Build MCP server packages with standardized structure and tooling",
    category: "Development Tools",
    tags: ["mcp", "builder", "scaffold", "server"],
  },
  {
    name: "npmpublish",
    displayName: "NPM Publish",
    description: "Publish npm packages with sensible defaults: private access, patch version bumps",
    category: "Development Tools",
    tags: ["npm", "publish", "packages", "registry"],
  },
  {
    name: "regex-tester",
    displayName: "Regex Tester",
    description: "Test and validate regular expressions with sample inputs",
    category: "Development Tools",
    tags: ["regex", "testing", "validation", "patterns"],
  },
  {
    name: "scaffold-project",
    displayName: "Scaffold Project",
    description: "Scaffold new projects with standardized structure and boilerplate",
    category: "Development Tools",
    tags: ["scaffold", "project", "boilerplate", "template"],
  },
  {
    name: "security-audit",
    displayName: "Security Audit",
    description: "Perform security audits on codebases and infrastructure configurations",
    category: "Development Tools",
    tags: ["security", "audit", "vulnerabilities", "scanning"],
  },
  {
    name: "terraform-generator",
    displayName: "Terraform Generator",
    description: "Generate Terraform infrastructure-as-code configurations",
    category: "Development Tools",
    tags: ["terraform", "iac", "infrastructure", "devops"],
  },
  {
    name: "validate-config",
    displayName: "Validate Config",
    description: "Validate configuration files for syntax and schema compliance",
    category: "Development Tools",
    tags: ["config", "validation", "schema", "linting"],
  },

  // Business & Marketing
  {
    name: "ad-creative-generator",
    displayName: "Ad Creative Generator",
    description: "Generate ad creatives with copy, visuals, and layouts for marketing campaigns",
    category: "Business & Marketing",
    tags: ["ads", "creative", "marketing", "design"],
  },
  {
    name: "banner-ad-suite",
    displayName: "Banner Ad Suite",
    description: "Create banner ad sets in multiple sizes for display advertising campaigns",
    category: "Business & Marketing",
    tags: ["banner", "ads", "display", "marketing"],
  },
  {
    name: "campaign-metric-brief",
    displayName: "Campaign Metric Brief",
    description: "Generate campaign performance metric briefs and analytics summaries",
    category: "Business & Marketing",
    tags: ["campaign", "metrics", "analytics", "reporting"],
  },
  {
    name: "campaign-moodboard",
    displayName: "Campaign Moodboard",
    description: "Create visual moodboards for marketing and creative campaigns",
    category: "Business & Marketing",
    tags: ["campaign", "moodboard", "creative", "visual"],
  },
  {
    name: "caption-style-stylist",
    displayName: "Caption Style Stylist",
    description: "Style and format captions for social media and video content",
    category: "Business & Marketing",
    tags: ["captions", "social-media", "styling", "content"],
  },
  {
    name: "churn-risk-notifier",
    displayName: "Churn Risk Notifier",
    description: "Identify and notify about customer churn risk indicators",
    category: "Business & Marketing",
    tags: ["churn", "risk", "customer", "retention"],
  },
  {
    name: "competitor-ad-analyzer",
    displayName: "Competitor Ad Analyzer",
    description: "Analyze competitor advertising strategies, creatives, and messaging",
    category: "Business & Marketing",
    tags: ["competitor", "ads", "analysis", "marketing"],
  },
  {
    name: "crm-note-enhancer",
    displayName: "CRM Note Enhancer",
    description: "Enhance CRM notes with structured summaries and action items",
    category: "Business & Marketing",
    tags: ["crm", "notes", "sales", "enhancement"],
  },
  {
    name: "customer-journey-mapper",
    displayName: "Customer Journey Mapper",
    description: "Map and visualize customer journey touchpoints and experiences",
    category: "Business & Marketing",
    tags: ["customer-journey", "mapping", "ux", "marketing"],
  },
  {
    name: "email-campaign",
    displayName: "Email Campaign",
    description: "Design email marketing campaigns and newsletters with templates, sequences, and audience segmentation",
    category: "Business & Marketing",
    tags: ["email", "campaign", "marketing", "automation"],
  },
  {
    name: "feedback-survey-designer",
    displayName: "Feedback Survey Designer",
    description: "Design feedback surveys with optimized questions and response formats",
    category: "Business & Marketing",
    tags: ["survey", "feedback", "design", "questionnaire"],
  },
  {
    name: "generate-social-posts",
    displayName: "Generate Social Posts",
    description: "Generate social media posts optimized for different platforms",
    category: "Business & Marketing",
    tags: ["social-media", "posts", "marketing", "content"],
  },
  {
    name: "landing-page-copy",
    displayName: "Landing Page Copy",
    description: "Write conversion-optimized landing page copy with headlines and CTAs",
    category: "Business & Marketing",
    tags: ["landing-page", "copywriting", "conversion", "marketing"],
  },
  {
    name: "onboarding-sequence-builder",
    displayName: "Onboarding Sequence Builder",
    description: "Build employee or customer onboarding sequences with steps and milestones",
    category: "Business & Marketing",
    tags: ["onboarding", "sequence", "workflow", "automation"],
  },
  {
    name: "outreach-cadence-designer",
    displayName: "Outreach Cadence Designer",
    description: "Design multi-touch outreach cadences for sales and marketing campaigns",
    category: "Business & Marketing",
    tags: ["outreach", "cadence", "sales", "marketing"],
  },
  {
    name: "partner-kit-assembler",
    displayName: "Partner Kit Assembler",
    description: "Assemble partner kits with brand assets, guidelines, and marketing materials",
    category: "Business & Marketing",
    tags: ["partner", "kit", "branding", "marketing"],
  },
  {
    name: "persona-based-adwriter",
    displayName: "Persona-Based Ad Writer",
    description: "Write targeted ads based on customer persona profiles",
    category: "Business & Marketing",
    tags: ["persona", "ads", "targeting", "copywriting"],
  },
  {
    name: "persona-generator",
    displayName: "Persona Generator",
    description: "Generate detailed customer and user personas for marketing and UX",
    category: "Business & Marketing",
    tags: ["persona", "generation", "marketing", "ux"],
  },
  {
    name: "product-demo-script",
    displayName: "Product Demo Script",
    description: "Write product demo scripts with talking points and flow",
    category: "Business & Marketing",
    tags: ["demo", "script", "product", "presentation"],
  },
  {
    name: "sales-call-recapper",
    displayName: "Sales Call Recapper",
    description: "Recap sales calls with key points, objections, and follow-up actions",
    category: "Business & Marketing",
    tags: ["sales", "calls", "recap", "follow-up"],
  },
  {
    name: "salescopy",
    displayName: "Sales Copy",
    description: "Generate persuasive sales copy using AI for products and services",
    category: "Business & Marketing",
    tags: ["sales", "copywriting", "marketing", "persuasion"],
  },
  {
    name: "seo-brief-builder",
    displayName: "SEO Brief Builder",
    description: "Build SEO content briefs with keyword research and competitive analysis",
    category: "Business & Marketing",
    tags: ["seo", "brief", "content", "keywords"],
  },
  {
    name: "social-media-kit",
    displayName: "Social Media Kit",
    description: "Create social media kits with graphics, templates, and brand guidelines",
    category: "Business & Marketing",
    tags: ["social-media", "kit", "branding", "templates"],
  },
  {
    name: "sponsorship-proposal-lab",
    displayName: "Sponsorship Proposal Lab",
    description: "Create sponsorship proposals with packages, ROI projections, and benefits",
    category: "Business & Marketing",
    tags: ["sponsorship", "proposal", "marketing", "partnerships"],
  },
  {
    name: "webinar-script-coach",
    displayName: "Webinar Script Coach",
    description: "Coach and refine webinar scripts with engagement tips and flow optimization",
    category: "Business & Marketing",
    tags: ["webinar", "script", "coaching", "presentation"],
  },

  // Productivity & Organization
  {
    name: "convert",
    displayName: "Convert",
    description: "File format conversion and transformation CLI between images, PDFs, documents, CSV, and data formats",
    category: "Productivity & Organization",
    tags: ["conversion", "formats", "files", "transform"],
  },
  {
    name: "decision-journal",
    displayName: "Decision Journal",
    description: "Track and reflect on decisions with structured journaling",
    category: "Productivity & Organization",
    tags: ["decisions", "journal", "reflection", "tracking"],
  },
  {
    name: "file-organizer",
    displayName: "File Organizer",
    description: "Organize files into structured directories based on type, date, or content",
    category: "Productivity & Organization",
    tags: ["files", "organization", "sorting", "cleanup"],
  },
  {
    name: "folder-tree",
    displayName: "Folder Tree",
    description: "Generate and display folder tree structures for documentation",
    category: "Productivity & Organization",
    tags: ["folder", "tree", "structure", "visualization"],
  },
  {
    name: "form-filler",
    displayName: "Form Filler",
    description: "Automatically fill out web forms and document templates",
    category: "Productivity & Organization",
    tags: ["forms", "automation", "filling", "data-entry"],
  },
  {
    name: "inbox-priority-planner",
    displayName: "Inbox Priority Planner",
    description: "Prioritize and organize email inbox items by importance and urgency",
    category: "Productivity & Organization",
    tags: ["inbox", "priority", "email", "organization"],
  },
  {
    name: "meeting-insight-summarizer",
    displayName: "Meeting Insight Summarizer",
    description: "Summarize meetings with key insights, decisions, and action items",
    category: "Productivity & Organization",
    tags: ["meeting", "summary", "insights", "action-items"],
  },
  {
    name: "merge-pdfs",
    displayName: "Merge PDFs",
    description: "Merge multiple PDF files into a single document",
    category: "Productivity & Organization",
    tags: ["pdf", "merge", "documents", "combining"],
  },
  {
    name: "notion-manager",
    displayName: "Notion Manager",
    description: "Advanced Notion management with templates, automation, and bulk operations",
    category: "Productivity & Organization",
    tags: ["notion", "management", "automation", "templates"],
  },
  {
    name: "personal-daily-ops",
    displayName: "Personal Daily Ops",
    description: "Manage personal daily operations with routines, tasks, and priorities",
    category: "Productivity & Organization",
    tags: ["daily", "operations", "routines", "personal"],
  },
  {
    name: "split-pdf",
    displayName: "Split PDF",
    description: "Split PDF documents into separate pages or sections",
    category: "Productivity & Organization",
    tags: ["pdf", "split", "documents", "pages"],
  },

  // Project Management
  {
    name: "action-item-router",
    displayName: "Action Item Router",
    description: "Route and assign action items from meetings or documents to appropriate owners",
    category: "Project Management",
    tags: ["action-items", "routing", "delegation", "tasks"],
  },
  {
    name: "businessactivity",
    displayName: "Business Activity",
    description: "Business activity, workflow, and ownership management service",
    category: "Project Management",
    tags: ["business", "workflow", "activities", "management"],
  },
  {
    name: "delegation-brief-writer",
    displayName: "Delegation Brief Writer",
    description: "Write clear delegation briefs with context, expectations, and deadlines",
    category: "Project Management",
    tags: ["delegation", "briefs", "management", "tasks"],
  },
  {
    name: "goal-quarterly-roadmap",
    displayName: "Goal Quarterly Roadmap",
    description: "Create quarterly goal roadmaps with milestones and tracking",
    category: "Project Management",
    tags: ["goals", "roadmap", "quarterly", "planning"],
  },
  {
    name: "implementation",
    displayName: "Implementation",
    description: "Create .implementation scaffold for project development tracking",
    category: "Project Management",
    tags: ["implementation", "tracking", "scaffold", "project"],
  },
  {
    name: "implementation-agent",
    displayName: "Implementation Agent",
    description: "AI agent for managing implementation workflows and task execution",
    category: "Project Management",
    tags: ["implementation", "agent", "workflow", "execution"],
  },
  {
    name: "implementation-plan",
    displayName: "Implementation Plan",
    description: "Generate detailed implementation plans with phases and milestones",
    category: "Project Management",
    tags: ["implementation", "planning", "milestones", "phases"],
  },
  {
    name: "implementation-todo",
    displayName: "Implementation Todo",
    description: "Manage implementation task lists and todo items",
    category: "Project Management",
    tags: ["implementation", "todo", "tasks", "tracking"],
  },
  {
    name: "project-retro-companion",
    displayName: "Project Retro Companion",
    description: "Facilitate project retrospectives with structured reflection and action items",
    category: "Project Management",
    tags: ["retrospective", "project", "feedback", "improvement"],
  },

  // Content Generation
  {
    name: "audio",
    displayName: "Audio",
    description: "Generate audio, voiceovers, and speech using AI-powered TTS APIs (ElevenLabs, OpenAI)",
    category: "Content Generation",
    tags: ["audio", "tts", "speech", "ai"],
  },
  {
    name: "audiobook-chapter-proofer",
    displayName: "Audiobook Chapter Proofer",
    description: "Proofread and validate audiobook chapters for consistency and quality",
    category: "Content Generation",
    tags: ["audiobook", "proofreading", "quality", "publishing"],
  },
  {
    name: "emoji",
    displayName: "Emoji",
    description: "Generate complete emoji packs using AI with DALL-E 3 or Gemini",
    category: "Content Generation",
    tags: ["emoji", "generation", "ai", "design"],
  },
  {
    name: "generate-diagram",
    displayName: "Generate Diagram",
    description: "Generate diagrams including flowcharts, sequence diagrams, and system architecture",
    category: "Content Generation",
    tags: ["diagrams", "flowcharts", "visualization", "architecture"],
  },
  {
    name: "generate-docx",
    displayName: "Generate DOCX",
    description: "Generate DOCX documents with formatted content and styling",
    category: "Content Generation",
    tags: ["docx", "document", "word", "generation"],
  },
  {
    name: "generate-excel",
    displayName: "Generate Excel",
    description: "Generate Excel spreadsheets with formatted data, formulas, and charts",
    category: "Content Generation",
    tags: ["excel", "spreadsheet", "generation", "data"],
  },
  {
    name: "generate-pdf",
    displayName: "Generate PDF",
    description: "Generate PDF documents with rich formatting and layouts",
    category: "Content Generation",
    tags: ["pdf", "document", "generation", "formatting"],
  },
  {
    name: "generate-presentation",
    displayName: "Generate Presentation",
    description: "Generate presentation decks with slides, content, and visuals",
    category: "Content Generation",
    tags: ["presentation", "slides", "deck", "generation"],
  },
  {
    name: "generate-qrcode",
    displayName: "Generate QR Code",
    description: "Generate QR codes with custom styling and embedded data",
    category: "Content Generation",
    tags: ["qrcode", "generation", "encoding", "visual"],
  },
  {
    name: "generate-resume",
    displayName: "Generate Resume",
    description: "Generate professional resumes with formatting and content optimization",
    category: "Content Generation",
    tags: ["resume", "cv", "career", "generation"],
  },
  {
    name: "image",
    displayName: "Image",
    description: "Generate images using multiple AI providers: DALL-E 3, Imagen 3, and Aurora",
    category: "Content Generation",
    tags: ["image", "generation", "ai", "dalle"],
  },
  {
    name: "jingle-composer",
    displayName: "Jingle Composer",
    description: "Compose advertising jingles and short musical pieces for brands",
    category: "Content Generation",
    tags: ["jingle", "music", "composition", "advertising"],
  },
  {
    name: "video",
    displayName: "Video",
    description: "Generate videos using AI models from Google Veo, OpenAI Sora, and Runway",
    category: "Content Generation",
    tags: ["video", "generation", "ai", "sora"],
  },
  {
    name: "voiceover-casting-assistant",
    displayName: "Voiceover Casting Assistant",
    description: "Assist with voiceover casting by matching voice profiles to project needs",
    category: "Content Generation",
    tags: ["voiceover", "casting", "voice", "selection"],
  },

  // Finance & Compliance
  {
    name: "budget-variance-analyzer",
    displayName: "Budget Variance Analyzer",
    description: "Analyze budget versus actual spending with variance reporting",
    category: "Finance & Compliance",
    tags: ["budget", "variance", "analysis", "finance"],
  },
  {
    name: "compliance-copy-check",
    displayName: "Compliance Copy Check",
    description: "Check marketing copy for regulatory compliance and legal requirements",
    category: "Finance & Compliance",
    tags: ["compliance", "copy", "legal", "regulatory"],
  },
  {
    name: "compliance-report-pack",
    displayName: "Compliance Report Pack",
    description: "Generate compliance report packages for regulatory submissions",
    category: "Finance & Compliance",
    tags: ["compliance", "reporting", "regulatory", "audit"],
  },
  {
    name: "contract-plainlanguage",
    displayName: "Contract Plain Language",
    description: "Convert legal contracts into plain language summaries for easy understanding",
    category: "Finance & Compliance",
    tags: ["contract", "legal", "plain-language", "summary"],
  },
  {
    name: "extract-invoice",
    displayName: "Extract Invoice",
    description: "Extract structured data from invoice documents using AI",
    category: "Finance & Compliance",
    tags: ["invoice", "extraction", "ocr", "finance"],
  },
  {
    name: "forecast-scenario-lab",
    displayName: "Forecast Scenario Lab",
    description: "Model business forecast scenarios with multiple variable assumptions",
    category: "Finance & Compliance",
    tags: ["forecast", "scenarios", "modeling", "planning"],
  },
  {
    name: "grant-application-drafter",
    displayName: "Grant Application Drafter",
    description: "Draft grant applications with structured proposals and budgets",
    category: "Finance & Compliance",
    tags: ["grants", "application", "drafting", "funding"],
  },
  {
    name: "invoice",
    displayName: "Invoice",
    description: "Generate professional invoices with company management and PDF export",
    category: "Finance & Compliance",
    tags: ["invoice", "billing", "pdf", "finance"],
  },
  {
    name: "invoice-dispute-helper",
    displayName: "Invoice Dispute Helper",
    description: "Assist with invoice disputes by analyzing charges and generating responses",
    category: "Finance & Compliance",
    tags: ["invoice", "dispute", "resolution", "billing"],
  },
  {
    name: "payroll-change-prepper",
    displayName: "Payroll Change Prepper",
    description: "Prepare payroll change documentation and calculations",
    category: "Finance & Compliance",
    tags: ["payroll", "changes", "hr", "finance"],
  },
  {
    name: "procurement-scorecard",
    displayName: "Procurement Scorecard",
    description: "Generate procurement scorecards for vendor evaluation and comparison",
    category: "Finance & Compliance",
    tags: ["procurement", "scorecard", "vendor", "evaluation"],
  },
  {
    name: "proposal-redline-advisor",
    displayName: "Proposal Redline Advisor",
    description: "Review and redline proposals with suggested edits and negotiations",
    category: "Finance & Compliance",
    tags: ["proposal", "redline", "review", "negotiation"],
  },
  {
    name: "risk-disclosure-kit",
    displayName: "Risk Disclosure Kit",
    description: "Generate risk disclosure documents and compliance statements",
    category: "Finance & Compliance",
    tags: ["risk", "disclosure", "compliance", "legal"],
  },
  {
    name: "roi-comparison-tool",
    displayName: "ROI Comparison Tool",
    description: "Compare return on investment across different options and scenarios",
    category: "Finance & Compliance",
    tags: ["roi", "comparison", "investment", "analysis"],
  },
  {
    name: "subscription-spend-watcher",
    displayName: "Subscription Spend Watcher",
    description: "Track and analyze subscription spending with alerts and optimization tips",
    category: "Finance & Compliance",
    tags: ["subscription", "spending", "tracking", "optimization"],
  },
  {
    name: "timesheet",
    displayName: "Timesheet",
    description: "Generate employee timesheets with multi-profile support",
    category: "Finance & Compliance",
    tags: ["timesheet", "hours", "tracking", "payroll"],
  },

  // Data & Analysis
  {
    name: "analyze-data",
    displayName: "Analyze Data",
    description: "Data science insights for CSV and JSON datasets with statistical analysis",
    category: "Data & Analysis",
    tags: ["data", "analysis", "csv", "json", "statistics"],
  },
  {
    name: "anomaly-investigator",
    displayName: "Anomaly Investigator",
    description: "Investigate and diagnose anomalies in data, logs, and system metrics",
    category: "Data & Analysis",
    tags: ["anomaly", "investigation", "monitoring", "diagnostics"],
  },
  {
    name: "benchmark-finder",
    displayName: "Benchmark Finder",
    description: "Find industry benchmarks and performance metrics for comparison analysis",
    category: "Data & Analysis",
    tags: ["benchmark", "metrics", "industry", "comparison"],
  },
  {
    name: "dashboard-builder",
    displayName: "Dashboard Builder",
    description: "Build data dashboards with charts, metrics, and visualizations",
    category: "Data & Analysis",
    tags: ["dashboard", "visualization", "charts", "metrics"],
  },
  {
    name: "dashboard-narrator",
    displayName: "Dashboard Narrator",
    description: "Generate narrative summaries from dashboard data and metrics",
    category: "Data & Analysis",
    tags: ["dashboard", "narrative", "reporting", "insights"],
  },
  {
    name: "data-anonymizer",
    displayName: "Data Anonymizer",
    description: "Anonymize sensitive data in datasets for privacy compliance",
    category: "Data & Analysis",
    tags: ["anonymization", "privacy", "data", "compliance"],
  },
  {
    name: "dataset-health-check",
    displayName: "Dataset Health Check",
    description: "Validate dataset quality with completeness, consistency, and accuracy checks",
    category: "Data & Analysis",
    tags: ["dataset", "quality", "validation", "health-check"],
  },
  {
    name: "extract",
    displayName: "Extract",
    description: "Extract text and structured data from images, PDFs, and documents using AI",
    category: "Data & Analysis",
    tags: ["extraction", "ocr", "vision", "pdf"],
  },
  {
    name: "generate-chart",
    displayName: "Generate Chart",
    description: "Generate data charts and visualizations from datasets",
    category: "Data & Analysis",
    tags: ["charts", "visualization", "data", "graphs"],
  },
  {
    name: "kpi-digest-generator",
    displayName: "KPI Digest Generator",
    description: "Generate KPI digest reports with trends, alerts, and performance summaries",
    category: "Data & Analysis",
    tags: ["kpi", "digest", "metrics", "reporting"],
  },
  {
    name: "spreadsheet-cleanroom",
    displayName: "Spreadsheet Cleanroom",
    description: "Clean and sanitize spreadsheet data for analysis readiness",
    category: "Data & Analysis",
    tags: ["spreadsheet", "cleaning", "data", "sanitization"],
  },
  {
    name: "survey-insight-extractor",
    displayName: "Survey Insight Extractor",
    description: "Extract actionable insights and trends from survey response data",
    category: "Data & Analysis",
    tags: ["survey", "insights", "analysis", "data"],
  },

  // Media Processing
  {
    name: "audio-cleanup-lab",
    displayName: "Audio Cleanup Lab",
    description: "Professional audio cleanup recipes with structured workflows for processing audio files",
    category: "Media Processing",
    tags: ["audio", "cleanup", "processing", "restoration"],
  },
  {
    name: "compress-video",
    displayName: "Compress Video",
    description: "Compress video files while preserving visual quality using ffmpeg",
    category: "Media Processing",
    tags: ["video", "compression", "ffmpeg", "optimization"],
  },
  {
    name: "extract-audio",
    displayName: "Extract Audio",
    description: "Extract audio tracks from video files with multiple format support",
    category: "Media Processing",
    tags: ["audio", "extraction", "video", "conversion"],
  },
  {
    name: "extract-frames",
    displayName: "Extract Frames",
    description: "Extract frames from video files at specified intervals or timestamps",
    category: "Media Processing",
    tags: ["frames", "video", "extraction", "images"],
  },
  {
    name: "gif-maker",
    displayName: "GIF Maker",
    description: "Create animated GIFs from images, videos, or screen recordings",
    category: "Media Processing",
    tags: ["gif", "animation", "images", "video"],
  },
  {
    name: "highlight-reel-generator",
    displayName: "Highlight Reel Generator",
    description: "Generate video highlight reels from longer content with key moments",
    category: "Media Processing",
    tags: ["highlights", "video", "editing", "content"],
  },
  {
    name: "remove-background",
    displayName: "Remove Background",
    description: "Remove backgrounds from images using AI segmentation",
    category: "Media Processing",
    tags: ["background-removal", "image", "ai", "editing"],
  },
  {
    name: "subtitle",
    displayName: "Subtitle",
    description: "Generate styled subtitles from audio using OpenAI Whisper",
    category: "Media Processing",
    tags: ["subtitles", "transcription", "whisper", "video"],
  },
  {
    name: "transcript",
    displayName: "Transcript",
    description: "Generate transcripts from audio and video files with timestamps",
    category: "Media Processing",
    tags: ["transcript", "audio", "video", "speech-to-text"],
  },
  {
    name: "video-cut-suggester",
    displayName: "Video Cut Suggester",
    description: "Suggest video cuts and edits based on content analysis and pacing",
    category: "Media Processing",
    tags: ["video", "editing", "cuts", "suggestions"],
  },
  {
    name: "video-downloader",
    displayName: "Video Downloader",
    description: "Download videos from various online platforms and services",
    category: "Media Processing",
    tags: ["video", "download", "platforms", "media"],
  },
  {
    name: "video-thumbnail",
    displayName: "Video Thumbnail",
    description: "Generate eye-catching video thumbnails with text overlays",
    category: "Media Processing",
    tags: ["video", "thumbnail", "design", "youtube"],
  },
  {
    name: "watermark",
    displayName: "Watermark",
    description: "Add watermarks to images and documents for copyright protection",
    category: "Media Processing",
    tags: ["watermark", "protection", "copyright", "images"],
  },

  // Design & Branding
  {
    name: "brand-style-guide",
    displayName: "Brand Style Guide",
    description: "Generate comprehensive brand style guides with visual identity guidelines",
    category: "Design & Branding",
    tags: ["brand", "style-guide", "identity", "design"],
  },
  {
    name: "brand-voice-audit",
    displayName: "Brand Voice Audit",
    description: "Audit content for brand voice consistency and tone alignment",
    category: "Design & Branding",
    tags: ["brand", "voice", "audit", "tone"],
  },
  {
    name: "color-palette-harmonizer",
    displayName: "Color Palette Harmonizer",
    description: "Generate harmonious color palettes for design and branding projects",
    category: "Design & Branding",
    tags: ["color", "palette", "design", "harmony"],
  },
  {
    name: "generate-book-cover",
    displayName: "Generate Book Cover",
    description: "Generate professional book cover designs with AI",
    category: "Design & Branding",
    tags: ["book-cover", "design", "generation", "publishing"],
  },
  {
    name: "generate-favicon",
    displayName: "Generate Favicon",
    description: "Generate favicons in multiple sizes and formats for websites",
    category: "Design & Branding",
    tags: ["favicon", "icon", "design", "web"],
  },
  {
    name: "microcopy-generator",
    displayName: "Microcopy Generator",
    description: "Generate UI microcopy including button text, tooltips, and error messages",
    category: "Design & Branding",
    tags: ["microcopy", "ux", "ui-text", "writing"],
  },
  {
    name: "packaging-concept-studio",
    displayName: "Packaging Concept Studio",
    description: "Design product packaging concepts with mockups and specifications",
    category: "Design & Branding",
    tags: ["packaging", "design", "product", "concept"],
  },
  {
    name: "presentation-theme-maker",
    displayName: "Presentation Theme Maker",
    description: "Create custom presentation themes with color schemes and layouts",
    category: "Design & Branding",
    tags: ["presentation", "theme", "design", "templates"],
  },
  {
    name: "print-collateral-designer",
    displayName: "Print Collateral Designer",
    description: "Design print collateral including brochures, flyers, and business cards",
    category: "Design & Branding",
    tags: ["print", "collateral", "brochures", "design"],
  },
  {
    name: "product-mockup",
    displayName: "Product Mockup",
    description: "Generate product mockups for visualization and marketing materials",
    category: "Design & Branding",
    tags: ["product", "mockup", "visualization", "marketing"],
  },
  {
    name: "testimonial-graphics",
    displayName: "Testimonial Graphics",
    description: "Create visual testimonial graphics for social proof and marketing",
    category: "Design & Branding",
    tags: ["testimonials", "graphics", "social-proof", "marketing"],
  },

  // Web & Browser
  {
    name: "browse",
    displayName: "Browse",
    description: "Browser automation using Browser-Use Cloud API for AI agents",
    category: "Web & Browser",
    tags: ["browser", "automation", "scraping", "web"],
  },
  {
    name: "domainpurchase",
    displayName: "Domain Purchase",
    description: "Purchase and manage domains via registrar connectors",
    category: "Web & Browser",
    tags: ["domain", "purchase", "registrar", "management"],
  },
  {
    name: "domainsearch",
    displayName: "Domain Search",
    description: "Search domain availability and suggestions via registrar connectors",
    category: "Web & Browser",
    tags: ["domain", "search", "availability", "registration"],
  },
  {
    name: "webcrawling",
    displayName: "Web Crawling",
    description: "Web crawling service using Firecrawl API for content extraction",
    category: "Web & Browser",
    tags: ["crawling", "web", "firecrawl", "extraction"],
  },

  // Research & Writing
  {
    name: "blog-topic-cluster",
    displayName: "Blog Topic Cluster",
    description: "Generate topic clusters and content strategies for blog SEO planning",
    category: "Research & Writing",
    tags: ["blog", "seo", "topics", "content-strategy"],
  },
  {
    name: "copytone-translator",
    displayName: "Copy Tone Translator",
    description: "Translate copy between different tones and writing styles",
    category: "Research & Writing",
    tags: ["copywriting", "tone", "translation", "style"],
  },
  {
    name: "create-blog-article",
    displayName: "Create Blog Article",
    description: "Create SEO-optimized blog articles with structured content",
    category: "Research & Writing",
    tags: ["blog", "article", "writing", "seo"],
  },
  {
    name: "create-ebook",
    displayName: "Create eBook",
    description: "Create complete eBooks with chapters, formatting, and cover design",
    category: "Research & Writing",
    tags: ["ebook", "writing", "publishing", "content"],
  },
  {
    name: "deepresearch",
    displayName: "Deep Research (Agentic)",
    description: "Agentic deep research using Exa.ai for parallel semantic search and LLM synthesis",
    category: "Research & Writing",
    tags: ["research", "exa", "semantic-search", "synthesis"],
  },
  {
    name: "faq-packager",
    displayName: "FAQ Packager",
    description: "Package and organize frequently asked questions into structured documents",
    category: "Research & Writing",
    tags: ["faq", "documentation", "knowledge-base", "content"],
  },
  {
    name: "longform-structurer",
    displayName: "Longform Structurer",
    description: "Structure long-form content with outlines, chapters, and sections",
    category: "Research & Writing",
    tags: ["longform", "structure", "outline", "writing"],
  },
  {
    name: "podcast-show-notes",
    displayName: "Podcast Show Notes",
    description: "Generate podcast show notes with timestamps, summaries, and links",
    category: "Research & Writing",
    tags: ["podcast", "show-notes", "summary", "content"],
  },
  {
    name: "press-release-drafter",
    displayName: "Press Release Drafter",
    description: "Draft professional press releases for announcements and media distribution",
    category: "Research & Writing",
    tags: ["press-release", "pr", "media", "writing"],
  },
  {
    name: "write",
    displayName: "Write",
    description: "Write short or long-form content - articles, books, documentation at scale",
    category: "Research & Writing",
    tags: ["writing", "content", "articles", "documentation"],
  },

  // Science & Academic
  {
    name: "academic-journal-matcher",
    displayName: "Academic Journal Matcher",
    description: "Match research papers to appropriate academic journals for submission",
    category: "Science & Academic",
    tags: ["academic", "journal", "research", "publishing"],
  },
  {
    name: "advanced-math",
    displayName: "Advanced Math",
    description: "Solve advanced mathematical problems including calculus, algebra, and statistics",
    category: "Science & Academic",
    tags: ["math", "calculus", "algebra", "computation"],
  },
  {
    name: "bio-sequence-tool",
    displayName: "Bio Sequence Tool",
    description: "Analyze and manipulate biological sequences including DNA, RNA, and protein data",
    category: "Science & Academic",
    tags: ["biology", "dna", "sequence", "bioinformatics"],
  },
  {
    name: "chemistry-calculator",
    displayName: "Chemistry Calculator",
    description: "Perform chemistry calculations including molecular weights, reactions, and stoichiometry",
    category: "Science & Academic",
    tags: ["chemistry", "calculations", "molecular", "science"],
  },
  {
    name: "citation-formatter",
    displayName: "Citation Formatter",
    description: "Format academic citations in APA, MLA, Chicago, and other styles",
    category: "Science & Academic",
    tags: ["citation", "formatting", "academic", "references"],
  },
  {
    name: "experiment-power-calculator",
    displayName: "Experiment Power Calculator",
    description: "Calculate statistical power and sample size for experiments",
    category: "Science & Academic",
    tags: ["experiment", "statistics", "power-analysis", "sample-size"],
  },
  {
    name: "lab-notebook-formatter",
    displayName: "Lab Notebook Formatter",
    description: "Format laboratory notebook entries with structured scientific records",
    category: "Science & Academic",
    tags: ["lab", "notebook", "formatting", "science"],
  },
  {
    name: "latex-table-generator",
    displayName: "LaTeX Table Generator",
    description: "Generate formatted LaTeX tables from data for academic papers",
    category: "Science & Academic",
    tags: ["latex", "tables", "academic", "formatting"],
  },
  {
    name: "scientific-figure-check",
    displayName: "Scientific Figure Check",
    description: "Validate scientific figures for accuracy, formatting, and publication standards",
    category: "Science & Academic",
    tags: ["scientific", "figures", "validation", "publishing"],
  },
  {
    name: "statistical-test-selector",
    displayName: "Statistical Test Selector",
    description: "Recommend appropriate statistical tests based on data and research questions",
    category: "Science & Academic",
    tags: ["statistics", "test-selection", "research", "analysis"],
  },

  // Education & Learning
  {
    name: "classroom-newsletter-kit",
    displayName: "Classroom Newsletter Kit",
    description: "Create classroom newsletters with templates for teachers and educators",
    category: "Education & Learning",
    tags: ["classroom", "newsletter", "education", "teachers"],
  },
  {
    name: "educational-resource-finder",
    displayName: "Educational Resource Finder",
    description: "Find educational resources, courses, and learning materials by topic",
    category: "Education & Learning",
    tags: ["education", "resources", "learning", "courses"],
  },
  {
    name: "exam-readiness-check",
    displayName: "Exam Readiness Check",
    description: "Assess exam readiness with practice questions and gap analysis",
    category: "Education & Learning",
    tags: ["exam", "readiness", "assessment", "preparation"],
  },
  {
    name: "field-trip-planner",
    displayName: "Field Trip Planner",
    description: "Plan educational field trips with logistics, safety, and learning objectives",
    category: "Education & Learning",
    tags: ["field-trip", "education", "planning", "logistics"],
  },
  {
    name: "homework-feedback-coach",
    displayName: "Homework Feedback Coach",
    description: "Provide constructive feedback on homework assignments with improvement suggestions",
    category: "Education & Learning",
    tags: ["homework", "feedback", "coaching", "education"],
  },
  {
    name: "learning-style-profiler",
    displayName: "Learning Style Profiler",
    description: "Profile individual learning styles and recommend personalized study strategies",
    category: "Education & Learning",
    tags: ["learning", "profiling", "personalization", "education"],
  },
  {
    name: "lesson-plan-customizer",
    displayName: "Lesson Plan Customizer",
    description: "Customize lesson plans for different age groups, subjects, and learning objectives",
    category: "Education & Learning",
    tags: ["lesson-plan", "customization", "teaching", "education"],
  },
  {
    name: "parent-teacher-brief",
    displayName: "Parent Teacher Brief",
    description: "Generate parent-teacher conference briefs with student progress summaries",
    category: "Education & Learning",
    tags: ["parent-teacher", "conference", "education", "progress"],
  },
  {
    name: "scholarship-tracker",
    displayName: "Scholarship Tracker",
    description: "Track scholarship applications, deadlines, and requirements",
    category: "Education & Learning",
    tags: ["scholarship", "tracking", "education", "applications"],
  },
  {
    name: "study-guide-builder",
    displayName: "Study Guide Builder",
    description: "Build comprehensive study guides with summaries, key concepts, and practice questions",
    category: "Education & Learning",
    tags: ["study-guide", "learning", "education", "review"],
  },

  // Communication
  {
    name: "calendar-events",
    displayName: "Calendar Events",
    description: "Create, manage, and organize calendar events and scheduling",
    category: "Communication",
    tags: ["calendar", "events", "scheduling", "organization"],
  },
  {
    name: "gmail",
    displayName: "Gmail",
    description: "Compose, read, and manage Gmail messages with AI assistance",
    category: "Communication",
    tags: ["email", "gmail", "compose", "management"],
  },
  {
    name: "slack-assistant",
    displayName: "Slack Assistant",
    description: "Automate Slack interactions with message management and channel operations",
    category: "Communication",
    tags: ["slack", "assistant", "automation", "messaging"],
  },
  {
    name: "sms",
    displayName: "SMS",
    description: "Send and receive SMS messages via Twilio",
    category: "Communication",
    tags: ["sms", "twilio", "messaging", "text"],
  },

  // Health & Wellness
  {
    name: "grocery-basket-optimizer",
    displayName: "Grocery Basket Optimizer",
    description: "Optimize grocery shopping lists for budget, nutrition, and preferences",
    category: "Health & Wellness",
    tags: ["grocery", "shopping", "optimization", "meal-planning"],
  },
  {
    name: "habit-reflection-digest",
    displayName: "Habit Reflection Digest",
    description: "Generate habit tracking digests with reflection prompts and insights",
    category: "Health & Wellness",
    tags: ["habits", "reflection", "tracking", "wellness"],
  },
  {
    name: "meal-plan-designer",
    displayName: "Meal Plan Designer",
    description: "Design weekly meal plans with nutrition, recipes, and shopping lists",
    category: "Health & Wellness",
    tags: ["meal-plan", "nutrition", "recipes", "health"],
  },
  {
    name: "mindfulness-prompt-cache",
    displayName: "Mindfulness Prompt Cache",
    description: "Curate and deliver mindfulness prompts for meditation and relaxation",
    category: "Health & Wellness",
    tags: ["mindfulness", "meditation", "prompts", "wellness"],
  },
  {
    name: "sleep-routine-analyzer",
    displayName: "Sleep Routine Analyzer",
    description: "Analyze sleep patterns and provide improvement recommendations",
    category: "Health & Wellness",
    tags: ["sleep", "analysis", "routine", "wellness"],
  },
  {
    name: "stress-relief-playbook",
    displayName: "Stress Relief Playbook",
    description: "Generate personalized stress relief strategies and relaxation techniques",
    category: "Health & Wellness",
    tags: ["stress", "relief", "wellness", "relaxation"],
  },
  {
    name: "wellness-progress-reporter",
    displayName: "Wellness Progress Reporter",
    description: "Generate wellness progress reports with health metrics and trends",
    category: "Health & Wellness",
    tags: ["wellness", "progress", "reporting", "health"],
  },
  {
    name: "workout-cycle-planner",
    displayName: "Workout Cycle Planner",
    description: "Plan workout cycles with periodization, exercises, and progression",
    category: "Health & Wellness",
    tags: ["workout", "planning", "fitness", "exercise"],
  },

  // Travel & Lifestyle
  {
    name: "destination-briefing",
    displayName: "Destination Briefing",
    description: "Create travel destination briefings with local info, tips, and logistics",
    category: "Travel & Lifestyle",
    tags: ["travel", "destination", "briefing", "tourism"],
  },
  {
    name: "family-activity-curator",
    displayName: "Family Activity Curator",
    description: "Curate family-friendly activities based on age, interests, and location",
    category: "Travel & Lifestyle",
    tags: ["family", "activities", "kids", "recreation"],
  },
  {
    name: "household-maintenance-mgr",
    displayName: "Household Maintenance Manager",
    description: "Track and schedule household maintenance tasks and reminders",
    category: "Travel & Lifestyle",
    tags: ["household", "maintenance", "scheduling", "home"],
  },
  {
    name: "itinerary-architect",
    displayName: "Itinerary Architect",
    description: "Design detailed travel itineraries with activities, timing, and logistics",
    category: "Travel & Lifestyle",
    tags: ["itinerary", "travel", "planning", "logistics"],
  },
  {
    name: "packing-plan-pro",
    displayName: "Packing Plan Pro",
    description: "Create detailed packing plans for trips with weather-based recommendations",
    category: "Travel & Lifestyle",
    tags: ["packing", "travel", "planning", "checklist"],
  },
  {
    name: "pet-care-scheduler",
    displayName: "Pet Care Scheduler",
    description: "Schedule and track pet care activities including feeding, walks, and vet visits",
    category: "Travel & Lifestyle",
    tags: ["pets", "care", "scheduling", "reminders"],
  },
  {
    name: "travel-budget-balancer",
    displayName: "Travel Budget Balancer",
    description: "Balance travel budgets across categories with optimization suggestions",
    category: "Travel & Lifestyle",
    tags: ["travel", "budget", "planning", "optimization"],
  },

  // Event Management
  {
    name: "guest-communication-suite",
    displayName: "Guest Communication Suite",
    description: "Manage guest communications for events, hospitality, and venues",
    category: "Event Management",
    tags: ["guest", "communication", "hospitality", "events"],
  },
  {
    name: "livestream-runofshow",
    displayName: "Livestream Run of Show",
    description: "Create run-of-show documents for livestream events with timing and cues",
    category: "Event Management",
    tags: ["livestream", "run-of-show", "scheduling", "production"],
  },
  {
    name: "onsite-ops-checklist",
    displayName: "Onsite Ops Checklist",
    description: "Create operational checklists for on-site events and activities",
    category: "Event Management",
    tags: ["onsite", "operations", "checklist", "events"],
  },
  {
    name: "seating-chart-maker",
    displayName: "Seating Chart Maker",
    description: "Create seating charts for events, classrooms, and venues",
    category: "Event Management",
    tags: ["seating", "chart", "events", "venues"],
  },

];

export function getSkillsByCategory(category: Category): SkillMeta[] {
  return SKILLS.filter((s) => s.category === category);
}

export function searchSkills(query: string): SkillMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const scored: { skill: SkillMeta; score: number }[] = [];

  for (const skill of SKILLS) {
    const nameLower = skill.name.toLowerCase();
    const displayNameLower = skill.displayName.toLowerCase();
    const descriptionLower = skill.description.toLowerCase();
    const tagsLower = skill.tags.map((t) => t.toLowerCase());

    let score = 0;
    let allWordsMatch = true;

    for (const word of words) {
      let wordMatched = false;

      if (nameLower.includes(word)) {
        score += 10;
        wordMatched = true;
      }
      if (displayNameLower.includes(word)) {
        score += 7;
        wordMatched = true;
      }
      if (tagsLower.some((t) => t.includes(word))) {
        score += 5;
        wordMatched = true;
      }
      if (descriptionLower.includes(word)) {
        score += 2;
        wordMatched = true;
      }

      if (!wordMatched) {
        allWordsMatch = false;
        break;
      }
    }

    if (allWordsMatch && score > 0) {
      scored.push({ skill, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.skill);
}

export function getSkill(name: string): SkillMeta | undefined {
  return SKILLS.find((s) => s.name === name);
}
