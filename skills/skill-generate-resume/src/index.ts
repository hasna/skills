#!/usr/bin/env bun

/**
 * Generate Resume Skill
 *
 * Creates professional resumes and CVs with customizable templates,
 * multiple formats, and ATS-friendly designs.
 */

import { parseArgs } from "node:util";

// =============================================================================
// Security: HTML Escaping to prevent XSS
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
 * This MUST be called on all user-provided data before HTML interpolation
 */
function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Sanitize a URL to prevent javascript: and data: URL injection
 * Only allows http:, https:, relative paths, and protocol-relative URLs
 */
function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  const lowerUrl = trimmed.toLowerCase();
  // Block dangerous protocols
  if (
    lowerUrl.startsWith("javascript:") ||
    lowerUrl.startsWith("data:") ||
    lowerUrl.startsWith("vbscript:")
  ) {
    return "";
  }
  // Allow safe protocols and relative URLs
  if (
    lowerUrl.startsWith("http://") ||
    lowerUrl.startsWith("https://") ||
    lowerUrl.startsWith("mailto:") ||
    lowerUrl.startsWith("tel:") ||
    lowerUrl.startsWith("/") ||
    !lowerUrl.includes(":")
  ) {
    return escapeHtml(trimmed);
  }
  return "";
}
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Types
interface Experience {
  title: string;
  company: string;
  dates: string;
  description: string;
}

interface Education {
  degree: string;
  school: string;
  dates: string;
  details?: string;
}

interface Skill {
  name: string;
  level: number;
}

interface Project {
  name: string;
  description: string;
  url?: string;
}

interface Certification {
  name: string;
  year: string;
  issuer?: string;
}

interface Language {
  name: string;
  proficiency: string;
}

interface ResumeData {
  // Contact
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  twitter?: string;
  photo?: string;

  // Professional
  title?: string;
  summary?: string;

  // Sections
  experience: Experience[];
  education: Education[];
  skills: Skill[];
  projects: Project[];
  certifications: Certification[];
  languages: Language[];

  // Design
  template: string;
  layout: string;
  color: string;
  font: string;
  fontSize: string;
  spacing: string;
  atsFriendly: boolean;
  includePhoto: boolean;
  pageNumbers: boolean;
}

interface CoverLetterData {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  company: string;
  position: string;
  content: string;
  template: string;
  date: string;
}

