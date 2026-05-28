import { escapeHtml, sanitizeUrl } from "./security";
import type { CoverLetterData, ResumeData } from "./types";

export function generateResumeHTML(data: ResumeData): string {
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
export function generateCoverLetterHTML(data: CoverLetterData): string {
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
export function generateMarkdown(data: ResumeData): string {
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
