# Skills

Open source library of 272 AI agent skills. Install any skill with a single command.

## Quick Start

```bash
# Interactive mode - browse and select skills
npx @hasna/skills

# Install specific skills
npx @hasna/skills install deep-research image generate-pdf

# List all available skills
npx @hasna/skills list
```

## Installation

```bash
# Global install
bun install -g @hasna/skills

# Or use npx (no install needed)
npx @hasna/skills
```

## Usage

### Interactive Mode

Run without arguments to browse skills by category:

```bash
skills
```

### Install Skills

```bash
# Install one or more skills
skills install deep-research image generate-pdf

# Skills are installed to .skills/ in your project
```

### Search

```bash
# Search by name, description, or tags
skills search payment
skills search ai
```

### List by Category

```bash
skills list --category "Development Tools"
skills list --category "Content Generation"
```

### Remove

```bash
skills remove deep-research
```

## Available Skills (272)

### Development Tools (48)
| Skill | Description |
|-------|-------------|
| api-test-suite | Generate and run API test suites with comprehensive endpoint coverage |
| apidocs | Agentic web crawler for API documentation indexing and semantic search |
| architecture-docs | Generate architecture documentation for software projects |
| auto-format | Automatically format code and documents according to style guidelines |
| chromedevtools | Browser automation and debugging with Chrome DevTools Protocol |
| codefix | Code quality CLI for auto-linting, formatting, and fixing code issues |
| consolelog | Monitor console logs from web applications using Playwright headless browser |
| context7 | Access up-to-date library documentation and code examples |
| database-explorer | Explore and query databases with an interactive interface |
| debug | Debugging skill for investigating and resolving code issues |
| deploy | Deployment CLI for managing EC2 deployments with automated health checks |
| diff-viewer | View and analyze file differences with visual diff representation |
| dns-manager | Manage DNS records, zones, and domain configurations |
| e2bswarm | Spawn E2B sandbox instances for parallel Claude Code task execution |
| filesearch | Advanced search inside repositories and file systems |
| generate-api-client | Generate API client libraries from OpenAPI specs and documentation |
| generate-ci-config | Generate CI/CD configuration files for GitHub Actions, GitLab CI, and more |
| generate-dockerfile | Generate optimized Dockerfiles for containerized applications |
| generate-documentation | Generate comprehensive project documentation from codebase analysis |
| generate-env | Generate environment variable files from templates and configurations |
| generate-mock-data | Generate realistic mock data for testing and development |
| generate-pr-description | Generate pull request descriptions from code diffs and commit history |
| generate-readme | Generate README files from project structure and code analysis |
| generate-regex | Generate regular expressions from natural language descriptions |
| generate-sitemap | Generate XML sitemaps for websites and web applications |
| generate-sql | Generate SQL queries and database schemas from natural language |
| get-api-docs | Fetch and parse API documentation from online sources |
| github-manager | Manage GitHub repositories, issues, PRs, and workflows |
| hook | Claude Code hook creation skill - generates standardized hook scaffolds |
| http-server | Spin up local HTTP servers for development and testing |
| lorem-generator | Generate placeholder text in various styles and lengths |
| managehook | Manage Claude Code hooks with install, configure, and lifecycle operations |
| managemcp | Manage MCP servers with install, configure, and lifecycle operations |
| manageskill | Manage Claude Code skills with install, configure, and lifecycle operations |
| markdown-validator | Validate markdown files for syntax, links, and formatting issues |
| mcp-builder | Build MCP server packages with standardized structure and tooling |
| npmpublish | Publish npm packages with sensible defaults: private access, patch version bumps |
| playwright | End-to-end testing and browser automation with Playwright |
| projectbuild | Build and compile projects with standardized build pipelines |
| prompt | CLI and API service for managing prompts for Claude Code and Codex CLI |
| regex-tester | Test and validate regular expressions with sample inputs |
| scaffold-project | Scaffold new projects with standardized structure and boilerplate |
| secrets | Secure secrets management with CLI, API, and temporary sharing |
| security-audit | Perform security audits on codebases and infrastructure configurations |
| shadcn | Manage shadcn/ui components and component registry |
| shadcn-theme | Generate and customize shadcn/ui themes with color configurations |
| terraform-generator | Generate Terraform infrastructure-as-code configurations |
| validate-config | Validate configuration files for syntax and schema compliance |