// Parse command line arguments
function parseArguments() {
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
function showHelp() {
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
function parseExperience(data: string[]): Experience[] {
  return data.map((item) => {
    const [title, company, dates, description] = item.split("|");
    return { title, company, dates, description };
  });
}

function parseEducation(data: string[]): Education[] {
  return data.map((item) => {
    const [degree, school, dates, details] = item.split("|");
    return { degree, school, dates, details };
  });
}

function parseSkills(data: string[]): Skill[] {
  return data.map((item) => {
    const [name, levelStr] = item.split("|");
    const level = parseInt(levelStr) || 3;
    return { name, level };
  });
}

function parseProjects(data: string[]): Project[] {
  return data.map((item) => {
    const [name, description, url] = item.split("|");
    return { name, description, url };
  });
}

function parseCertifications(data: string[]): Certification[] {
  return data.map((item) => {
    const [name, year, issuer] = item.split("|");
    return { name, year, issuer };
  });
}

function parseLanguages(data: string[]): Language[] {
  return data.map((item) => {
    const [name, proficiency] = item.split("|");
    return { name, proficiency };
  });
}

// Import from LinkedIn JSON
async function importFromLinkedIn(filePath: string): Promise<Partial<ResumeData>> {
  try {
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Parse LinkedIn profile data
    // Note: LinkedIn export format may vary, this is a simplified parser
    return {
      name: data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : undefined,
      title: data.headline,
      location: data.location?.name,
      summary: data.summary,
      experience: data.positions?.values?.map((pos: any) => ({
        title: pos.title,
        company: pos.company?.name,
        dates: `${pos.startDate?.month || ""}/${pos.startDate?.year || ""}-${
          pos.isCurrent ? "Present" : `${pos.endDate?.month || ""}/${pos.endDate?.year || ""}`
        }`,
        description: pos.summary || "",
      })) || [],
      education: data.educations?.values?.map((edu: any) => ({
        degree: edu.degree || edu.fieldOfStudy,
        school: edu.schoolName,
        dates: `${edu.startDate?.year || ""}-${edu.endDate?.year || ""}`,
        details: edu.notes,
      })) || [],
      skills: data.skills?.values?.map((skill: any, index: number) => ({
        name: skill.name,
        level: Math.min(5, Math.max(1, Math.floor(skill.endorsementCount / 10) + 3)),
      })) || [],
      certifications: data.certifications?.values?.map((cert: any) => ({
        name: cert.name,
        year: cert.startDate?.year?.toString() || "",
        issuer: cert.authority,
      })) || [],
      languages: data.languages?.values?.map((lang: any) => ({
        name: lang.name,
        proficiency: lang.proficiency?.name || "Professional",
      })) || [],
    };
  } catch (error) {
    console.error("Error parsing LinkedIn data:", error);
    return {};
  }
}

// Generate HTML resume
function generateResumeHTML(data: ResumeData): string {
  const templateStyles = getTemplateStyles(data.template);
  const layoutStyles = getLayoutStyles(data.layout);
  const fontFamily = getFontFamily(data.font);
  const fontSizes = getFontSizes(data.fontSize);
  const spacingValue = getSpacingValue(data.spacing);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.name)} - Resume</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: ${fontFamily};
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .resume-container {
      max-width: 850px;
      margin: 0 auto;
      background: white;
      ${layoutStyles.container}
      ${data.atsFriendly ? "box-shadow: none;" : "box-shadow: 0 0 20px rgba(0,0,0,0.1);"}
    }
    .resume-header {
      ${templateStyles.header}
      padding: ${spacingValue * 1.5}px;
      ${!data.atsFriendly ? `border-bottom: 3px solid ${data.color};` : ""}
      text-align: ${layoutStyles.headerAlign};
    }
    ${data.includePhoto && data.photo ? `
    .profile-photo {
      width: 120px;
      height: 120px;
      border-radius: ${data.template === "classic" ? "0" : "50%"};
      object-fit: cover;
      margin: 0 auto 20px;
      ${!data.atsFriendly ? `border: 3px solid ${data.color};` : ""}
    }
    ` : ""}
    .name {
      font-size: ${fontSizes.name};
      font-weight: 700;
      color: ${data.atsFriendly ? "#333" : data.color};
      margin-bottom: 10px;
    }
    .title {
      font-size: ${fontSizes.title};
      color: #666;
      margin-bottom: 15px;
      font-weight: 400;
    }
    .contact-info {
      display: flex;
      ${layoutStyles.contactLayout}
      gap: 15px;
      font-size: ${fontSizes.contact};
      color: #666;
      margin-top: 10px;
    }
    .contact-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .contact-item a {
      color: ${data.color};
      text-decoration: none;
    }
    .resume-body {
      ${layoutStyles.body}
      padding: ${spacingValue}px;
    }
    .section {
      margin-bottom: ${spacingValue * 1.5}px;
    }
    .section-title {
      font-size: ${fontSizes.sectionTitle};
      font-weight: 700;
      color: ${data.atsFriendly ? "#333" : data.color};
      margin-bottom: ${spacingValue * 0.5}px;
      ${!data.atsFriendly ? `border-bottom: 2px solid ${data.color}; padding-bottom: 5px;` : ""}
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .summary-text {
      font-size: ${fontSizes.body};
      line-height: 1.8;
      color: #555;
    }
    .entry {
      margin-bottom: ${spacingValue}px;
    }
    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 5px;
      flex-wrap: wrap;
    }
    .entry-title {
      font-size: ${fontSizes.entryTitle};
      font-weight: 600;
      color: #333;
    }
    .entry-subtitle {
      font-size: ${fontSizes.body};
      color: ${data.color};
      font-weight: 500;
    }
    .entry-dates {
      font-size: ${fontSizes.small};
      color: #888;
      font-style: italic;
    }
    .entry-description {
      font-size: ${fontSizes.body};
      color: #555;
      line-height: 1.7;
      margin-top: 5px;
    }
    .skills-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 15px;
    }
    .skill-item {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .skill-name {
      font-size: ${fontSizes.body};
      font-weight: 500;
      color: #333;
    }
    .skill-level {
      display: flex;
      gap: 3px;
    }
    .skill-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #e5e5e5;
    }
    .skill-dot.filled {
      background: ${data.color};
    }
    .projects-list, .certs-list, .languages-list {
      display: grid;
      gap: ${spacingValue * 0.8}px;
    }
    .project-item, .cert-item, .language-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .item-name {
      font-size: ${fontSizes.body};
      font-weight: 600;
      color: #333;
    }
    .item-link {
      color: ${data.color};
      text-decoration: none;
      font-size: ${fontSizes.small};
    }
    .item-description {
      font-size: ${fontSizes.body};
      color: #555;
    }
    ${layoutStyles.sidebar ? `
    .sidebar {
      ${layoutStyles.sidebar}
      padding: ${spacingValue}px;
      background: #f8f9fa;
    }
    .main-content {
      flex: 1;
      padding: ${spacingValue}px;
    }
    ` : ""}
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .resume-container {
        box-shadow: none;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="resume-container">
    <div class="resume-header">
      ${data.includePhoto && data.photo ? `<img src="${sanitizeUrl(data.photo)}" alt="${escapeHtml(data.name)}" class="profile-photo">` : ""}
      <h1 class="name">${escapeHtml(data.name)}</h1>
      ${data.title ? `<div class="title">${escapeHtml(data.title)}</div>` : ""}
      <div class="contact-info">
        ${data.email ? `<span class="contact-item">✉ <a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></span>` : ""}
        ${data.phone ? `<span class="contact-item">📞 ${escapeHtml(data.phone)}</span>` : ""}
        ${data.location ? `<span class="contact-item">📍 ${escapeHtml(data.location)}</span>` : ""}
        ${data.website ? `<span class="contact-item">🌐 <a href="${sanitizeUrl(data.website)}">${escapeHtml(data.website)}</a></span>` : ""}
        ${data.linkedin ? `<span class="contact-item">💼 <a href="${sanitizeUrl(data.linkedin)}">LinkedIn</a></span>` : ""}
        ${data.github ? `<span class="contact-item">💻 <a href="${sanitizeUrl(data.github)}">GitHub</a></span>` : ""}
      </div>
    </div>

    <div class="resume-body">
      ${data.summary ? `
      <div class="section">
        <h2 class="section-title">Professional Summary</h2>
        <p class="summary-text">${escapeHtml(data.summary)}</p>
      </div>
      ` : ""}

      ${data.experience.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Experience</h2>
        ${data.experience.map(exp => `
        <div class="entry">
          <div class="entry-header">
            <div>
              <div class="entry-title">${escapeHtml(exp.title)}</div>
              <div class="entry-subtitle">${escapeHtml(exp.company)}</div>
            </div>
            <div class="entry-dates">${escapeHtml(exp.dates)}</div>
          </div>
          <div class="entry-description">${escapeHtml(exp.description)}</div>
        </div>
        `).join("")}
      </div>
      ` : ""}

      ${data.education.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Education</h2>
        ${data.education.map(edu => `
        <div class="entry">
          <div class="entry-header">
            <div>
              <div class="entry-title">${escapeHtml(edu.degree)}</div>
              <div class="entry-subtitle">${escapeHtml(edu.school)}</div>
            </div>
            <div class="entry-dates">${escapeHtml(edu.dates)}</div>
          </div>
          ${edu.details ? `<div class="entry-description">${escapeHtml(edu.details)}</div>` : ""}
        </div>
        `).join("")}
      </div>
      ` : ""}

      ${data.skills.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Skills</h2>
        <div class="skills-grid">
          ${data.skills.map(skill => `
          <div class="skill-item">
            <div class="skill-name">${escapeHtml(skill.name)}</div>
            <div class="skill-level">
              ${Array.from({ length: 5 }, (_, i) => `
                <div class="skill-dot ${i < skill.level ? "filled" : ""}"></div>
              `).join("")}
            </div>
          </div>
          `).join("")}
        </div>
      </div>
      ` : ""}

      ${data.projects.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Projects</h2>
        <div class="projects-list">
          ${data.projects.map(project => `
          <div class="project-item">
            <div class="item-name">${escapeHtml(project.name)}</div>
            ${project.url ? `<a href="${sanitizeUrl(project.url)}" class="item-link">${escapeHtml(project.url)}</a>` : ""}
            <div class="item-description">${escapeHtml(project.description)}</div>
          </div>
          `).join("")}
        </div>
      </div>
      ` : ""}

      ${data.certifications.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Certifications</h2>
        <div class="certs-list">
          ${data.certifications.map(cert => `
          <div class="cert-item">
            <div class="item-name">${escapeHtml(cert.name)}</div>
            <div class="item-description">${escapeHtml(cert.year)}${cert.issuer ? ` • ${escapeHtml(cert.issuer)}` : ""}</div>
          </div>
          `).join("")}
        </div>
      </div>
      ` : ""}

      ${data.languages.length > 0 ? `
      <div class="section">
        <h2 class="section-title">Languages</h2>
        <div class="languages-list">
          ${data.languages.map(lang => `
          <div class="language-item">
            <div class="item-name">${escapeHtml(lang.name)}</div>
            <div class="item-description">${escapeHtml(lang.proficiency)}</div>
          </div>
          `).join("")}
        </div>
      </div>
      ` : ""}
    </div>
  </div>
</body>
</html>`;
}

// Generate cover letter HTML
function generateCoverLetterHTML(data: CoverLetterData): string {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cover Letter - ${escapeHtml(data.name)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      line-height: 1.8;
      color: #333;
      background: #f5f5f5;
      padding: 40px 20px;
    }
    .letter-container {
      max-width: 650px;
      margin: 0 auto;
      background: white;
      padding: 60px;
      box-shadow: 0 0 20px rgba(0,0,0,0.1);
    }
    .sender-info { margin-bottom: 40px; }
    .sender-name { font-size: 18px; font-weight: 600; margin-bottom: 5px; }
    .sender-details { font-size: 14px; color: #666; }
    .date { margin-bottom: 30px; font-size: 14px; color: #666; }
    .recipient-info { margin-bottom: 30px; }
    .recipient-name { font-size: 16px; font-weight: 600; margin-bottom: 5px; }
    .letter-body { font-size: 15px; line-height: 1.8; white-space: pre-wrap; margin-bottom: 30px; }
    .closing { font-size: 15px; }
    @media print {
      body { background: white; padding: 0; }
      .letter-container { box-shadow: none; padding: 40px; }
    }
  </style>
</head>
<body>
  <div class="letter-container">
    <div class="sender-info">
      <div class="sender-name">${escapeHtml(data.name)}</div>
      <div class="sender-details">
        ${escapeHtml(data.email) || ""} ${data.phone ? `• ${escapeHtml(data.phone)}` : ""} ${data.location ? `• ${escapeHtml(data.location)}` : ""}
      </div>
    </div>
    <div class="date">${today}</div>
    <div class="recipient-info">
      <div class="recipient-name">Hiring Manager</div>
      <div>${escapeHtml(data.position)}</div>
      <div>${escapeHtml(data.company)}</div>
    </div>
    <div class="letter-body">${escapeHtml(data.content)}</div>
    <div class="closing">
      <p>Sincerely,</p>
      <p style="margin-top: 20px;">${escapeHtml(data.name)}</p>
    </div>
  </div>
</body>
</html>`;
}

// Generate markdown resume
function generateMarkdown(data: ResumeData): string {
  let md = `# ${data.name}\n\n`;

  if (data.title) md += `**${data.title}**\n\n`;

  const contact = [
    data.email && `📧 ${data.email}`,
    data.phone && `📞 ${data.phone}`,
    data.location && `📍 ${data.location}`,
    data.website && `🌐 ${data.website}`,
    data.linkedin && `💼 ${data.linkedin}`,
    data.github && `💻 ${data.github}`,
  ].filter(Boolean);

  if (contact.length > 0) md += `${contact.join(" • ")}\n\n`;

  if (data.summary) md += `## Professional Summary\n\n${data.summary}\n\n`;

  if (data.experience.length > 0) {
    md += `## Experience\n\n`;
    data.experience.forEach((exp) => {
      md += `### ${exp.title}\n**${exp.company}** • ${exp.dates}\n\n${exp.description}\n\n`;
    });
  }

  if (data.education.length > 0) {
    md += `## Education\n\n`;
    data.education.forEach((edu) => {
      md += `### ${edu.degree}\n**${edu.school}** • ${edu.dates}\n`;
      if (edu.details) md += `\n${edu.details}\n`;
      md += `\n`;
    });
  }

  if (data.skills.length > 0) {
    md += `## Skills\n\n`;
    data.skills.forEach((skill) => {
      const level = "●".repeat(skill.level) + "○".repeat(5 - skill.level);
      md += `- **${skill.name}**: ${level}\n`;
    });
    md += `\n`;
  }

  if (data.projects.length > 0) {
    md += `## Projects\n\n`;
    data.projects.forEach((project) => {
      md += `### ${project.name}\n${project.description}`;
      if (project.url) md += `\n\n${project.url}`;
      md += `\n\n`;
    });
  }

  if (data.certifications.length > 0) {
    md += `## Certifications\n\n`;
    data.certifications.forEach((cert) => {
      md += `- **${cert.name}** (${cert.year})`;
      if (cert.issuer) md += ` - ${cert.issuer}`;
      md += `\n`;
    });
    md += `\n`;
  }

  if (data.languages.length > 0) {
    md += `## Languages\n\n`;
    data.languages.forEach((lang) => {
      md += `- **${lang.name}**: ${lang.proficiency}\n`;
    });
  }

  return md;
}

// Helper functions for styles
function getTemplateStyles(template: string) {
  const templates: Record<string, any> = {
    modern: { header: "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;" },
    classic: { header: "background: #2c3e50; color: white;" },
    minimal: { header: "background: white; color: #333; border-bottom: 1px solid #e5e5e5;" },
    creative: { header: "background: linear-gradient(45deg, #ff6b6b, #feca57); color: white;" },
    executive: { header: "background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white;" },
    technical: { header: "background: #1a1a1a; color: #00ff00; font-family: 'Courier New', monospace;" },
  };
  return templates[template] || templates.modern;
}

function getLayoutStyles(layout: string) {
  const layouts: Record<string, any> = {
    "single-column": {
      container: "padding: 40px 60px;",
      headerAlign: "center",
      contactLayout: "flex-wrap: wrap; justify-content: center;",
      body: "",
    },
    "two-column": {
      container: "display: grid; grid-template-columns: 250px 1fr;",
      headerAlign: "left",
      contactLayout: "flex-direction: column; align-items: flex-start;",
      body: "grid-column: 2;",
      sidebar: "grid-column: 1; grid-row: 1 / span 2;",
    },
    sidebar: {
      container: "display: flex;",
      headerAlign: "left",
      contactLayout: "flex-direction: column;",
      body: "flex: 1;",
      sidebar: "width: 200px; background: #f8f9fa;",
    },
  };
  return layouts[layout] || layouts["single-column"];
}

function getFontFamily(font: string): string {
  const fonts: Record<string, string> = {
    inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    roboto: "'Roboto', sans-serif",
    lato: "'Lato', sans-serif",
    "open-sans": "'Open Sans', sans-serif",
    poppins: "'Poppins', sans-serif",
  };
  return fonts[font] || fonts.inter;
}

function getFontSizes(size: string) {
  const sizes: Record<string, any> = {
    small: { name: "28px", title: "16px", contact: "12px", sectionTitle: "16px", entryTitle: "15px", body: "13px", small: "11px" },
    medium: { name: "32px", title: "18px", contact: "14px", sectionTitle: "18px", entryTitle: "16px", body: "14px", small: "12px" },
    large: { name: "36px", title: "20px", contact: "15px", sectionTitle: "20px", entryTitle: "17px", body: "15px", small: "13px" },
  };
  return sizes[size] || sizes.medium;
}

function getSpacingValue(spacing: string): number {
  const values: Record<string, number> = { compact: 15, normal: 25, spacious: 35 };
  return values[spacing] || values.normal;
}

// Main function
async function main() {
  const args = parseArguments();

  if (args.help) {
    showHelp();
    return;
  }

  // LinkedIn import
  if (args["from-linkedin"]) {
    const linkedinData = await importFromLinkedIn(args["from-linkedin"]);
    Object.assign(args, linkedinData);
  }

  // Cover letter mode
  if (args["cover-letter"]) {
    if (!args.name || !args.company || !args.position || !args["letter-content"]) {
      console.error("Error: Cover letter requires --name, --company, --position, and --letter-content");
      process.exit(1);
    }

    const letterData: CoverLetterData = {
      name: args.name,
      email: args.email,
      phone: args.phone,
      location: args.location,
      company: args.company,
      position: args.position,
      content: args["letter-content"],
      template: args["letter-template"] || "standard",
      date: new Date().toISOString().split("T")[0],
    };

    const html = generateCoverLetterHTML(letterData);

    const outputDir = process.env.SKILLS_OUTPUT_DIR || process.env.SKILLS_PROJECT_ROOT || process.cwd();
    const exportsDir = join(outputDir, ".skills", "exports", "generate-resume");
    await mkdir(exportsDir, { recursive: true });

    const outputPath = args.output
      ? args.output.startsWith("/") ? args.output : join(process.cwd(), args.output)
      : join(exportsDir, "cover-letter.html");
    await writeFile(outputPath, html);

    console.log(`\nCover letter generated successfully!`);
    console.log(`File: ${outputPath}`);
    console.log("\nTo convert to PDF: Open in browser and print to PDF");

    if (args.open) {
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      Bun.spawn([openCmd, outputPath]);
    }

    return;
  }

  // Validate required fields
  if (!args.name) {
    console.error("Error: --name is required");
    console.log("\nRun with --help for usage information");
    process.exit(1);
  }

  // Build resume data
  const resumeData: ResumeData = {
    name: args.name,
    email: args.email,
    phone: args.phone,
    location: args.location,
    website: args.website,
    linkedin: args.linkedin,
    github: args.github,
    portfolio: args.portfolio,
    twitter: args.twitter,
    photo: args.photo,
    title: args.title,
    summary: args.summary,
    experience: args.experience ? parseExperience(args.experience as string[]) : [],
    education: args.education ? parseEducation(args.education as string[]) : [],
    skills: args.skill ? parseSkills(args.skill as string[]) : [],
    projects: args.project ? parseProjects(args.project as string[]) : [],
    certifications: args.certification ? parseCertifications(args.certification as string[]) : [],
    languages: args.language ? parseLanguages(args.language as string[]) : [],
    template: args.template || "modern",
    layout: args.layout || "single-column",
    color: args.color || "#2563eb",
    font: args.font || "inter",
    fontSize: args["font-size"] || "medium",
    spacing: args.spacing || "normal",
    atsFriendly: args["ats-friendly"] || false,
    includePhoto: args["include-photo"] || false,
    pageNumbers: args["page-numbers"] || false,
  };

  // Determine output
  const outputDir = process.env.SKILLS_OUTPUT_DIR || process.env.SKILLS_PROJECT_ROOT || process.cwd();
  const exportsDir = join(outputDir, ".skills", "exports", "generate-resume");
  await mkdir(exportsDir, { recursive: true });

  const format = args.format || "pdf";
  const ext = format === "markdown" ? "md" : format === "html" ? "html" : "html";
  const defaultFilename = `resume-${args.name.toLowerCase().replace(/\s+/g, "-")}.${ext}`;

  // Handle absolute vs relative paths
  let outputPath: string;
  if (args.output) {
    outputPath = args.output.startsWith("/") ? args.output : join(process.cwd(), args.output);
  } else {
    outputPath = join(exportsDir, defaultFilename);
  }

  // Generate output
  let content = "";
  if (format === "markdown") {
    content = generateMarkdown(resumeData);
  } else {
    content = generateResumeHTML(resumeData);
  }

  await writeFile(outputPath, content);

  // Save metadata
  const metadataPath = join(exportsDir, `metadata.json`);
  await writeFile(metadataPath, JSON.stringify(resumeData, null, 2));

  console.log(`\n✓ Resume generated successfully!`);
  console.log(`File: ${outputPath}`);
  console.log(`Metadata: ${metadataPath}`);

  if (format === "pdf" || (format === "html" && !args.output?.endsWith(".html"))) {
    console.log("\nTo convert to PDF:");
    console.log(`  1. Open in browser: file://${outputPath}`);
    console.log(`  2. Print to PDF using browser's print function`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Resume: ${resumeData.name}`);
  console.log(`Template: ${resumeData.template}`);
  console.log(`Layout: ${resumeData.layout}`);
  console.log(`Format: ${format}`);
  console.log("=".repeat(50) + "\n");

  if (args.open) {
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([openCmd, outputPath]);
  }
}

// Run
main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
