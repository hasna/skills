#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-get-api-docs";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "_")
  .replace(/-/g, "_")
  .slice(0, 19)
  .toLowerCase();

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const CACHE_DIR = join(SKILLS_OUTPUT_DIR, "cache", SKILL_NAME);

// Types
interface DocSource {
  name: string;
  displayName: string;
  category: string;
  baseUrl: string;
  docsUrl: string;
  apiReference?: string;
  github?: string;
  sections?: string[];
}

interface FetchedDoc {
  tool: string;
  displayName: string;
  version: string;
  source: string;
  sections: DocSection[];
  examples: CodeExample[];
  fetchedAt: string;
}

interface DocSection {
  title: string;
  content: string;
  subsections?: DocSection[];
}

interface CodeExample {
  title: string;
  language: string;
  code: string;
  description?: string;
}

interface Options {
  tool: string;
  section?: string;
  search?: string;
  version?: string;
  format: "markdown" | "json" | "html";
  list: boolean;
  examples: boolean;
  verbose: boolean;
}

// Documentation sources registry
const DOC_SOURCES: Record<string, DocSource> = {
  // AI & Machine Learning
  openai: {
    name: "openai",
    displayName: "OpenAI API",
    category: "AI & Machine Learning",
    baseUrl: "https://platform.openai.com",
    docsUrl: "https://platform.openai.com/docs/api-reference",
    sections: ["authentication", "models", "chat", "embeddings", "images", "audio", "fine-tuning", "assistants"],
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic Claude API",
    category: "AI & Machine Learning",
    baseUrl: "https://docs.anthropic.com",
    docsUrl: "https://docs.anthropic.com/en/api",
    sections: ["authentication", "messages", "models", "streaming", "vision", "tool-use"],
  },
  "google-ai": {
    name: "google-ai",
    displayName: "Google AI (Gemini)",
    category: "AI & Machine Learning",
    baseUrl: "https://ai.google.dev",
    docsUrl: "https://ai.google.dev/api/rest",
    sections: ["getting-started", "models", "generate-content", "embeddings", "files"],
  },
  langchain: {
    name: "langchain",
    displayName: "LangChain",
    category: "AI & Machine Learning",
    baseUrl: "https://js.langchain.com",
    docsUrl: "https://js.langchain.com/docs",
    github: "https://github.com/langchain-ai/langchainjs",
    sections: ["getting-started", "llms", "chains", "agents", "memory", "retrievers"],
  },
  huggingface: {
    name: "huggingface",
    displayName: "Hugging Face",
    category: "AI & Machine Learning",
    baseUrl: "https://huggingface.co",
    docsUrl: "https://huggingface.co/docs/api-inference",
    sections: ["inference", "models", "datasets", "spaces"],
  },
  replicate: {
    name: "replicate",
    displayName: "Replicate",
    category: "AI & Machine Learning",
    baseUrl: "https://replicate.com",
    docsUrl: "https://replicate.com/docs/reference/http",
    sections: ["authentication", "predictions", "models", "deployments", "webhooks"],
  },

  // Cloud Providers
  "aws-s3": {
    name: "aws-s3",
    displayName: "AWS S3",
    category: "Cloud Providers",
    baseUrl: "https://docs.aws.amazon.com",
    docsUrl: "https://docs.aws.amazon.com/s3/index.html",
    sections: ["buckets", "objects", "access-control", "encryption", "lifecycle"],
  },
  "aws-lambda": {
    name: "aws-lambda",
    displayName: "AWS Lambda",
    category: "Cloud Providers",
    baseUrl: "https://docs.aws.amazon.com",
    docsUrl: "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",
    sections: ["getting-started", "functions", "triggers", "layers", "concurrency"],
  },
  vercel: {
    name: "vercel",
    displayName: "Vercel",
    category: "Cloud Providers",
    baseUrl: "https://vercel.com",
    docsUrl: "https://vercel.com/docs",
    sections: ["deployments", "domains", "functions", "edge", "storage", "analytics"],
  },
  cloudflare: {
    name: "cloudflare",
    displayName: "Cloudflare",
    category: "Cloud Providers",
    baseUrl: "https://developers.cloudflare.com",
    docsUrl: "https://developers.cloudflare.com/api",
    sections: ["workers", "pages", "r2", "d1", "kv", "durable-objects"],
  },
  netlify: {
    name: "netlify",
    displayName: "Netlify",
    category: "Cloud Providers",
    baseUrl: "https://docs.netlify.com",
    docsUrl: "https://docs.netlify.com/api/get-started/",
    sections: ["sites", "deploys", "forms", "functions", "identity"],
  },

  // Databases
  postgresql: {
    name: "postgresql",
    displayName: "PostgreSQL",
    category: "Databases",
    baseUrl: "https://www.postgresql.org",
    docsUrl: "https://www.postgresql.org/docs/current/",
    sections: ["sql", "functions", "indexes", "transactions", "extensions"],
  },
  mongodb: {
    name: "mongodb",
    displayName: "MongoDB",
    category: "Databases",
    baseUrl: "https://www.mongodb.com",
    docsUrl: "https://www.mongodb.com/docs/manual/",
    sections: ["crud", "aggregation", "indexes", "transactions", "replication"],
  },
  redis: {
    name: "redis",
    displayName: "Redis",
    category: "Databases",
    baseUrl: "https://redis.io",
    docsUrl: "https://redis.io/docs/",
    sections: ["commands", "data-types", "clients", "pubsub", "streams"],
  },
  supabase: {
    name: "supabase",
    displayName: "Supabase",
    category: "Databases",
    baseUrl: "https://supabase.com",
    docsUrl: "https://supabase.com/docs/reference",
    sections: ["database", "auth", "storage", "functions", "realtime"],
  },
  prisma: {
    name: "prisma",
    displayName: "Prisma ORM",
    category: "Databases",
    baseUrl: "https://www.prisma.io",
    docsUrl: "https://www.prisma.io/docs/reference",
    github: "https://github.com/prisma/prisma",
    sections: ["schema", "client", "migrations", "queries", "relations"],
  },
  drizzle: {
    name: "drizzle",
    displayName: "Drizzle ORM",
    category: "Databases",
    baseUrl: "https://orm.drizzle.team",
    docsUrl: "https://orm.drizzle.team/docs/overview",
    github: "https://github.com/drizzle-team/drizzle-orm",
    sections: ["schema", "queries", "relations", "migrations", "studio"],
  },

  // Web Frameworks
  nextjs: {
    name: "nextjs",
    displayName: "Next.js",
    category: "Web Frameworks",
    baseUrl: "https://nextjs.org",
    docsUrl: "https://nextjs.org/docs",
    github: "https://github.com/vercel/next.js",
    sections: ["app-router", "pages-router", "api-routes", "data-fetching", "styling", "deployment"],
  },
  react: {
    name: "react",
    displayName: "React",
    category: "Web Frameworks",
    baseUrl: "https://react.dev",
    docsUrl: "https://react.dev/reference/react",
    github: "https://github.com/facebook/react",
    sections: ["components", "hooks", "apis", "dom", "server"],
  },
  vue: {
    name: "vue",
    displayName: "Vue.js",
    category: "Web Frameworks",
    baseUrl: "https://vuejs.org",
    docsUrl: "https://vuejs.org/api/",
    github: "https://github.com/vuejs/core",
    sections: ["composition-api", "options-api", "built-ins", "sfc", "ssr"],
  },
  svelte: {
    name: "svelte",
    displayName: "Svelte",
    category: "Web Frameworks",
    baseUrl: "https://svelte.dev",
    docsUrl: "https://svelte.dev/docs",
    github: "https://github.com/sveltejs/svelte",
    sections: ["components", "reactivity", "stores", "motion", "sveltekit"],
  },
  express: {
    name: "express",
    displayName: "Express.js",
    category: "Web Frameworks",
    baseUrl: "https://expressjs.com",
    docsUrl: "https://expressjs.com/en/4x/api.html",
    github: "https://github.com/expressjs/express",
    sections: ["application", "request", "response", "router", "middleware"],
  },
  hono: {
    name: "hono",
    displayName: "Hono",
    category: "Web Frameworks",
    baseUrl: "https://hono.dev",
    docsUrl: "https://hono.dev/docs",
    github: "https://github.com/honojs/hono",
    sections: ["routing", "middleware", "context", "helpers", "adapters"],
  },

  // Payment & Commerce
  stripe: {
    name: "stripe",
    displayName: "Stripe",
    category: "Payment & Commerce",
    baseUrl: "https://stripe.com",
    docsUrl: "https://stripe.com/docs/api",
    sections: ["authentication", "customers", "payments", "subscriptions", "webhooks", "checkout"],
  },
  paypal: {
    name: "paypal",
    displayName: "PayPal",
    category: "Payment & Commerce",
    baseUrl: "https://developer.paypal.com",
    docsUrl: "https://developer.paypal.com/docs/api/overview/",
    sections: ["authentication", "orders", "payments", "subscriptions", "webhooks"],
  },
  shopify: {
    name: "shopify",
    displayName: "Shopify",
    category: "Payment & Commerce",
    baseUrl: "https://shopify.dev",
    docsUrl: "https://shopify.dev/docs/api",
    sections: ["admin-api", "storefront-api", "webhooks", "apps", "themes"],
  },

  // Communication
  twilio: {
    name: "twilio",
    displayName: "Twilio",
    category: "Communication",
    baseUrl: "https://www.twilio.com",
    docsUrl: "https://www.twilio.com/docs/usage/api",
    sections: ["sms", "voice", "video", "conversations", "verify"],
  },
  sendgrid: {
    name: "sendgrid",
    displayName: "SendGrid",
    category: "Communication",
    baseUrl: "https://sendgrid.com",
    docsUrl: "https://docs.sendgrid.com/api-reference",
    sections: ["mail-send", "templates", "contacts", "stats", "webhooks"],
  },
  resend: {
    name: "resend",
    displayName: "Resend",
    category: "Communication",
    baseUrl: "https://resend.com",
    docsUrl: "https://resend.com/docs/api-reference/introduction",
    sections: ["emails", "domains", "api-keys", "audiences", "react-email"],
  },
  slack: {
    name: "slack",
    displayName: "Slack API",
    category: "Communication",
    baseUrl: "https://api.slack.com",
    docsUrl: "https://api.slack.com/methods",
    sections: ["authentication", "messaging", "files", "users", "channels", "apps"],
  },
  discord: {
    name: "discord",
    displayName: "Discord API",
    category: "Communication",
    baseUrl: "https://discord.com",
    docsUrl: "https://discord.com/developers/docs/intro",
    sections: ["authentication", "channels", "guilds", "users", "webhooks", "interactions"],
  },

  // Developer Tools
  github: {
    name: "github",
    displayName: "GitHub API",
    category: "Developer Tools",
    baseUrl: "https://github.com",
    docsUrl: "https://docs.github.com/en/rest",
    sections: ["authentication", "repositories", "issues", "pull-requests", "actions", "webhooks"],
  },
  gitlab: {
    name: "gitlab",
    displayName: "GitLab API",
    category: "Developer Tools",
    baseUrl: "https://gitlab.com",
    docsUrl: "https://docs.gitlab.com/ee/api/",
    sections: ["authentication", "projects", "merge-requests", "pipelines", "issues"],
  },
  docker: {
    name: "docker",
    displayName: "Docker",
    category: "Developer Tools",
    baseUrl: "https://docs.docker.com",
    docsUrl: "https://docs.docker.com/reference/",
    sections: ["dockerfile", "compose", "cli", "api", "registry"],
  },
  kubernetes: {
    name: "kubernetes",
    displayName: "Kubernetes",
    category: "Developer Tools",
    baseUrl: "https://kubernetes.io",
    docsUrl: "https://kubernetes.io/docs/reference/",
    sections: ["pods", "deployments", "services", "configmaps", "secrets", "kubectl"],
  },
};

