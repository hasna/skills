import { markdownToHtml } from "./markdown";
import { escapeHtml, sanitizeTemplateData } from "./security";
import { templates } from "./templates";
import type { GenerateOptions } from "./types";

export function generateHtml(options: GenerateOptions): string {
  let bodyContent = "";

  if (options.template && options.data) {
    const templateFn = templates[options.template];
    if (templateFn) {
      const sanitizedData = sanitizeTemplateData(options.data);
      return templateFn(sanitizedData);
    }
  }

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

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(options.title) || "Document"}</title>
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
    ${options.css || ""}
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(h1|h2|h3|p|div|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