### Business & Marketing (27)
| Skill | Description |
|-------|-------------|
| ad-creative-generator | Generate ad creatives with copy, visuals, and layouts for marketing campaigns |
| banner-ad-suite | Create banner ad sets in multiple sizes for display advertising campaigns |
| campaign-metric-brief | Generate campaign performance metric briefs and analytics summaries |
| campaign-moodboard | Create visual moodboards for marketing and creative campaigns |
| caption-style-stylist | Style and format captions for social media and video content |
| churn-risk-notifier | Identify and notify about customer churn risk indicators |
| competitor-ad-analyzer | Analyze competitor advertising strategies, creatives, and messaging |
| crm-note-enhancer | Enhance CRM notes with structured summaries and action items |
| customer-journey-mapper | Map and visualize customer journey touchpoints and experiences |
| email-campaign | Design and create email marketing campaigns with templates and sequences |
| feedback-survey-designer | Design feedback surveys with optimized questions and response formats |
| generate-social-posts | Generate social media posts optimized for different platforms |
| landing-page-copy | Write conversion-optimized landing page copy with headlines and CTAs |
| newsletter-campaign-planner | Plan newsletter campaigns with content calendar and audience segmentation |
| onboarding-sequence-builder | Build employee or customer onboarding sequences with steps and milestones |
| outreach-cadence-designer | Design multi-touch outreach cadences for sales and marketing campaigns |
| partner-kit-assembler | Assemble partner kits with brand assets, guidelines, and marketing materials |
| persona-based-adwriter | Write targeted ads based on customer persona profiles |
| persona-generator | Generate detailed customer and user personas for marketing and UX |
| product-demo-script | Write product demo scripts with talking points and flow |
| sales-call-recapper | Recap sales calls with key points, objections, and follow-up actions |
| salescopy | Generate persuasive sales copy using AI for products and services |
| seo-brief-builder | Build SEO content briefs with keyword research and competitive analysis |
| social-media-kit | Create social media kits with graphics, templates, and brand guidelines |
| social-template-kit | Generate social media post templates with customizable layouts |
| sponsorship-proposal-lab | Create sponsorship proposals with packages, ROI projections, and benefits |
| webinar-script-coach | Coach and refine webinar scripts with engagement tips and flow optimization |

### Productivity & Organization (22)
| Skill | Description |
|-------|-------------|
| brainstorm | Flood sub-agents to generate diverse ideas and solutions for any topic |
| calculate | Perform calculations, unit conversions, and mathematical operations |
| companyguide | Access company-related guides and documentation |
| convert | File format conversion CLI with AI-powered extraction between images, PDFs, documents, and data formats |
| decision-journal | Track and reflect on decisions with structured journaling |
| download | Download files from URLs with progress tracking and resume support |
| file-organizer | Organize files into structured directories based on type, date, or content |
| fill | Auto-fill forms and templates with structured data |
| folder-tree | Generate and display folder tree structures for documentation |
| form-filler | Automatically fill out web forms and document templates |
| googledrive | Manage Google Drive files and folders with upload, download, and search |
| inbox-priority-planner | Prioritize and organize email inbox items by importance and urgency |
| meeting-insight-summarizer | Summarize meetings with key insights, decisions, and action items |
| merge-pdfs | Merge multiple PDF files into a single document |
| notion | Manage Notion workspace, pages, databases, and content |
| notion-manager | Advanced Notion management with templates, automation, and bulk operations |
| personal-daily-ops | Manage personal daily operations with routines, tasks, and priorities |
| remember | Persistent memory across sessions - store context, preferences, decisions |
| schedule | Schedule tasks, events, and reminders with time management |
| split-pdf | Split PDF documents into separate pages or sections |
| sync | Synchronize files and data between local and remote locations |
| time-blocking-orchestrator | Orchestrate time-blocked schedules with focus periods and breaks |