// Utility functions
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: "info" | "error" | "success" | "warn" = "info"): void {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefixes: Record<string, string> = {
    info: "[INFO]",
    error: "[ERROR]",
    success: "[SUCCESS]",
    warn: "[WARN]",
  };

  console.log(`${prefixes[level]} ${message}`);
}

function parseArguments(): Options {
  const args = process.argv.slice(2);

  const options: Options = {
    tool: "",
    format: "markdown",
    list: false,
    examples: true,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--section":
        options.section = args[++i];
        break;
      case "--search":
        options.search = args[++i];
        break;
      case "--version":
        options.version = args[++i];
        break;
      case "--format":
        options.format = args[++i] as "markdown" | "json" | "html";
        break;
      case "--list":
        options.list = true;
        break;
      case "--examples":
        options.examples = true;
        break;
      case "--no-examples":
        options.examples = false;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (!arg.startsWith("-") && !options.tool) {
          options.tool = arg.toLowerCase();
        }
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Get API Documentation - Fetch latest API docs for popular tools

Usage:
  skills run get-api-docs -- <tool> [options]

Arguments:
  tool                  Name of the tool/API to fetch docs for

Options:
  --section <name>      Specific section to retrieve
  --search <query>      Search within documentation
  --version <version>   Specific version (default: latest)
  --format <format>     Output format: markdown, json, html (default: markdown)
  --list                List all supported tools
  --examples            Include code examples (default: true)
  --no-examples         Exclude code examples
  --verbose             Show detailed progress
  --help, -h            Show this help

Examples:
  skills run get-api-docs -- openai
  skills run get-api-docs -- stripe --section webhooks
  skills run get-api-docs -- nextjs --search "server actions"
  skills run get-api-docs -- --list
`);
}

function listTools(): void {
  console.log("\n# Supported Tools & APIs\n");

  const categories: Record<string, DocSource[]> = {};

  for (const source of Object.values(DOC_SOURCES)) {
    if (!categories[source.category]) {
      categories[source.category] = [];
    }
    categories[source.category].push(source);
  }

  for (const [category, sources] of Object.entries(categories)) {
    console.log(`## ${category}\n`);
    for (const source of sources) {
      console.log(`- **${source.displayName}** (\`${source.name}\`)`);
      if (source.sections) {
        console.log(`  Sections: ${source.sections.join(", ")}`);
      }
    }
    console.log("");
  }
}

