import type { ContentSection, DocOptions, ParsedContent } from "./types";

export function parseMarkdown(markdown: string, options: DocOptions): ParsedContent {
  const sections: ContentSection[] = [];
  let title = options.title || "Document";

  const lines = markdown.split("\n");
  let i = 0;
  let currentList: { items: string[]; ordered: boolean } | null = null;
  let currentTable: string[][] | null = null;
  let inCodeBlock = false;
  let codeContent = "";
  let codeLanguage = "";

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim();
        codeContent = "";
      } else {
        inCodeBlock = false;
        sections.push({ type: "code", text: codeContent.trim(), language: codeLanguage });
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + "\n";
      i++;
      continue;
    }

    if (currentList && !line.match(/^[\s]*[-*+]\s/) && !line.match(/^[\s]*\d+\.\s/) && line.trim() !== "") {
      sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
      currentList = null;
    }

    if (currentTable && !line.startsWith("|") && line.trim() !== "") {
      sections.push({ type: "table", rows: currentTable });
      currentTable = null;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1 && !options.title) {
        title = text;
      }
      sections.push({ type: "heading", level, text });
      i++;
      continue;
    }

    if (line.match(/^[-*_]{3,}$/)) {
      sections.push({ type: "hr" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteText = line.replace(/^>\s*/, "");
      sections.push({ type: "quote", text: quoteText });
      i++;
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!currentList || currentList.ordered) {
        if (currentList) {
          sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
        }
        currentList = { items: [], ordered: false };
      }
      currentList.items.push(ulMatch[1]);
      i++;
      continue;
    }

    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!currentList || !currentList.ordered) {
        if (currentList) {
          sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
        }
        currentList = { items: [], ordered: true };
      }
      currentList.items.push(olMatch[1]);
      i++;
      continue;
    }

    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (!currentTable) {
        currentTable = [];
      }
      if (!cells.every((cell) => cell.match(/^[-:]+$/))) {
        currentTable.push(cells);
      }
      i++;
      continue;
    }

    if (line.trim()) {
      sections.push({ type: "paragraph", text: line });
    }

    i++;
  }

  if (currentList) {
    sections.push({ type: "list", items: currentList.items, ordered: currentList.ordered });
  }
  if (currentTable) {
    sections.push({ type: "table", rows: currentTable });
  }

  return { title, sections };
}