### Project Management (18)
| Skill | Description |
|-------|-------------|
| action-item-router | Route and assign action items from meetings or documents to appropriate owners |
| businessactivity | Business activity, workflow, and ownership management service |
| delegation-brief-writer | Write clear delegation briefs with context, expectations, and deadlines |
| goal-quarterly-roadmap | Create quarterly goal roadmaps with milestones and tracking |
| implementation | Create .implementation scaffold for project development tracking |
| implementation-agent | AI agent for managing implementation workflows and task execution |
| implementation-architecture | Generate architecture plans for implementation projects |
| implementation-audit | Audit implementation progress against plans and specifications |
| implementation-cost | Estimate and track implementation costs for projects |
| implementation-dispatch | Dispatch and coordinate implementation tasks across team members |
| implementation-hook | Lifecycle hooks for implementation tracking and automation |
| implementation-index | Index and catalog implementation artifacts and deliverables |
| implementation-init | Initialize new implementation projects with standard structure |
| implementation-memento | Save and restore implementation state snapshots for recovery |
| implementation-plan | Generate detailed implementation plans with phases and milestones |
| implementation-todo | Manage implementation task lists and todo items |
| linear | Work with Linear issues, projects, and workflows |
| project-retro-companion | Facilitate project retrospectives with structured reflection and action items |

### Content Generation (17)
| Skill | Description |
|-------|-------------|
| audio | Generate high-quality audio using AI-powered text-to-speech APIs |
| audiobook-chapter-proofer | Proofread and validate audiobook chapters for consistency and quality |
| emoji | Generate complete emoji packs using AI with DALL-E 3 or Gemini |
| generate-audio | Generate audio with AI including speech synthesis and sound creation |
| generate-diagram | Generate diagrams including flowcharts, sequence diagrams, and system architecture |
| generate-docx | Generate DOCX documents with formatted content and styling |
| generate-excel | Generate Excel spreadsheets with formatted data, formulas, and charts |
| generate-pdf | Generate PDF documents with rich formatting and layouts |
| generate-presentation | Generate presentation decks with slides, content, and visuals |
| generate-qrcode | Generate QR codes with custom styling and embedded data |
| generate-resume | Generate professional resumes with formatting and content optimization |
| generate-slides | Generate slide presentations with structured content and layouts |
| image | Generate images using multiple AI providers: DALL-E 3, Imagen 3, and Aurora |
| jingle-composer | Compose advertising jingles and short musical pieces for brands |
| video | Generate videos using AI models from Google Veo, OpenAI Sora, and Runway |
| voiceover | Generate voiceovers using ElevenLabs and OpenAI TTS |
| voiceover-casting-assistant | Assist with voiceover casting by matching voice profiles to project needs |

### Finance & Compliance (17)
| Skill | Description |
|-------|-------------|
| budget-variance-analyzer | Analyze budget versus actual spending with variance reporting |
| compliance-copy-check | Check marketing copy for regulatory compliance and legal requirements |
| compliance-report-pack | Generate compliance report packages for regulatory submissions |
| contract-plainlanguage | Convert legal contracts into plain language summaries for easy understanding |
| extract-invoice | Extract structured data from invoice documents using AI |
| forecast-scenario-lab | Model business forecast scenarios with multiple variable assumptions |
| grant-application-drafter | Draft grant applications with structured proposals and budgets |
| grant-compliance-scanner | Scan grant applications for compliance with funding requirements |
| invoice | Generate professional invoices with company management and PDF export |
| invoice-dispute-helper | Assist with invoice disputes by analyzing charges and generating responses |
| payroll-change-prepper | Prepare payroll change documentation and calculations |
| procurement-scorecard | Generate procurement scorecards for vendor evaluation and comparison |
| proposal-redline-advisor | Review and redline proposals with suggested edits and negotiations |
| risk-disclosure-kit | Generate risk disclosure documents and compliance statements |
| roi-comparison-tool | Compare return on investment across different options and scenarios |
| subscription-spend-watcher | Track and analyze subscription spending with alerts and optimization tips |
| timesheet | Generate employee timesheets with multi-profile support |