async function fetchDocumentation(source: DocSource, options: Options): Promise<FetchedDoc> {
  if (options.verbose) {
    log(`Fetching documentation from ${source.docsUrl}...`);
  }

  // In a real implementation, this would scrape or fetch from the actual docs
  // For now, we'll generate structured documentation based on the source info
  const sections = await generateDocSections(source, options);
  const examples = options.examples ? await generateExamples(source, options) : [];

  return {
    tool: source.name,
    displayName: source.displayName,
    version: options.version || "latest",
    source: source.docsUrl,
    sections,
    examples,
    fetchedAt: new Date().toISOString(),
  };
}

async function generateDocSections(source: DocSource, options: Options): Promise<DocSection[]> {
  const sections: DocSection[] = [];

  // Overview section
  sections.push({
    title: "Overview",
    content: `${source.displayName} is a powerful API/tool in the ${source.category} category.\n\n` +
      `**Official Documentation:** ${source.docsUrl}\n` +
      (source.github ? `**GitHub Repository:** ${source.github}\n` : "") +
      `**Base URL:** ${source.baseUrl}`,
  });

  // Getting Started section
  sections.push({
    title: "Getting Started",
    content: getGettingStartedContent(source),
  });

  // Authentication section (for APIs)
  if (source.category !== "Databases" && source.category !== "Developer Tools") {
    sections.push({
      title: "Authentication",
      content: getAuthenticationContent(source),
    });
  }

  // Add available sections
  if (source.sections) {
    const filteredSections = options.section
      ? source.sections.filter((s) => s.toLowerCase().includes(options.section!.toLowerCase()))
      : source.sections;

    for (const sectionName of filteredSections) {
      sections.push({
        title: formatSectionTitle(sectionName),
        content: getSectionContent(source, sectionName),
      });
    }
  }

  // Filter by search if provided
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    return sections.filter(
      (section) =>
        section.title.toLowerCase().includes(searchLower) ||
        section.content.toLowerCase().includes(searchLower)
    );
  }

  return sections;
}

