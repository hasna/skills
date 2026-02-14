#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Skill configuration
const SKILL_NAME = "generate-pdf";
const SESSION_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// Environment paths from the run API
const EXPORTS_DIR = process.env.SKILLS_EXPORTS_DIR || join(process.cwd(), "exports");
const LOGS_DIR = process.env.SKILLS_LOGS_DIR || join(process.cwd(), "logs");
const SKILLS_INPUT = process.env.SKILLS_INPUT || "";
const LOG_FILE = join(LOGS_DIR, `${SESSION_ID}.log`);

// Ensure output directories exist
[EXPORTS_DIR, LOGS_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Logging utility
function log(message: string, level: "info" | "error" | "warn" = "info") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage);
  if (level === "error") {
    console.error(message);
  }
}

// =============================================================================
// Security: HTML Escaping to prevent XSS
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
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
 * Sanitize a URL for safe href attribute usage
 */
function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  const lowerUrl = trimmed.toLowerCase();
  if (lowerUrl.startsWith("javascript:") || lowerUrl.startsWith("data:") || lowerUrl.startsWith("vbscript:")) {
    return "";
  }
  return escapeHtml(trimmed);
}

/**
 * Sanitize all string values in a template data object
 * This prevents XSS when user-provided data is interpolated into HTML
 */
function sanitizeTemplateData(data: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    // URL fields need URL sanitization, not just HTML escaping
    if (key.toLowerCase().includes("linkedin") || key.toLowerCase().includes("website") ||
        key.toLowerCase().includes("url") || key.toLowerCase().includes("href")) {
      sanitized[key] = sanitizeUrl(value);
    } else {
      sanitized[key] = escapeHtml(value);
    }
  }
  return sanitized;
}

// Simple markdown to HTML converter
function markdownToHtml(markdown: string): string {
  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Links - sanitize URL and escape link text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      const safeUrl = sanitizeUrl(url);
      const safeText = escapeHtml(text);
      return safeUrl ? `<a href="${safeUrl}">${safeText}</a>` : safeText;
    })
    // Lists
    .replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>')
    // Numbered lists
    .replace(/^\s*\d+\.\s+(.*)$/gim, '<li>$1</li>')
    // Horizontal rule
    .replace(/^---$/gim, '<hr>')
    // Paragraphs (handle newlines)
    .replace(/\n\n/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br>');

  // Wrap list items in ul
  html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

  return `<p>${html}</p>`;
}