### Data & Analysis (16)
| Skill | Description |
|-------|-------------|
| analyze-data | Data science insights for CSV and JSON datasets with statistical analysis |
| anomaly-investigator | Investigate and diagnose anomalies in data, logs, and system metrics |
| benchmark-finder | Find industry benchmarks and performance metrics for comparison analysis |
| csv-transformer | Transform, clean, and restructure CSV data files |
| dashboard-builder | Build data dashboards with charts, metrics, and visualizations |
| dashboard-narrator | Generate narrative summaries from dashboard data and metrics |
| data-anonymizer | Anonymize sensitive data in datasets for privacy compliance |
| dataset-health-check | Validate dataset quality with completeness, consistency, and accuracy checks |
| extract | Extract text and structured data from images and PDFs using OpenAI Vision |
| generate-chart | Generate data charts and visualizations from datasets |
| hubsearch | Search through S3 buckets for files and data |
| kpi-digest-generator | Generate KPI digest reports with trends, alerts, and performance summaries |
| parse-pdf | Parse and extract structured content from PDF documents |
| spreadsheet-cleanroom | Clean and sanitize spreadsheet data for analysis readiness |
| survey-insight-extractor | Extract actionable insights and trends from survey response data |
| transform | Transform data between formats, structures, and schemas |

### Media Processing (16)
| Skill | Description |
|-------|-------------|
| audio-cleanup-lab | Professional audio cleanup recipes with structured workflows for processing audio files |
| compress-video | Compress video files while preserving visual quality using ffmpeg |
| extract-audio | Extract audio tracks from video files with multiple format support |
| extract-frames | Extract frames from video files at specified intervals or timestamps |
| gif-maker | Create animated GIFs from images, videos, or screen recordings |
| highlight-reel-generator | Generate video highlight reels from longer content with key moments |
| image-enhancer | Enhance image quality with AI upscaling, denoising, and color correction |
| image-optimizer | Optimize images for web with compression and format conversion |
| remove-background | Remove backgrounds from images using AI segmentation |
| subtitle | Generate styled subtitles from audio using OpenAI Whisper |
| transcript | Generate transcripts from audio and video files with timestamps |
| video-cut-suggester | Suggest video cuts and edits based on content analysis and pacing |
| video-downloader | Download videos from various online platforms and services |
| video-thumbnail | Generate eye-catching video thumbnails with text overlays |
| videodownload | Download videos from YouTube, Vimeo, and other platforms |
| watermark | Add watermarks to images and documents for copyright protection |

### Design & Branding (15)
| Skill | Description |
|-------|-------------|
| brand-style-guide | Generate comprehensive brand style guides with visual identity guidelines |
| brand-voice-audit | Audit content for brand voice consistency and tone alignment |
| color-palette-harmonizer | Generate harmonious color palettes for design and branding projects |
| generate-book-cover | Generate professional book cover designs with AI |
| generate-favicon | Generate favicons in multiple sizes and formats for websites |
| icon | Generate and manage icon sets for applications and websites |
| logo-generator | Generate logo designs with AI for brands and projects |
| logo-variation-lab | Create logo variations for different contexts and applications |
| merch-mockup-factory | Create merchandise mockups for t-shirts, mugs, and other products |
| microcopy-generator | Generate UI microcopy including button text, tooltips, and error messages |
| packaging-concept-studio | Design product packaging concepts with mockups and specifications |
| presentation-theme-maker | Create custom presentation themes with color schemes and layouts |
| print-collateral-designer | Design print collateral including brochures, flyers, and business cards |
| product-mockup | Generate product mockups for visualization and marketing materials |
| testimonial-graphics | Create visual testimonial graphics for social proof and marketing |

