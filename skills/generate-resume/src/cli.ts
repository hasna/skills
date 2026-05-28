import { parseArgs } from "node:util";

export function parseArguments(): Record<string, any> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      // Contact
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      location: { type: "string" },
      website: { type: "string" },
      linkedin: { type: "string" },
      github: { type: "string" },
      portfolio: { type: "string" },
      twitter: { type: "string" },
      photo: { type: "string" },

      // Professional
      title: { type: "string" },
      summary: { type: "string" },

      // Sections (repeatable)
      experience: { type: "string", multiple: true },
      education: { type: "string", multiple: true },
      skill: { type: "string", multiple: true },
      project: { type: "string", multiple: true },
      certification: { type: "string", multiple: true },
      language: { type: "string", multiple: true },

      // Design
      template: { type: "string", default: "modern" },
      layout: { type: "string", default: "single-column" },
      color: { type: "string", default: "#2563eb" },
      font: { type: "string", default: "inter" },
      "font-size": { type: "string", default: "medium" },
      spacing: { type: "string", default: "normal" },
      "ats-friendly": { type: "boolean", default: false },
      "include-photo": { type: "boolean", default: false },
      "page-numbers": { type: "boolean", default: false },

      // Output
      output: { type: "string" },
      format: { type: "string", default: "pdf" },
      open: { type: "boolean", default: false },

      // Cover letter
      "cover-letter": { type: "boolean", default: false },
      company: { type: "string" },
      position: { type: "string" },
      "letter-content": { type: "string" },
      "letter-template": { type: "string", default: "standard" },

      // LinkedIn import
      "from-linkedin": { type: "string" },

      // Help
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });

  return values;
}

// Show help

export function showHelp() {
  console.log(`
Generate Resume - Create professional resumes and CVs

USAGE:
  skills run generate-resume -- [OPTIONS]

REQUIRED:
  --name <name>             Your full name

CONTACT:
  --email <email>           Email address
  --phone <phone>           Phone number
  --location <location>     City, State/Country
  --website <url>           Personal website
  --linkedin <url>          LinkedIn profile
  --github <url>            GitHub profile
  --portfolio <url>         Portfolio website
  --twitter <handle>        Twitter/X handle
  --photo <path>            Profile photo path

PROFESSIONAL:
  --title <title>           Professional title
  --summary <text>          Professional summary

EXPERIENCE (repeatable):
  --experience "Title|Company|Dates|Description"

EDUCATION (repeatable):
  --education "Degree|School|Dates|Details"

SKILLS (repeatable):
  --skill "SkillName|Level"  Level: 1-5

PROJECTS (repeatable):
  --project "Name|Description|URL"

CERTIFICATIONS (repeatable):
  --certification "Name|Year|Issuer"

LANGUAGES (repeatable):
  --language "Language|Proficiency"

DESIGN:
  --template <type>         modern|classic|minimal|creative|executive|technical
  --layout <type>           single-column|two-column|sidebar
  --color <hex>             Primary color (default: #2563eb)
  --font <name>             inter|roboto|lato|open-sans|poppins
  --font-size <size>        small|medium|large
  --spacing <size>          compact|normal|spacious
  --ats-friendly            Enable ATS optimization
  --include-photo           Include profile photo
  --page-numbers            Add page numbers

OUTPUT:
  --output <path>           Output file path
  --format <type>           pdf|html|markdown
  --open                    Open after generation

COVER LETTER:
  --cover-letter            Generate cover letter
  --company <name>          Company name
  --position <title>        Position title
  --letter-content <text>   Letter content
  --letter-template <type>  standard|modern|executive

LINKEDIN:
  --from-linkedin <path>    Import from LinkedIn JSON

EXAMPLES:
  # Basic resume
  skills run generate-resume -- \\
    --name "John Doe" \\
    --email "john@email.com" \\
    --title "Software Engineer"

  # Full resume
  skills run generate-resume -- \\
    --name "Jane Smith" \\
    --email "jane@email.com" \\
    --title "Senior Developer" \\
    --experience "Developer|Acme|2020-Present|Built features..." \\
    --education "BS CS|MIT|2016-2020|GPA: 3.8" \\
    --skill "JavaScript|5" \\
    --ats-friendly \\
    --output resume.pdf
`);
}

// Parse repeatable fields