// Invoice template
const templates: Record<string, (data: Record<string, string>) => string> = {
  invoice: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .company-info { font-size: 14px; }
    .invoice-info { text-align: right; }
    .invoice-title { font-size: 28px; color: #2c3e50; margin-bottom: 10px; }
    .invoice-number { font-size: 14px; color: #7f8c8d; }
    .addresses { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .address-block { width: 45%; }
    .address-label { font-weight: bold; color: #2c3e50; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #2c3e50; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #ddd; }
    .totals { text-align: right; }
    .totals table { width: 300px; margin-left: auto; }
    .totals td { border: none; padding: 8px; }
    .total-row { font-weight: bold; font-size: 18px; background: #f8f9fa; }
    .notes { margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 4px; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #7f8c8d; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-info">
      <h2>${data.companyName || 'Company Name'}</h2>
      <p>${data.companyAddress || ''}<br>
      ${data.companyCity || ''}, ${data.companyState || ''} ${data.companyZip || ''}<br>
      ${data.companyPhone || ''}</p>
    </div>
    <div class="invoice-info">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">#${data.invoiceNumber || 'INV-001'}</div>
      <p>Date: ${data.invoiceDate || new Date().toLocaleDateString()}<br>
      Due: ${data.dueDate || ''}</p>
    </div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <div class="address-label">Bill To:</div>
      <p>${data.clientName || 'Client Name'}<br>
      ${data.clientAddress || ''}<br>
      ${data.clientCity || ''}, ${data.clientState || ''} ${data.clientZip || ''}</p>
    </div>
    <div class="address-block">
      <div class="address-label">Payment Details:</div>
      <p>Terms: ${data.paymentTerms || 'Net 30'}<br>
      Method: ${data.paymentMethod || 'Bank Transfer'}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Rate</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${data.items || '<tr><td>Service</td><td>1</td><td>$0</td><td>$0</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Subtotal:</td><td>${data.subtotal || '$0'}</td></tr>
      <tr><td>Tax (${data.taxRate || '0'}%):</td><td>${data.tax || '$0'}</td></tr>
      <tr class="total-row"><td>Total:</td><td>${data.total || '$0'}</td></tr>
    </table>
  </div>

  ${data.notes ? `<div class="notes"><strong>Notes:</strong><br>${data.notes}</div>` : ''}

  <div class="footer">Thank you for your business!</div>
</body>
</html>`,

  report: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; margin: 40px; color: #333; line-height: 1.6; }
    .title-page { text-align: center; margin-bottom: 60px; padding-top: 100px; }
    .title { font-size: 36px; color: #2c3e50; margin-bottom: 10px; }
    .subtitle { font-size: 20px; color: #7f8c8d; margin-bottom: 40px; }
    .meta { font-size: 14px; color: #95a5a6; }
    h2 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-top: 40px; }
    .executive-summary { background: #f8f9fa; padding: 20px; border-left: 4px solid #3498db; margin: 30px 0; }
    .section { margin-bottom: 30px; }
    .conclusion { background: #e8f4f8; padding: 20px; border-radius: 4px; margin-top: 40px; }
    .footer { margin-top: 60px; text-align: center; font-size: 12px; color: #7f8c8d; border-top: 1px solid #ddd; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="title-page">
    <div class="title">${data.title || 'Report Title'}</div>
    <div class="subtitle">${data.subtitle || ''}</div>
    <div class="meta">
      <p>Date: ${data.reportDate || new Date().toLocaleDateString()}</p>
      <p>Author: ${data.author || ''}</p>
    </div>
  </div>

  <div class="executive-summary">
    <h2>Executive Summary</h2>
    <p>${data.executiveSummary || ''}</p>
  </div>

  <div class="section">
    <h2>${data.section1Title || 'Introduction'}</h2>
    <p>${data.section1Content || ''}</p>
  </div>

  <div class="section">
    <h2>${data.section2Title || 'Analysis'}</h2>
    <p>${data.section2Content || ''}</p>
  </div>

  <div class="conclusion">
    <h2>Conclusion</h2>
    <p>${data.conclusion || ''}</p>
  </div>

  <div class="footer">
    <p>${data.companyName || ''} | ${data.companyContact || ''}</p>
  </div>
</body>
</html>`,

  resume: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #333; line-height: 1.5; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2c3e50; padding-bottom: 20px; }
    .name { font-size: 32px; color: #2c3e50; margin-bottom: 10px; }
    .contact { font-size: 14px; color: #7f8c8d; }
    .contact a { color: #3498db; text-decoration: none; }
    h2 { color: #2c3e50; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; margin-top: 25px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
    .summary { font-style: italic; color: #555; margin-bottom: 20px; }
    .experience-item, .education-item { margin-bottom: 20px; }
    .job-title { font-weight: bold; }
    .company { color: #3498db; }
    .date { font-size: 12px; color: #7f8c8d; float: right; }
    .skills { display: flex; flex-wrap: wrap; gap: 8px; }
    .skill-tag { background: #e8f4f8; color: #2c3e50; padding: 4px 12px; border-radius: 15px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="name">${data.name || 'Your Name'}</div>
    <div class="contact">
      ${data.email || ''} | ${data.phone || ''} | ${data.location || ''}<br>
      ${data.linkedin ? `<a href="${data.linkedin}">${data.linkedin}</a>` : ''}
      ${data.website ? `| <a href="${data.website}">${data.website}</a>` : ''}
    </div>
  </div>

  <h2>Professional Summary</h2>
  <p class="summary">${data.summary || ''}</p>

  <h2>Experience</h2>
  ${data.experience || '<div class="experience-item"><span class="job-title">Position</span> at <span class="company">Company</span></div>'}

  <h2>Education</h2>
  ${data.education || '<div class="education-item">Degree - Institution</div>'}

  <h2>Skills</h2>
  <div class="skills">
    ${data.skills || '<span class="skill-tag">Skill</span>'}
  </div>
</body>
</html>`,

  letter: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Times New Roman', serif; margin: 60px; color: #333; line-height: 1.8; font-size: 14px; }
    .sender-info { margin-bottom: 40px; }
    .date { margin-bottom: 40px; }
    .recipient-info { margin-bottom: 40px; }
    .body { margin-bottom: 40px; text-align: justify; }
    .closing { margin-top: 40px; }
    .signature { margin-top: 60px; }
  </style>
</head>
<body>
  <div class="sender-info">
    <strong>${data.senderName || ''}</strong><br>
    ${data.senderAddress || ''}<br>
    ${data.senderCity || ''}, ${data.senderState || ''} ${data.senderZip || ''}
  </div>

  <div class="date">${data.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>

  <div class="recipient-info">
    ${data.recipientName || ''}<br>
    ${data.recipientTitle ? data.recipientTitle + '<br>' : ''}
    ${data.recipientCompany ? data.recipientCompany + '<br>' : ''}
    ${data.recipientAddress || ''}<br>
    ${data.recipientCity || ''}, ${data.recipientState || ''} ${data.recipientZip || ''}
  </div>

  <div class="body">
    <p>Dear ${data.recipientName || 'Sir/Madam'},</p>
    <p>${data.body || ''}</p>
  </div>

  <div class="closing">
    ${data.closing || 'Sincerely'},
  </div>

  <div class="signature">
    ${data.senderName || ''}
  </div>
</body>
</html>`,

  contract: (data) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Times New Roman', serif; margin: 50px; color: #333; line-height: 1.6; font-size: 12px; }
    .title { text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; }
    .date { text-align: center; margin-bottom: 30px; }
    h2 { font-size: 14px; margin-top: 25px; }
    .parties { margin-bottom: 30px; }
    .section { margin-bottom: 20px; text-align: justify; }
    .signatures { margin-top: 60px; display: flex; justify-content: space-between; }
    .signature-block { width: 45%; }
    .signature-line { border-top: 1px solid #333; margin-top: 60px; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="title">${data.contractTitle || 'SERVICE AGREEMENT'}</div>
  <div class="date">Effective Date: ${data.effectiveDate || new Date().toLocaleDateString()}</div>

  <div class="parties">
    <p>This Agreement is entered into by and between:</p>
    <p><strong>${data.party1Name || 'Party 1'}</strong> ("${data.party1Label || 'Provider'}")<br>
    Address: ${data.party1Address || ''}</p>
    <p>AND</p>
    <p><strong>${data.party2Name || 'Party 2'}</strong> ("${data.party2Label || 'Client'}")<br>
    Address: ${data.party2Address || ''}</p>
  </div>

  <div class="section">
    <h2>1. PURPOSE</h2>
    <p>${data.purpose || ''}</p>
  </div>

  <div class="section">
    <h2>2. TERM</h2>
    <p>This Agreement shall be effective for a period of ${data.term || '12 months'} from the Effective Date.</p>
  </div>

  <div class="section">
    <h2>3. OBLIGATIONS</h2>
    <p>${data.obligations || ''}</p>
  </div>

  <div class="section">
    <h2>4. COMPENSATION</h2>
    <p>${data.compensation || ''}</p>
  </div>

  <div class="section">
    <h2>5. TERMINATION</h2>
    <p>${data.termination || ''}</p>
  </div>

  <div class="section">
    <h2>6. GOVERNING LAW</h2>
    <p>This Agreement shall be governed by the laws of ${data.governingLaw || 'the applicable jurisdiction'}.</p>
  </div>

  <div class="signatures">
    <div class="signature-block">
      <div class="signature-line">
        ${data.party1Name || 'Party 1'}<br>
        ${data.party1Label || 'Provider'}
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-line">
        ${data.party2Name || 'Party 2'}<br>
        ${data.party2Label || 'Client'}
      </div>
    </div>
  </div>
</body>
</html>`
};

// Page format dimensions
const PAGE_FORMATS: Record<string, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Tabloid: { width: 279, height: 432 },
};

interface GenerateOptions {
  content?: string;
  contentType: "markdown" | "html" | "text";
  format: string;
  orientation: "portrait" | "landscape";
  margin: { top: string; right: string; bottom: string; left: string };
  header?: string;
  footer?: string;
  displayHeaderFooter: boolean;
  printBackground: boolean;
  css?: string;
  title?: string;
  author?: string;
  subject?: string;
  filename?: string;
  template?: string;
  data?: Record<string, string>;
  url?: string;
}

// Parse command line arguments
function parseArgs(args: string[]): GenerateOptions {
  const options: GenerateOptions = {
    contentType: "markdown",
    format: "A4",
    orientation: "portrait",
    margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
    displayHeaderFooter: false,
    printBackground: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-h":
      case "--help":
        console.log(`
skill-generate-pdf - Generate high-quality PDF documents

Usage:
  skills run generate-pdf -- [options]

Options:
  -h, --help               Show this help message
  --content <text>         Content to convert (markdown, HTML, or text)
  --content-type <type>    Content type: markdown | html | text (default: markdown)
  --file <path>            Read content from file
  --template <name>        Use built-in template: invoice | report | resume | letter | contract
  --data <json>            JSON data for template variables
  --url <url>              Generate PDF from URL
  --format <size>          Page format: A4 | Letter | Legal | A3 | A5 | Tabloid (default: A4)
  --orientation <type>     Page orientation: portrait | landscape (default: portrait)
  --title <text>           Document title
  --author <text>          Document author
  --filename <name>        Output filename (without extension)
  --css <styles>           Custom CSS styles
  --header <html>          Header HTML
  --footer <html>          Footer HTML

Templates:
  invoice                  Professional invoice template
  report                   Business report template
  resume                   Resume/CV template
  letter                   Formal letter template
  contract                 Contract/agreement template

Examples:
  # Generate PDF from markdown
  skills run generate-pdf -- --content "# Hello World" --filename report

  # Use a template with data
  skills run generate-pdf -- --template invoice --data '{"clientName":"Acme Corp","total":"$1000"}'

  # Convert a file
  skills run generate-pdf -- --file ./README.md --format Letter
`);
        process.exit(0);
      case "--content":
        if (nextArg) {
          options.content = nextArg;
          i++;
        }
        break;
      case "--content-type":
        if (nextArg && ["markdown", "html", "text"].includes(nextArg)) {
          options.contentType = nextArg as "markdown" | "html" | "text";
          i++;
        }
        break;
      case "--format":
        if (nextArg && PAGE_FORMATS[nextArg]) {
          options.format = nextArg;
          i++;
        }
        break;
      case "--orientation":
        if (nextArg && ["portrait", "landscape"].includes(nextArg)) {
          options.orientation = nextArg as "portrait" | "landscape";
          i++;
        }
        break;
      case "--title":
        if (nextArg) {
          options.title = nextArg;
          i++;
        }
        break;
      case "--author":
        if (nextArg) {
          options.author = nextArg;
          i++;
        }
        break;
      case "--filename":
        if (nextArg) {
          options.filename = nextArg;
          i++;
        }
        break;
      case "--template":
        if (nextArg && templates[nextArg]) {
          options.template = nextArg;
          i++;
        }
        break;
      case "--data":
        if (nextArg) {
          try {
            options.data = JSON.parse(nextArg);
          } catch {
            log(`Invalid JSON data: ${nextArg}`, "warn");
          }
          i++;
        }
        break;
      case "--url":
        if (nextArg) {
          options.url = nextArg;
          i++;
        }
        break;
      case "--file":
        if (nextArg && existsSync(nextArg)) {
          options.content = readFileSync(nextArg, "utf-8");
          i++;
        }
        break;
      case "--css":
        if (nextArg) {
          options.css = nextArg;
          i++;
        }
        break;
      case "--header":
        if (nextArg) {
          options.header = nextArg;
          options.displayHeaderFooter = true;
          i++;
        }
        break;
      case "--footer":
        if (nextArg) {
          options.footer = nextArg;
          options.displayHeaderFooter = true;
          i++;
        }
        break;
    }
  }

  // Use SKILLS_INPUT as content if no content provided
  if (!options.content && !options.template && !options.url && SKILLS_INPUT) {
    options.content = SKILLS_INPUT;
  }

  return options;
}

// Generate HTML from content
function generateHtml(options: GenerateOptions): string {
  let bodyContent = "";

  if (options.template && options.data) {
    // Use template with sanitized data to prevent XSS
    const templateFn = templates[options.template];
    if (templateFn) {
      const sanitizedData = sanitizeTemplateData(options.data);
      return templateFn(sanitizedData);
    }
  }

  // Convert content to HTML
  if (options.content) {
    switch (options.contentType) {
      case "markdown":
        bodyContent = markdownToHtml(options.content);
        break;
      case "html":
        bodyContent = options.content;
        break;
      case "text":
        bodyContent = `<pre style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(options.content)}</pre>`;
        break;
    }
  }

  // Build full HTML document
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(options.title) || 'Document'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 100%;
      padding: 20px;
    }
    h1, h2, h3 { color: #2c3e50; margin-top: 1.5em; }
    h1 { font-size: 2em; border-bottom: 2px solid #3498db; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f8f8f8; padding: 15px; border-radius: 5px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    a { color: #3498db; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f4f4f4; }
    blockquote { border-left: 4px solid #3498db; margin: 1em 0; padding-left: 1em; color: #666; }
    ul, ol { padding-left: 2em; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
    ${options.css || ''}
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

// Main execution
async function main() {
  try {
    log(`Starting ${SKILL_NAME} skill (Session: ${SESSION_ID})`);
    log(`Arguments: ${Bun.argv.slice(2).join(" ")}`);

    const args = Bun.argv.slice(2);
    const options = parseArgs(args);

    // Validate input
    if (!options.content && !options.template && !options.url) {
      console.error("Error: No content provided. Use --content, --file, --template, or --url");
      process.exit(1);
    }

    // Generate HTML
    const html = generateHtml(options);
    log(`Generated HTML (${html.length} characters)`);

    // Generate filename
    const filename = options.filename
      ? `${options.filename}.pdf`
      : `document_${SESSION_ID}.pdf`;

    // Since we can't use Puppeteer in Bun easily, we'll output the HTML
    // and create a simple text-based PDF representation
    // In production, this would use a proper PDF library

    // For now, save HTML that can be converted to PDF
    const htmlFile = join(EXPORTS_DIR, filename.replace('.pdf', '.html'));
    writeFileSync(htmlFile, html);
    log(`Saved HTML to: ${htmlFile}`);

    // Output result
    const result = {
      success: true,
      message: "HTML document generated successfully",
      data: {
        htmlFile,
        filename: filename.replace('.pdf', '.html'),
        format: options.format,
        orientation: options.orientation,
        contentLength: html.length,
        template: options.template || null,
      },
      note: "PDF conversion requires Puppeteer/Playwright. HTML file exported instead.",
    };

    console.log(JSON.stringify(result, null, 2));
    log(`Successfully generated document: ${filename}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`, "error");
    console.error(JSON.stringify({
      success: false,
      error: `Error generating PDF: ${errorMessage}`
    }));
    process.exit(1);
  }
}

main();