### Web & Browser (14)
| Skill | Description |
|-------|-------------|
| browse | Browser automation using Browser-Use Cloud API for AI agents |
| browser-agent | Autonomous browser agent for complex web interactions and tasks |
| browseruse | AI-powered browser automation for complex web tasks |
| buygoodscrawl | BuyGoods.com crawler - login, scrape products, affiliates, and export data |
| competitoroffers | ClickBank competitor offers crawler service for scraping marketplace data |
| crawl | Web crawling skill for extracting content from websites |
| domainpurchase | Purchase and manage domains via Brandsight/GoDaddy API |
| domainsearch | Search domain availability and suggestions via GoDaddy/Brandsight API |
| exa | Advanced web search and code search using Exa AI |
| search | Search the web and aggregate results from multiple sources |
| shipofferscrawl | ShipOffers.com eTracker crawler for inventory, orders, shipments, and returns |
| webcrawling | Web crawling service using Firecrawl API for content extraction |
| websearch | Multi-tool web search combining multiple search engines and APIs |
| websitedownload | Download and analyze websites with AI-powered marketing funnel analysis |

### Research & Writing (13)
| Skill | Description |
|-------|-------------|
| blog-topic-cluster | Generate topic clusters and content strategies for blog SEO planning |
| copytone-translator | Translate copy between different tones and writing styles |
| create-blog-article | Create SEO-optimized blog articles with structured content |
| create-ebook | Create complete eBooks with chapters, formatting, and cover design |
| deep-research | Deep research skill for comprehensive topic investigation |
| deepresearch | Agentic deep research using Exa.ai for parallel semantic search and LLM synthesis |
| faq-packager | Package and organize frequently asked questions into structured documents |
| longform-structurer | Structure long-form content with outlines, chapters, and sections |
| podcast-show-notes | Generate podcast show notes with timestamps, summaries, and links |
| press-release-drafter | Draft professional press releases for announcements and media distribution |
| summarize | Summarize documents, articles, and text content into concise summaries |
| translate | Translate text between languages with context-aware AI translation |
| write | Write short or long-form content - articles, books, documentation at scale |

### Science & Academic (10)
| Skill | Description |
|-------|-------------|
| academic-journal-matcher | Match research papers to appropriate academic journals for submission |
| advanced-math | Solve advanced mathematical problems including calculus, algebra, and statistics |
| bio-sequence-tool | Analyze and manipulate biological sequences including DNA, RNA, and protein data |
| chemistry-calculator | Perform chemistry calculations including molecular weights, reactions, and stoichiometry |
| citation-formatter | Format academic citations in APA, MLA, Chicago, and other styles |
| experiment-power-calculator | Calculate statistical power and sample size for experiments |
| lab-notebook-formatter | Format laboratory notebook entries with structured scientific records |
| latex-table-generator | Generate formatted LaTeX tables from data for academic papers |
| scientific-figure-check | Validate scientific figures for accuracy, formatting, and publication standards |
| statistical-test-selector | Recommend appropriate statistical tests based on data and research questions |

### Education & Learning (10)
| Skill | Description |
|-------|-------------|
| classroom-newsletter-kit | Create classroom newsletters with templates for teachers and educators |
| educational-resource-finder | Find educational resources, courses, and learning materials by topic |
| exam-readiness-check | Assess exam readiness with practice questions and gap analysis |
| field-trip-planner | Plan educational field trips with logistics, safety, and learning objectives |
| homework-feedback-coach | Provide constructive feedback on homework assignments with improvement suggestions |
| learning-style-profiler | Profile individual learning styles and recommend personalized study strategies |
| lesson-plan-customizer | Customize lesson plans for different age groups, subjects, and learning objectives |
| parent-teacher-brief | Generate parent-teacher conference briefs with student progress summaries |
| scholarship-tracker | Track scholarship applications, deadlines, and requirements |
| study-guide-builder | Build comprehensive study guides with summaries, key concepts, and practice questions |

