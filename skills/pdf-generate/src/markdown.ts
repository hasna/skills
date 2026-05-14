import { escapeHtml, sanitizeUrl } from "./security";

export function markdownToHtml(markdown: string): string {
  let html = markdown
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      const safeUrl = sanitizeUrl(url);
      const safeText = escapeHtml(text);
      return safeUrl ? `<a href="${safeUrl}">${safeText}</a>` : safeText;
    })
    .replace(/^\s*[-*]\s+(.*)$/gim, "<li>$1</li>")
    .replace(/^\s*\d+\.\s+(.*)$/gim, "<li>$1</li>")
    .replace(/^---$/gim, "<hr>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  html = html.replace(/(<li>.*?<\/li>)+/gs, "<ul>$&</ul>");
  return `<p>${html}</p>`;
}