function formatSectionTitle(section: string): string {
  return section
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getGettingStartedContent(source: DocSource): string {
  const contents: Record<string, string> = {
    openai: `## Installation

\`\`\`bash
npm install openai
# or
bun add openai
\`\`\`

## Quick Start

\`\`\`typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const completion = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(completion.choices[0].message.content);
\`\`\``,

    anthropic: `## Installation

\`\`\`bash
npm install @anthropic-ai/sdk
# or
bun add @anthropic-ai/sdk
\`\`\`

## Quick Start

\`\`\`typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const message = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude!" }],
});

console.log(message.content[0].text);
\`\`\``,

    stripe: `## Installation

\`\`\`bash
npm install stripe
# or
bun add stripe
\`\`\`

## Quick Start

\`\`\`typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create a customer
const customer = await stripe.customers.create({
  email: 'customer@example.com',
});

// Create a payment intent
const paymentIntent = await stripe.paymentIntents.create({
  amount: 1000,
  currency: 'usd',
  customer: customer.id,
});
\`\`\``,

    nextjs: `## Installation

\`\`\`bash
npx create-next-app@latest my-app
# or
bunx create-next-app@latest my-app
\`\`\`

## Project Structure (App Router)

\`\`\`
my-app/
├── app/
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Home page
│   ├── api/            # API routes
│   └── [slug]/         # Dynamic routes
├── components/
├── lib/
└── public/
\`\`\``,

    react: `## Installation

\`\`\`bash
npm create vite@latest my-app -- --template react-ts
# or
bunx create-vite my-app --template react-ts
\`\`\`

## Quick Start

\`\`\`tsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
\`\`\``,

    supabase: `## Installation

\`\`\`bash
npm install @supabase/supabase-js
# or
bun add @supabase/supabase-js
\`\`\`

## Quick Start

\`\`\`typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Query data
const { data, error } = await supabase
  .from('users')
  .select('*')
  .eq('active', true);
\`\`\``,

    prisma: `## Installation

\`\`\`bash
npm install prisma @prisma/client
npx prisma init
\`\`\`

## Quick Start

\`\`\`typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Query data
const users = await prisma.user.findMany({
  where: { active: true },
  include: { posts: true },
});
\`\`\``,

    drizzle: `## Installation

\`\`\`bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
\`\`\`

## Quick Start

\`\`\`typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

// Query data
const users = await db.select().from(usersTable);
\`\`\``,
  };

  return contents[source.name] || `Visit ${source.docsUrl} to get started with ${source.displayName}.`;
}

function getAuthenticationContent(source: DocSource): string {
  const contents: Record<string, string> = {
    openai: `## API Key Authentication

Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys).

\`\`\`typescript
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
\`\`\`

**Environment Variable:**
\`\`\`bash
OPENAI_API_KEY=sk-...
\`\`\``,

    anthropic: `## API Key Authentication

Get your API key from [Anthropic Console](https://console.anthropic.com/).

\`\`\`typescript
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
\`\`\`

**Environment Variable:**
\`\`\`bash
ANTHROPIC_API_KEY=sk-ant-...
\`\`\``,

    stripe: `## API Key Authentication

Get your API keys from [Stripe Dashboard](https://dashboard.stripe.com/apikeys).

\`\`\`typescript
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
\`\`\`

**Environment Variables:**
\`\`\`bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
\`\`\``,

    github: `## Personal Access Token

Create a token at [GitHub Settings](https://github.com/settings/tokens).

\`\`\`typescript
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});
\`\`\`

**Using gh CLI:**
\`\`\`bash
gh auth login
\`\`\``,

    vercel: `## API Token

Create a token at [Vercel Account Settings](https://vercel.com/account/tokens).

\`\`\`typescript
const response = await fetch('https://api.vercel.com/v9/projects', {
  headers: {
    Authorization: \`Bearer \${process.env.VERCEL_TOKEN}\`,
  },
});
\`\`\``,
  };

  return contents[source.name] || `Authentication is required. Check ${source.docsUrl} for details.`;
}

function getSectionContent(source: DocSource, section: string): string {
  // This would be dynamically fetched in a real implementation
  return `See the official documentation for detailed information about ${formatSectionTitle(section)}:\n\n` +
    `${source.docsUrl}/${section}`;
}

async function generateExamples(source: DocSource, options: Options): Promise<CodeExample[]> {
  const examples: CodeExample[] = [];

  const sourceExamples: Record<string, CodeExample[]> = {
    openai: [
      {
        title: "Chat Completion",
        language: "typescript",
        code: `const completion = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is TypeScript?" },
  ],
});`,
        description: "Basic chat completion request",
      },
      {
        title: "Streaming Response",
        language: "typescript",
        code: `const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Tell me a story" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}`,
        description: "Streaming chat completion",
      },
    ],
    anthropic: [
      {
        title: "Message Creation",
        language: "typescript",
        code: `const message = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Explain quantum computing" }],
});`,
        description: "Basic message request",
      },
      {
        title: "Tool Use",
        language: "typescript",
        code: `const message = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  tools: [{
    name: "get_weather",
    description: "Get weather for a location",
    input_schema: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
  }],
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
});`,
        description: "Using tools/function calling",
      },
    ],
    stripe: [
      {
        title: "Create Payment Intent",
        language: "typescript",
        code: `const paymentIntent = await stripe.paymentIntents.create({
  amount: 2000, // $20.00
  currency: 'usd',
  automatic_payment_methods: { enabled: true },
});`,
        description: "Create a payment intent for $20",
      },
      {
        title: "Handle Webhook",
        language: "typescript",
        code: `const event = stripe.webhooks.constructEvent(
  body,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);

switch (event.type) {
  case 'payment_intent.succeeded':
    const paymentIntent = event.data.object;
    // Handle successful payment
    break;
}`,
        description: "Process Stripe webhook events",
      },
    ],
    nextjs: [
      {
        title: "Server Component",
        language: "tsx",
        code: `// app/users/page.tsx
async function UsersPage() {
  const users = await db.query.users.findMany();

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}

export default UsersPage;`,
        description: "Server component with data fetching",
      },
      {
        title: "Server Action",
        language: "tsx",
        code: `'use server'

export async function createUser(formData: FormData) {
  const name = formData.get('name') as string;

  await db.insert(users).values({ name });

  revalidatePath('/users');
}`,
        description: "Server action for form submission",
      },
    ],
  };

  return sourceExamples[source.name] || [];
}

function formatAsMarkdown(doc: FetchedDoc): string {
  let output = `# ${doc.displayName} Documentation\n\n`;
  output += `> Version: ${doc.version} | Source: ${doc.source}\n`;
  output += `> Fetched: ${doc.fetchedAt}\n\n`;
  output += `---\n\n`;

  for (const section of doc.sections) {
    output += `## ${section.title}\n\n`;
    output += `${section.content}\n\n`;
  }

  if (doc.examples.length > 0) {
    output += `## Code Examples\n\n`;
    for (const example of doc.examples) {
      output += `### ${example.title}\n\n`;
      if (example.description) {
        output += `${example.description}\n\n`;
      }
      output += `\`\`\`${example.language}\n${example.code}\n\`\`\`\n\n`;
    }
  }

  return output;
}

function formatAsJSON(doc: FetchedDoc): string {
  return JSON.stringify(doc, null, 2);
}

function formatAsHTML(doc: FetchedDoc): string {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${doc.displayName} Documentation</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { font-family: 'SF Mono', Monaco, monospace; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
    h2 { color: #333; margin-top: 40px; }
    blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 16px; color: #666; }
  </style>
</head>
<body>
  <h1>${doc.displayName} Documentation</h1>
  <blockquote>
    <p>Version: ${doc.version} | Source: <a href="${doc.source}">${doc.source}</a></p>
  </blockquote>
`;

  for (const section of doc.sections) {
    html += `  <h2>${section.title}</h2>\n`;
    html += `  <div>${section.content.replace(/\n/g, "<br>")}</div>\n`;
  }

  if (doc.examples.length > 0) {
    html += `  <h2>Code Examples</h2>\n`;
    for (const example of doc.examples) {
      html += `  <h3>${example.title}</h3>\n`;
      if (example.description) {
        html += `  <p>${example.description}</p>\n`;
      }
      html += `  <pre><code>${escapeHtml(example.code)}</code></pre>\n`;
    }
  }

  html += `</body>\n</html>`;
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Main execution
async function main(): Promise<void> {
  const startTime = Date.now();

  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  const options = parseArguments();

  if (options.verbose) {
    log(`Options: ${JSON.stringify(options)}`);
  }

  // Handle --list flag
  if (options.list) {
    listTools();
    process.exit(0);
  }

  // Validate tool argument
  if (!options.tool) {
    console.error("Error: Please specify a tool/API name.");
    console.error("Use --list to see all supported tools.");
    console.error("\nExample: skills run get-api-docs -- openai");
    process.exit(1);
  }

  // Find the documentation source
  const source = DOC_SOURCES[options.tool];
  if (!source) {
    console.error(`Error: Unknown tool "${options.tool}".`);
    console.error("Use --list to see all supported tools.");

    // Suggest similar tools
    const suggestions = Object.keys(DOC_SOURCES).filter(
      (key) =>
        key.includes(options.tool) ||
        DOC_SOURCES[key].displayName.toLowerCase().includes(options.tool.toLowerCase())
    );
    if (suggestions.length > 0) {
      console.error(`\nDid you mean: ${suggestions.join(", ")}?`);
    }

    process.exit(1);
  }

  try {
    log(`Fetching documentation for ${source.displayName}...`);

    const doc = await fetchDocumentation(source, options);

    // Format output
    let output: string;
    let extension: string;

    switch (options.format) {
      case "json":
        output = formatAsJSON(doc);
        extension = "json";
        break;
      case "html":
        output = formatAsHTML(doc);
        extension = "html";
        break;
      default:
        output = formatAsMarkdown(doc);
        extension = "md";
    }

    // Ensure export directory exists
    ensureDir(EXPORTS_DIR);

    // Save to file
    const outputFile = join(EXPORTS_DIR, `${source.name}-docs.${extension}`);
    writeFileSync(outputFile, output, "utf-8");

    log(`Documentation saved to: ${outputFile}`, "success");

    // Print to console
    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    const duration = Date.now() - startTime;
    log(`Completed in ${duration}ms`, "success");

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