### Communication (9)
| Skill | Description |
|-------|-------------|
| calendar-events | Create, manage, and organize calendar events and scheduling |
| compose-gmail | Compose and draft Gmail messages with AI assistance |
| mail | Send, read, and manage emails across providers |
| manage-gmail | Manage Gmail with labels, filters, and inbox organization |
| message | Send messages via Slack, Discord, SMS, and chat platforms |
| notify | Send notifications across multiple channels and platforms |
| read-gmail | Read and search Gmail messages with advanced filtering |
| slack-assistant | Automate Slack interactions with message management and channel operations |
| sms | Send and receive SMS messages via Twilio |

### Health & Wellness (8)
| Skill | Description |
|-------|-------------|
| grocery-basket-optimizer | Optimize grocery shopping lists for budget, nutrition, and preferences |
| habit-reflection-digest | Generate habit tracking digests with reflection prompts and insights |
| meal-plan-designer | Design weekly meal plans with nutrition, recipes, and shopping lists |
| mindfulness-prompt-cache | Curate and deliver mindfulness prompts for meditation and relaxation |
| sleep-routine-analyzer | Analyze sleep patterns and provide improvement recommendations |
| stress-relief-playbook | Generate personalized stress relief strategies and relaxation techniques |
| wellness-progress-reporter | Generate wellness progress reports with health metrics and trends |
| workout-cycle-planner | Plan workout cycles with periodization, exercises, and progression |

### Travel & Lifestyle (7)
| Skill | Description |
|-------|-------------|
| destination-briefing | Create travel destination briefings with local info, tips, and logistics |
| family-activity-curator | Curate family-friendly activities based on age, interests, and location |
| household-maintenance-mgr | Track and schedule household maintenance tasks and reminders |
| itinerary-architect | Design detailed travel itineraries with activities, timing, and logistics |
| packing-plan-pro | Create detailed packing plans for trips with weather-based recommendations |
| pet-care-scheduler | Schedule and track pet care activities including feeding, walks, and vet visits |
| travel-budget-balancer | Balance travel budgets across categories with optimization suggestions |

### Event Management (5)
| Skill | Description |
|-------|-------------|
| guest-communication-suite | Manage guest communications for events, hospitality, and venues |
| livestream-runofshow | Create run-of-show documents for livestream events with timing and cues |
| onsite-ops-checklist | Create operational checklists for on-site events and activities |
| seating-chart-maker | Create seating charts for events, classrooms, and venues |
| vendor-comparison-coach | Compare vendors with scoring criteria and recommendation reports |

## Using Installed Skills

After installing, import from the `.skills` directory:

```typescript
import { deep_research, image } from './.skills';
```

Each skill provides:
- TypeScript source code
- CLI tool
- Programmatic API

## Installing Individual Skills

You can also install skills individually as npm packages:

```bash
# Install individual skill packages
bun install @hasna/skill-deep-research
bun install @hasna/skill-generate-image
```

## Skill Structure

Each skill follows a consistent structure:

```
skill-{name}/
├── src/
│   ├── commands/      # CLI commands
│   ├── lib/           # Core logic
│   ├── types/         # TypeScript types
│   └── utils/         # Utilities
├── CLAUDE.md          # Development guide
├── SKILL.md           # Skill definition
├── README.md          # Usage documentation
└── package.json
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## Contributing

1. Fork the repository
2. Create a new skill in `skills/skill-{name}/`
3. Follow the existing skill patterns
4. Submit a pull request

## License

MIT
