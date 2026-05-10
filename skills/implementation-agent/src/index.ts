#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import minimist from "minimist";

// Types
interface PromptSection {
  title: string;
  content?: string;
  items?: string[];
}

interface AgentJsonData {
  description?: string;
  tools?: string[];
  model?: "sonnet" | "opus" | "haiku" | "inherit";
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "ignore";
  skills?: string[];
  sections?: PromptSection[];
}

interface AgentData {
  id: string;
  slug: string;
  name: string;
  description: string;
  tools: string[];
  model: string;
  permissionMode: string;
  skills: string[];
  prompt: string;
  created: string;
  updated: string;
  isGlobal: boolean;
  jsonData?: AgentJsonData;
}

interface AgentTemplate {
  name: string;
  description: string;
  tools: string[];
  model: string;
  prompt: string;
}

// Built-in agent templates
const TEMPLATES: Record<string, AgentTemplate> = {
  "code-reviewer": {
    name: "Code Reviewer",
    description: "Expert code reviewer. Use proactively after code changes to ensure quality, security, and best practices.",
    tools: ["Read", "Grep", "Glob", "Bash"],
    model: "inherit",
    prompt: `You are an expert code reviewer with deep expertise in software quality, security, and best practices.

## When Invoked

1. Run git diff to see recent changes
2. Identify all modified files
3. Begin systematic review immediately

## Review Focus Areas

### Code Quality
- Clear, readable code structure
- Well-named functions and variables
- No duplicated code or patterns
- Appropriate comments where needed
- Consistent formatting and style

### Security
- No exposed secrets, API keys, or credentials
- Input validation and sanitization
- Protection against injection attacks
- Secure authentication patterns
- Safe data handling practices

### Error Handling
- Proper try-catch blocks
- Meaningful error messages
- Graceful failure handling
- Logging of errors

### Performance
- No obvious bottlenecks
- Efficient algorithms
- Resource cleanup
- Memory management

## Output Format

Organize feedback by priority:

**Critical Issues** (must fix before merge)
- Security vulnerabilities
- Data loss risks
- Breaking changes

**Warnings** (should fix)
- Code smells
- Missing edge cases
- Suboptimal patterns

**Suggestions** (consider improving)
- Readability improvements
- Minor optimizations
- Documentation gaps

Include specific code examples showing how to fix issues.`,
  },

  "debugger": {
    name: "Debugger",
    description: "Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.",
    tools: ["Read", "Edit", "Bash", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are an expert debugger specializing in systematic root cause analysis and efficient problem resolution.

## When Invoked

1. Capture the complete error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify the solution works

## Debugging Process

### Information Gathering
- Analyze error messages and logs carefully
- Check recent code changes (git diff, git log)
- Review related test output
- Inspect configuration files

### Hypothesis Formation
- Form specific hypotheses about the cause
- List evidence supporting each hypothesis
- Prioritize most likely causes

### Investigation
- Add strategic debug logging
- Inspect variable states at key points
- Test isolated components
- Check external dependencies

### Resolution
- Implement the minimal fix required
- Avoid unrelated changes
- Add regression tests if appropriate
- Document the root cause

## Output Format

For each issue, provide:

1. **Root Cause**: Clear explanation of why the bug occurred
2. **Evidence**: What pointed you to this cause
3. **Fix**: Specific code change with before/after
4. **Testing**: How to verify the fix
5. **Prevention**: How to avoid similar issues

Focus on fixing the underlying problem, not just the symptoms.`,
  },

  "test-writer": {
    name: "Test Writer",
    description: "Test generation expert. Use to create comprehensive test suites with high coverage.",
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are an expert test engineer specializing in comprehensive test coverage and testing best practices.

## When Invoked

1. Analyze the code to be tested
2. Identify all testable units and edge cases
3. Generate comprehensive test suite
4. Run tests to verify they pass

## Testing Strategy

### Unit Tests
- Test individual functions in isolation
- Mock external dependencies
- Cover happy path and error cases
- Test boundary conditions

### Integration Tests
- Test component interactions
- Verify data flow between modules
- Test with realistic configurations

### Edge Cases to Cover
- Empty inputs (null, undefined, [], {})
- Boundary values (0, -1, MAX_INT)
- Invalid types
- Concurrent operations
- Error conditions

## Test Structure

\`\`\`typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('should handle normal input', () => {
      // Arrange - setup
      // Act - execute
      // Assert - verify
    });

    it('should handle edge case', () => { ... });
    it('should throw on invalid input', () => { ... });
  });
});
\`\`\`

## Output Format

For each test file:
1. Import statements and setup
2. Grouped test suites by functionality
3. Clear test descriptions
4. Proper assertions with helpful messages
5. Cleanup/teardown as needed

Aim for high coverage but prioritize meaningful tests over metric chasing.`,
  },

  "refactorer": {
    name: "Refactorer",
    description: "Code refactoring and optimization expert. Use to improve code structure without changing behavior.",
    tools: ["Read", "Edit", "Bash", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are an expert in code refactoring, focusing on improving structure while preserving behavior.

## When Invoked

1. Analyze the current code structure
2. Identify refactoring opportunities
3. Plan changes carefully
4. Execute incrementally with verification

## Refactoring Principles

### SOLID Principles
- **S**ingle Responsibility - one reason to change
- **O**pen/Closed - open for extension, closed for modification
- **L**iskov Substitution - subtypes must be substitutable
- **I**nterface Segregation - specific interfaces over general
- **D**ependency Inversion - depend on abstractions

### DRY (Don't Repeat Yourself)
- Extract common code into reusable functions
- Create shared utilities for repeated patterns
- Use composition over duplication

### Clean Code
- Meaningful names that reveal intent
- Small, focused functions
- Comments explain "why", not "what"
- Consistent formatting

## Safe Refactoring Process

1. **Ensure test coverage exists**
2. Make small, incremental changes
3. Run tests after each change
4. Commit frequently
5. Review diff before finalizing

## Common Refactorings

- Extract Method/Function
- Extract Variable
- Rename for clarity
- Inline temporary variables
- Replace conditionals with polymorphism
- Introduce parameter objects
- Replace magic numbers with constants

## Output Format

For each refactoring:
1. What: Describe the change
2. Why: Explain the benefit
3. Before/After: Show code comparison
4. Risk: Note any concerns
5. Testing: Verify behavior unchanged`,
  },

  "documenter": {
    name: "Documenter",
    description: "Documentation expert. Use to generate comprehensive docs, comments, and API documentation.",
    tools: ["Read", "Write", "Edit", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are a technical documentation expert skilled at creating clear, comprehensive documentation.

## When Invoked

1. Analyze the code structure
2. Identify documentation needs
3. Generate appropriate documentation
4. Ensure consistency in style

## Documentation Types

### Code Comments
- JSDoc/TSDoc for functions and classes
- Inline comments for complex logic
- TODO/FIXME for future work

### README Files
- Project overview
- Installation instructions
- Usage examples
- Configuration options
- Contributing guidelines

### API Documentation
- Endpoint descriptions
- Request/response formats
- Authentication requirements
- Error codes and handling

## JSDoc Format

\`\`\`typescript
/**
 * Brief description of what the function does.
 *
 * @param {string} name - Description of parameter
 * @param {Object} options - Configuration options
 * @param {boolean} options.verbose - Enable verbose output
 * @returns {Promise<Result>} Description of return value
 * @throws {Error} When something goes wrong
 * @example
 * const result = await myFunction('test', { verbose: true });
 */
\`\`\`

## Documentation Principles

- Write for your audience (developer, user, admin)
- Keep it up to date with code changes
- Use examples liberally
- Be concise but complete
- Structure for scanning/skimming

## Output Format

Provide documentation that is:
1. Accurate to the code
2. Complete but not verbose
3. Well-formatted and readable
4. Consistent in style
5. Includes working examples`,
  },

  "security-auditor": {
    name: "Security Auditor",
    description: "Security vulnerability analyst. Use to audit code for security issues and compliance.",
    tools: ["Read", "Grep", "Glob", "Bash"],
    model: "inherit",
    prompt: `You are a security expert specializing in code security audits and vulnerability analysis.

## When Invoked

1. Scan codebase for security patterns
2. Identify potential vulnerabilities
3. Assess severity and impact
4. Provide remediation guidance

## Security Checklist

### Authentication & Authorization
- [ ] Secure password handling (hashing, salting)
- [ ] Session management security
- [ ] JWT/token validation
- [ ] Role-based access control
- [ ] API key protection

### Input Validation
- [ ] SQL injection prevention
- [ ] XSS (Cross-Site Scripting) prevention
- [ ] Command injection prevention
- [ ] Path traversal prevention
- [ ] File upload validation

### Data Protection
- [ ] Encryption at rest
- [ ] Encryption in transit (TLS)
- [ ] Sensitive data logging prevention
- [ ] PII handling compliance
- [ ] Secrets management

### OWASP Top 10
- Injection
- Broken Authentication
- Sensitive Data Exposure
- XML External Entities (XXE)
- Broken Access Control
- Security Misconfiguration
- Cross-Site Scripting (XSS)
- Insecure Deserialization
- Using Components with Known Vulnerabilities
- Insufficient Logging & Monitoring

## Output Format

For each finding:

| Severity | Finding | Location |
|----------|---------|----------|
| CRITICAL | Description | file:line |

**Details:**
- Vulnerability: What the issue is
- Impact: What could happen
- Evidence: Code snippet showing the issue
- Remediation: How to fix it
- References: Links to more info`,
  },

  "performance-optimizer": {
    name: "Performance Optimizer",
    description: "Performance analysis expert. Use to identify bottlenecks and optimize code performance.",
    tools: ["Read", "Edit", "Bash", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are a performance optimization expert focused on identifying and resolving bottlenecks.

## When Invoked

1. Profile current performance
2. Identify bottlenecks
3. Propose optimizations
4. Measure improvement

## Performance Areas

### Algorithm Efficiency
- Time complexity analysis (Big O)
- Space complexity consideration
- Data structure selection
- Loop optimization

### Database Performance
- Query optimization
- Index usage
- N+1 query detection
- Connection pooling
- Caching strategies

### Frontend Performance
- Bundle size reduction
- Code splitting
- Lazy loading
- Image optimization
- Render optimization

### Backend Performance
- Response time
- Throughput
- Memory usage
- CPU utilization
- I/O optimization

## Common Optimizations

- Memoization/Caching
- Lazy evaluation
- Batch processing
- Async/parallel execution
- Connection reuse
- Compression
- CDN usage

## Analysis Process

1. **Measure first** - Get baseline metrics
2. **Profile** - Identify hotspots
3. **Analyze** - Understand root cause
4. **Optimize** - Make targeted changes
5. **Verify** - Measure improvement
6. **Document** - Record findings

## Output Format

For each optimization:
- Current: Baseline performance
- Issue: What's causing slowness
- Solution: Proposed fix
- Expected Improvement: Estimated gain
- Trade-offs: Any downsides`,
  },

  "api-designer": {
    name: "API Designer",
    description: "API design expert. Use for REST API design, endpoint structure, and API best practices.",
    tools: ["Read", "Write", "Edit", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are an expert API designer focused on creating clean, intuitive, and well-documented APIs.

## When Invoked

1. Analyze API requirements
2. Design endpoint structure
3. Define request/response formats
4. Document thoroughly

## REST API Best Practices

### URL Design
- Use nouns for resources: \`/users\`, \`/posts\`
- Use plural forms: \`/users\` not \`/user\`
- Nest for relationships: \`/users/{id}/posts\`
- Use hyphens for multi-word: \`/user-profiles\`
- Keep URLs lowercase

### HTTP Methods
- GET: Read resources
- POST: Create resources
- PUT: Replace resources
- PATCH: Update partial resources
- DELETE: Remove resources

### Status Codes
- 200: Success
- 201: Created
- 204: No Content
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 422: Validation Error
- 500: Server Error

### Response Format
\`\`\`json
{
  "data": { ... },
  "meta": {
    "total": 100,
    "page": 1,
    "perPage": 20
  },
  "links": {
    "self": "/api/users?page=1",
    "next": "/api/users?page=2"
  }
}
\`\`\`

### Error Format
\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}
\`\`\`

## API Documentation

Include:
- Endpoint description
- Authentication requirements
- Request parameters
- Request body schema
- Response schema
- Error codes
- Examples`,
  },

  "database-expert": {
    name: "Database Expert",
    description: "Database design and optimization expert. Use for schema design, queries, and migrations.",
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are a database expert specializing in schema design, query optimization, and data modeling.

## When Invoked

1. Analyze data requirements
2. Design/review schema
3. Optimize queries
4. Plan migrations

## Database Design Principles

### Normalization
- 1NF: Atomic values, no repeating groups
- 2NF: No partial dependencies
- 3NF: No transitive dependencies
- Know when to denormalize for performance

### Schema Design
- Clear naming conventions
- Appropriate data types
- Foreign key relationships
- Index strategy
- Constraints for data integrity

### Query Optimization
- Use indexes effectively
- Avoid SELECT *
- Limit result sets
- Use EXPLAIN/ANALYZE
- Optimize JOINs

## Common Patterns

### Soft Deletes
\`\`\`sql
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP NULL;
CREATE INDEX idx_users_not_deleted ON users (id) WHERE deleted_at IS NULL;
\`\`\`

### Timestamps
\`\`\`sql
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
\`\`\`

### UUID Primary Keys
\`\`\`sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
\`\`\`

## Migration Best Practices

1. Backward compatible changes first
2. Add before remove
3. Test rollback procedures
4. Use transactions
5. Handle large tables carefully
6. Schedule during low traffic`,
  },

  "devops-engineer": {
    name: "DevOps Engineer",
    description: "DevOps expert for CI/CD, Docker, Kubernetes, and infrastructure. Use for deployment and automation.",
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    model: "inherit",
    prompt: `You are a DevOps expert specializing in CI/CD, containerization, and infrastructure automation.

## When Invoked

1. Analyze infrastructure needs
2. Design/review pipelines
3. Containerize applications
4. Automate deployments

## CI/CD Best Practices

### Pipeline Stages
1. **Build**: Compile, install dependencies
2. **Test**: Unit, integration, e2e tests
3. **Scan**: Security, dependency checks
4. **Package**: Build containers/artifacts
5. **Deploy**: Stage, then production

### GitHub Actions Example
\`\`\`yaml
name: CI/CD
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test
      - run: npm run build
\`\`\`

## Docker Best Practices

### Dockerfile
\`\`\`dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
CMD ["node", "dist/index.js"]
\`\`\`

### Docker Compose
\`\`\`yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
\`\`\`

## Infrastructure Principles

- Infrastructure as Code (IaC)
- Immutable infrastructure
- Environment parity
- Secret management
- Monitoring and logging
- Disaster recovery
- Auto-scaling`,
  },
};

// AI-powered agent generation types
interface GeneratedAgent {
  name: string;
  slug: string;
  description: string;
  tools: string[];
  model: string;
  prompt: string;
}

interface AIGenerationResult {
  agents: GeneratedAgent[];
  reasoning: string;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["slug", "description", "tools", "model", "template", "prompt", "data", "generate"],
  boolean: ["global", "skip-sync", "skip-index", "list-templates", "help", "dry-run"],
  default: {
    model: "inherit",
    global: false,
    "skip-sync": false,
    "skip-index": false,
    "dry-run": false,
  },
  alias: {
    s: "slug",
    d: "description",
    t: "tools",
    m: "model",
    g: "global",
    p: "prompt",
    h: "help",
    "no-sync": "skip-sync",
    "no-index": "skip-index",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Agent - Create Claude Code agent definitions

Usage:
  skills run implementation-agent -- "<name>" [options]
  skills run implementation-agent -- --template <template> --slug <slug>
  skills run implementation-agent -- --generate "<prompt>"

Options:
  -s, --slug <name>         Slug identifier for the agent (required for manual creation)
  -d, --description <text>  When to invoke this agent
  -t, --tools <tools>       Comma-separated list of allowed tools
  -m, --model <model>       Model: sonnet, opus, haiku, inherit (default: inherit)
  --template <name>         Use a built-in template as base
  -p, --prompt <text>       Custom system prompt
  --data <json>             Full JSON configuration
  -g, --global              Save to ~/.claude/agents/ instead of project
  --no-sync, --skip-sync    Don't sync to .claude/agents/
  --no-index, --skip-index  Skip updating AGENTS.md index
  --list-templates          List all available templates
  --generate <prompt>       AI-powered agent generation from prompt
  --dry-run                 Preview generated agents without creating files
  -h, --help                Show this help

Templates:
  code-reviewer, debugger, test-writer, refactorer, documenter,
  security-auditor, performance-optimizer, api-designer,
  database-expert, devops-engineer

Examples:
  skills run implementation-agent -- "Code Reviewer" --slug code-reviewer
  skills run implementation-agent -- --template debugger --slug my-debugger
  skills run implementation-agent -- "Custom" --slug custom --tools "Read,Edit,Bash" --model sonnet
  skills run implementation-agent -- "Helper" --slug helper --global

  # AI-powered generation
  skills run implementation-agent -- --generate "I need agents for this e-commerce project"
  skills run implementation-agent -- --generate "Create a reviewer and debugger for this TypeScript API"
  skills run implementation-agent -- --generate "What agents would be useful for this Next.js app?" --dry-run
`);
  process.exit(0);
}

// List templates
if (args["list-templates"]) {
  console.log(`\nAvailable Agent Templates`);
  console.log(`=========================\n`);

  for (const [key, template] of Object.entries(TEMPLATES)) {
    console.log(`  ${key}`);
    console.log(`    ${template.description.substring(0, 70)}...`);
    console.log(`    Tools: ${template.tools.join(", ")}`);
    console.log();
  }

  console.log(`\nUsage: skills run implementation-agent -- --template <name> --slug <slug>`);
  process.exit(0);
}

// Get name (first positional argument)
const name = args._[0] as string;

// Check for template
const templateName = args.template as string;
let baseTemplate: AgentTemplate | null = null;

if (templateName) {
  if (!TEMPLATES[templateName]) {
    console.error(`Error: Unknown template "${templateName}"`);
    console.error(`Available templates: ${Object.keys(TEMPLATES).join(", ")}`);
    process.exit(1);
  }
  baseTemplate = TEMPLATES[templateName];
}

// Check for AI generation mode - skip validation if --generate is used
const isGenerateMode = !!args.generate;

// Require either name, template, or generate
if (!name && !baseTemplate && !isGenerateMode) {
  console.error("Error: Agent name, --template, or --generate is required");
  console.error('Usage: skills run implementation-agent -- "<name>" --slug <slug>');
  console.error("   or: skills run implementation-agent -- --template <template> --slug <slug>");
  console.error('   or: skills run implementation-agent -- --generate "<prompt>"');
  process.exit(1);
}

// Get slug (not required for generate mode)
const rawSlug = args.slug as string;

if (!rawSlug && !isGenerateMode) {
  console.error("Error: --slug is required");
  process.exit(1);
}

// Normalize slug (only if provided)
const slug = rawSlug ? rawSlug.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "") : "";

// Find .implementation directory
function findImplementationDir(): string | null {
  let currentDir = process.env.SKILLS_CWD || process.cwd();

  while (currentDir !== path.dirname(currentDir)) {
    const implDir = path.join(currentDir, ".implementation");
    if (fs.existsSync(implDir)) {
      return implDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

// Get project root (where .implementation is or cwd)
function getProjectRoot(): string {
  const implDir = findImplementationDir();
  if (implDir) {
    return path.dirname(implDir);
  }
  return process.env.SKILLS_CWD || process.cwd();
}

const implDir = findImplementationDir();
const isGlobal = args.global as boolean;

// For non-global agents, require .implementation directory
if (!isGlobal && !implDir) {
  console.error("Error: .implementation directory not found");
  console.error("Run 'skills run implementation-init' first to create the folder structure");
  console.error("Or use --global to create a global agent");
  process.exit(1);
}

// Output directories
const outputDir = isGlobal ? null : path.join(implDir!, "data", "agents");
const claudeAgentsDir = isGlobal
  ? path.join(os.homedir(), ".claude", "agents")
  : path.join(getProjectRoot(), ".claude", "agents");

// Ensure directories exist
if (outputDir && !fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

if (!args["skip-sync"] && !fs.existsSync(claudeAgentsDir)) {
  fs.mkdirSync(claudeAgentsDir, { recursive: true });
}

// Get next sequence number
function getNextSequence(): number {
  if (!outputDir || !fs.existsSync(outputDir)) return 1;

  const files = fs.readdirSync(outputDir);
  let maxSeq = 0;

  for (const file of files) {
    const match = file.match(/^agent_(\d{5})_/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  return maxSeq + 1;
}

const sequence = getNextSequence();
const agentId = `agent_${String(sequence).padStart(5, "0")}`;
const timestamp = new Date().toISOString().split("T")[0];

// Parse JSON data if provided
let jsonData: AgentJsonData | undefined;
if (args.data) {
  try {
    jsonData = JSON.parse(args.data as string);
  } catch (e) {
    console.error("Error: Invalid JSON data provided");
    process.exit(1);
  }
}

// Build agent data
const agentName = name || baseTemplate?.name || slug;
const description = args.description || jsonData?.description || baseTemplate?.description || `Agent for ${agentName}`;

// Parse tools
let tools: string[] = [];
if (args.tools) {
  tools = (args.tools as string).split(",").map((t) => t.trim());
} else if (jsonData?.tools) {
  tools = jsonData.tools;
} else if (baseTemplate?.tools) {
  tools = baseTemplate.tools;
}

// Get model
const model = args.model || jsonData?.model || baseTemplate?.model || "inherit";

// Get permission mode
const permissionMode = jsonData?.permissionMode || "default";

// Get skills
const skills = jsonData?.skills || [];

// Build prompt
let prompt: string;
if (args.prompt) {
  prompt = args.prompt as string;
} else if (baseTemplate?.prompt) {
  prompt = baseTemplate.prompt;
} else if (jsonData?.sections) {
  // Build from sections
  const parts: string[] = [];
  for (const section of jsonData.sections) {
    parts.push(`## ${section.title}\n`);
    if (section.content) {
      parts.push(section.content + "\n");
    }
    if (section.items) {
      for (const item of section.items) {
        parts.push(`- ${item}`);
      }
      parts.push("");
    }
  }
  prompt = parts.join("\n");
} else {
  prompt = `You are ${agentName}, a specialized AI assistant.

## When Invoked

1. Analyze the request carefully
2. Gather necessary context from the codebase
3. Execute the task systematically
4. Verify your work

## Guidelines

- Focus on the specific task at hand
- Use available tools effectively
- Provide clear, actionable output
- Ask for clarification if needed`;
}

const agentData: AgentData = {
  id: agentId,
  slug,
  name: agentName,
  description,
  tools,
  model,
  permissionMode,
  skills,
  prompt,
  created: timestamp,
  updated: timestamp,
  isGlobal,
  jsonData,
};

// Generate Claude Code agent markdown
function generateClaudeAgentMarkdown(data: AgentData): string {
  let content = `---\n`;
  content += `name: ${data.slug}\n`;
  content += `description: ${data.description}\n`;

  if (data.tools.length > 0) {
    content += `tools: ${data.tools.join(", ")}\n`;
  }

  if (data.model && data.model !== "inherit") {
    content += `model: ${data.model}\n`;
  }

  if (data.permissionMode && data.permissionMode !== "default") {
    content += `permissionMode: ${data.permissionMode}\n`;
  }

  if (data.skills.length > 0) {
    content += `skills: ${data.skills.join(", ")}\n`;
  }

  content += `---\n\n`;
  content += data.prompt;
  content += "\n";

  return content;
}

// Generate archived agent markdown (with metadata)
function generateArchivedMarkdown(data: AgentData): string {
  let content = `# Agent: ${data.name}\n\n`;

  content += `- **ID**: ${data.id}\n`;
  content += `- **Slug**: ${data.slug}\n`;
  content += `- **Description**: ${data.description}\n`;

  if (data.tools.length > 0) {
    content += `- **Tools**: ${data.tools.join(", ")}\n`;
  }

  content += `- **Model**: ${data.model}\n`;

  if (data.skills.length > 0) {
    content += `- **Skills**: ${data.skills.join(", ")}\n`;
  }

  content += `- **Global**: ${data.isGlobal ? "Yes" : "No"}\n`;
  content += `- **Created**: ${data.created}\n`;
  content += `- **Updated**: ${data.updated}\n`;

  content += `\n---\n\n`;
  content += `## System Prompt\n\n`;
  content += "```markdown\n";
  content += data.prompt;
  content += "\n```\n";

  content += `\n## Claude Code Format\n\n`;
  content += "```markdown\n";
  content += generateClaudeAgentMarkdown(data);
  content += "```\n";

  return content;
}

// Update index file
function updateIndex(data: AgentData, filename: string): void {
  if (!implDir) return;

  const indexPath = path.join(implDir, "data", "indexes", "AGENTS.md");

  if (!fs.existsSync(indexPath)) {
    // Create the index file if it doesn't exist
    const indexContent = `# Agents Index

Project: ${path.basename(getProjectRoot())}
Created: ${timestamp}

## Overview

This file indexes all agent definitions in this implementation.

## Agents

| ID | File | Name | Slug | Global | Created |
|----|------|------|------|--------|---------|
| - | - | No agents yet | - | - | - |

---

*Updated automatically by implementation-agent skill*
`;
    fs.writeFileSync(indexPath, indexContent);
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  const globalStr = data.isGlobal ? "Yes" : "No";
  const newRow = `| ${data.id} | ${filename} | ${data.name} | ${data.slug} | ${globalStr} | ${data.created} |`;

  if (content.includes("| - | - | No agents yet | - | - | - |")) {
    content = content.replace("| - | - | No agents yet | - | - | - |", newRow);
  } else {
    const tableMatch = content.match(/(## Agents[\s\S]*?\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|)/);
    if (tableMatch) {
      const insertPoint = tableMatch.index! + tableMatch[0].length;
      content = content.slice(0, insertPoint) + "\n" + newRow + content.slice(insertPoint);
    }
  }

  content = content.replace(/\*Updated.*\*/, `*Updated: ${timestamp}*`);
  fs.writeFileSync(indexPath, content);
}

// AI-powered agent generation
async function gatherProjectContext(projectRoot: string): Promise<string> {
  const contextParts: string[] = [];
  const maxFileSize = 50000; // 50KB max per file

  // Key files to read for project understanding
  const keyFiles = [
    "package.json",
    "README.md",
    "CLAUDE.md",
    ".claude/settings.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
  ];

  for (const file of keyFiles) {
    const filePath = path.join(projectRoot, file);
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < maxFileSize) {
          const content = fs.readFileSync(filePath, "utf-8");
          contextParts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
        }
      } catch (e) {
        // Skip unreadable files
      }
    }
  }

  // Get directory structure (limited depth)
  const structure = getDirectoryStructure(projectRoot, 3);
  contextParts.push(`### Directory Structure\n\`\`\`\n${structure}\n\`\`\``);

  // Sample some source files
  const srcDirs = ["src", "lib", "app", "pages", "components"];
  let sampleFiles = 0;
  const maxSamples = 5;

  for (const dir of srcDirs) {
    const dirPath = path.join(projectRoot, dir);
    if (fs.existsSync(dirPath) && sampleFiles < maxSamples) {
      const files = fs.readdirSync(dirPath).filter((f) =>
        f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") ||
        f.endsWith(".py") || f.endsWith(".go") || f.endsWith(".rs")
      ).slice(0, maxSamples - sampleFiles);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.size < maxFileSize) {
            const content = fs.readFileSync(filePath, "utf-8");
            // Only include first 100 lines
            const preview = content.split("\n").slice(0, 100).join("\n");
            contextParts.push(`### ${dir}/${file} (preview)\n\`\`\`\n${preview}\n\`\`\``);
            sampleFiles++;
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    }
  }

  return contextParts.join("\n\n");
}

function getDirectoryStructure(dir: string, maxDepth: number, currentDepth = 0, prefix = ""): string {
  if (currentDepth >= maxDepth) return "";

  const items: string[] = [];
  const ignoreDirs = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", "target", "vendor"];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const filtered = entries.filter((e) => !ignoreDirs.includes(e.name) && !e.name.startsWith("."));

    for (let i = 0; i < filtered.length && i < 20; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1 || i === 19;
      const connector = isLast ? "└── " : "├── ";
      const nextPrefix = prefix + (isLast ? "    " : "│   ");

      items.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);

      if (entry.isDirectory()) {
        const subStructure = getDirectoryStructure(
          path.join(dir, entry.name),
          maxDepth,
          currentDepth + 1,
          nextPrefix
        );
        if (subStructure) items.push(subStructure);
      }
    }

    if (filtered.length > 20) {
      items.push(`${prefix}└── ... (${filtered.length - 20} more items)`);
    }
  } catch (e) {
    // Skip unreadable directories
  }

  return items.join("\n");
}

async function generateAgentsWithAI(userPrompt: string, projectRoot: string): Promise<AIGenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required for AI generation.\n" +
      "Set it with: export ANTHROPIC_API_KEY=your_key"
    );
  }

  console.log("Gathering project context...");
  const projectContext = await gatherProjectContext(projectRoot);

  console.log("Analyzing project with AI...");

  const systemPrompt = `You are an expert at creating Claude Code agents. You analyze projects and create specialized AI agents that help developers work more efficiently.

When creating agents, follow these principles:
1. Each agent should have a clear, focused purpose
2. Agent descriptions should explain WHEN to use the agent (proactively)
3. Tools should be limited to what's necessary
4. Prompts should be detailed and actionable
5. Agents should follow best practices for their domain

Available tools for agents:
- Read: Read files
- Edit: Edit files
- Write: Write new files
- Bash: Run shell commands
- Grep: Search file contents
- Glob: Find files by pattern
- WebFetch: Fetch web content
- WebSearch: Search the web
- Task: Delegate to sub-agents
- LSP: Language server features
- NotebookEdit: Edit Jupyter notebooks

Available models: sonnet (balanced), opus (most capable), haiku (fast), inherit (parent model)`;

  const userMessage = `Analyze this project and create appropriate Claude Code agents based on the user's request.

User request: "${userPrompt}"

Project context:
${projectContext}

Create agents that would be most useful for this specific project. Consider:
- The project's tech stack and languages
- Common development workflows
- Potential pain points the user might face
- Best practices for the domain

Respond with JSON in this exact format:
{
  "agents": [
    {
      "name": "Agent Name",
      "slug": "agent-slug",
      "description": "When to use this agent - written as: Use proactively when...",
      "tools": ["Read", "Edit", "Bash"],
      "model": "inherit",
      "prompt": "Detailed multi-line system prompt for the agent..."
    }
  ],
  "reasoning": "Brief explanation of why you chose these agents"
}

Create between 2-5 agents that would be most valuable for this project.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        temperature: 0.7,
        messages: [
          { role: "user", content: userMessage }
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    const content = data.content?.[0]?.text || "";

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response - no JSON found");
    }

    const result = JSON.parse(jsonMatch[0]) as AIGenerationResult;
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`AI generation failed: ${error.message}`);
    }
    throw error;
  }
}

// Main execution with AI generation support
async function mainWithGenerate(): Promise<void> {
  console.log(`\nImplementation Agent - AI Generation Mode`);
  console.log(`==========================================\n`);

  const generatePrompt = args.generate as string;
  const projectRoot = process.env.SKILLS_CWD || process.cwd();
  const isDryRun = args["dry-run"] as boolean;

  console.log(`Project: ${path.basename(projectRoot)}`);
  console.log(`Prompt: "${generatePrompt}"`);
  if (isDryRun) {
    console.log(`Mode: Dry run (no files will be created)\n`);
  } else {
    console.log();
  }

  // Generate agents
  const result = await generateAgentsWithAI(generatePrompt, projectRoot);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`\nAI Analysis:`);
  console.log(`${result.reasoning}\n`);
  console.log(`Generated ${result.agents.length} agents:\n`);

  // Display agents
  for (const agent of result.agents) {
    console.log(`  ${agent.name} (${agent.slug})`);
    console.log(`    ${agent.description.substring(0, 70)}...`);
    console.log(`    Tools: ${agent.tools.join(", ")}`);
    console.log();
  }

  if (isDryRun) {
    console.log(`Dry run complete. No files created.`);
    console.log(`Remove --dry-run to create these agents.`);
    return;
  }

  // Create the agents
  console.log(`Creating agents...`);

  const localImplDir = findImplementationDir();
  const localProjectRoot = localImplDir ? path.dirname(localImplDir) : projectRoot;
  const localClaudeAgentsDir = args.global
    ? path.join(os.homedir(), ".claude", "agents")
    : path.join(localProjectRoot, ".claude", "agents");

  // Ensure directories exist
  if (!fs.existsSync(localClaudeAgentsDir)) {
    fs.mkdirSync(localClaudeAgentsDir, { recursive: true });
  }

  let localOutputDir: string | null = null;
  if (!args.global && localImplDir) {
    localOutputDir = path.join(localImplDir, "data", "agents");
    if (!fs.existsSync(localOutputDir)) {
      fs.mkdirSync(localOutputDir, { recursive: true });
    }
  }

  // Get starting sequence number
  let localSequence = 1;
  if (localOutputDir && fs.existsSync(localOutputDir)) {
    const files = fs.readdirSync(localOutputDir);
    for (const file of files) {
      const match = file.match(/^agent_(\d{5})_/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq >= localSequence) localSequence = seq + 1;
      }
    }
  }

  const localTimestamp = new Date().toISOString().split("T")[0];

  for (const agent of result.agents) {
    const localAgentId = `agent_${String(localSequence).padStart(5, "0")}`;

    const localAgentData: AgentData = {
      id: localAgentId,
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      tools: agent.tools,
      model: agent.model,
      permissionMode: "default",
      skills: [],
      prompt: agent.prompt,
      created: localTimestamp,
      updated: localTimestamp,
      isGlobal: args.global as boolean,
    };

    // Generate Claude Code agent file
    const claudeAgentContent = generateClaudeAgentMarkdown(localAgentData);
    const claudeAgentPath = path.join(localClaudeAgentsDir, `${agent.slug}.md`);

    if (!args["skip-sync"]) {
      fs.writeFileSync(claudeAgentPath, claudeAgentContent);
      console.log(`  Created: ${claudeAgentPath}`);
    }

    // Generate archived file (only for non-global)
    if (localOutputDir) {
      const archiveFilename = `${localAgentId}_${agent.slug.replace(/-/g, "_")}.md`;
      const archivePath = path.join(localOutputDir, archiveFilename);
      const archivedContent = generateArchivedMarkdown(localAgentData);
      fs.writeFileSync(archivePath, archivedContent);

      // Update index
      if (!args["skip-index"] && localImplDir) {
        updateIndex(localAgentData, archiveFilename);
      }
    }

    localSequence++;
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`\nSuccessfully created ${result.agents.length} agents!`);
  console.log(`\nUsage in Claude Code:`);
  for (const agent of result.agents) {
    console.log(`  > Use the ${agent.slug} agent to...`);
  }
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Agent`);
  console.log(`====================\n`);

  // Generate Claude Code agent file
  const claudeAgentContent = generateClaudeAgentMarkdown(agentData);
  const claudeAgentPath = path.join(claudeAgentsDir, `${slug}.md`);

  if (!args["skip-sync"]) {
    fs.writeFileSync(claudeAgentPath, claudeAgentContent);
    console.log(`Created Claude agent: ${claudeAgentPath}`);
  }

  // Generate archived file (only for non-global)
  let archiveFilename = "";
  if (outputDir) {
    archiveFilename = `${agentId}_${slug.replace(/-/g, "_")}.md`;
    const archivePath = path.join(outputDir, archiveFilename);
    const archivedContent = generateArchivedMarkdown(agentData);
    fs.writeFileSync(archivePath, archivedContent);
    console.log(`Created archive: ${archivePath}`);
  }

  console.log(`\nAgent Details:`);
  console.log(`  ID: ${agentData.id}`);
  console.log(`  Name: ${agentData.name}`);
  console.log(`  Slug: ${agentData.slug}`);
  console.log(`  Description: ${agentData.description.substring(0, 60)}...`);

  if (agentData.tools.length > 0) {
    console.log(`  Tools: ${agentData.tools.join(", ")}`);
  }

  console.log(`  Model: ${agentData.model}`);
  console.log(`  Global: ${agentData.isGlobal ? "Yes" : "No"}`);

  if (baseTemplate) {
    console.log(`  Template: ${templateName}`);
  }

  // Update index
  if (!args["skip-index"] && !isGlobal && outputDir) {
    console.log(`\nUpdating AGENTS.md index...`);
    updateIndex(agentData, archiveFilename);
    console.log(`Index updated.`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nAgent created successfully!`);

  if (!args["skip-sync"]) {
    console.log(`\nUsage in Claude Code:`);
    console.log(`  > Use the ${slug} agent to...`);
    console.log(`  > Have ${slug} review my code`);
  }
}

// Entry point - route to appropriate mode
if (args.generate) {
  mainWithGenerate().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
