import type { DocOptions, DocumentDeps, ParsedContent } from "./types";

// Parse inline formatting
function parseInlineFormatting(text: string, options: DocOptions, TextRun: any): any[] {
  const runs: any[] = [];

  // Simple regex-based parsing for bold, italic, code
  const regex = /(\*\*|__)(.*?)\1|(\*|_)(.*?)\3|`([^`]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), font: options.font, size: options.fontSize * 2 }));
    }

    if (match[1]) {
      // Bold
      runs.push(new TextRun({ text: match[2], bold: true, font: options.font, size: options.fontSize * 2 }));
    } else if (match[3]) {
      // Italic
      runs.push(new TextRun({ text: match[4], italics: true, font: options.font, size: options.fontSize * 2 }));
    } else if (match[5]) {
      // Code
      runs.push(new TextRun({ text: match[5], font: "Courier New", size: options.fontSize * 2 }));
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), font: options.font, size: options.fontSize * 2 }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: options.font, size: options.fontSize * 2 }));
  }

  return runs;
}

// Convert page size to dimensions
function getPageSize(size: string): { width: number; height: number } {
  const sizes: Record<string, { width: number; height: number }> = {
    letter: { width: 12240, height: 15840 }, // 8.5 x 11 inches in twips
    a4: { width: 11906, height: 16838 }, // 210 x 297 mm in twips
    legal: { width: 12240, height: 20160 }, // 8.5 x 14 inches in twips
  };
  return sizes[size] || sizes.letter;
}

// Build document from parsed content
export function buildDocument(content: ParsedContent, options: DocOptions, deps: DocumentDeps): any {
  const { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, PageNumber, NumberFormat, Header, Footer, TableOfContents, PageBreak } = deps;
  const pageSize = getPageSize(options.pageSize);
  const marginTwips = options.margins * 1440; // Convert inches to twips

  const children: any[] = [];

  // Add title page for report template
  if (options.template === "report") {
    children.push(
      new Paragraph({ text: "", spacing: { after: 4000 } }),
      new Paragraph({
        children: [new TextRun({ text: content.title, font: options.headingFont, size: 72, bold: true })],
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ text: "", spacing: { after: 1000 } })
    );

    if (options.author) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `By ${options.author}`, font: options.font, size: 28 })],
          alignment: AlignmentType.CENTER,
        })
      );
    }

    if (options.company) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: options.company, font: options.font, size: 24 })],
          alignment: AlignmentType.CENTER,
        })
      );
    }

    children.push(
      new Paragraph({
        children: [new TextRun({ text: options.date, font: options.font, size: 24 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  // Add letter/memo header
  if (options.template === "letter" || options.template === "memo") {
    if (options.company) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: options.company, font: options.font, size: options.fontSize * 2, bold: true })],
        })
      );
    }
    children.push(
      new Paragraph({
        children: [new TextRun({ text: options.date, font: options.font, size: options.fontSize * 2 })],
        spacing: { after: 400 },
      }),
      new Paragraph({ text: "", spacing: { after: 400 } })
    );
  }

  // Add TOC if requested
  if (options.toc) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Table of Contents", font: options.headingFont, size: 32, bold: true })],
        spacing: { after: 400 },
      }),
      new TableOfContents("Table of Contents", {
        hyperlink: true,
        headingStyleRange: "1-3",
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  // Process sections
  for (const section of content.sections) {
    switch (section.type) {
      case "heading":
        const headingLevel = section.level === 1 ? HeadingLevel.HEADING_1 :
                            section.level === 2 ? HeadingLevel.HEADING_2 :
                            section.level === 3 ? HeadingLevel.HEADING_3 :
                            section.level === 4 ? HeadingLevel.HEADING_4 :
                            HeadingLevel.HEADING_5;
        const headingSize = section.level === 1 ? 32 : section.level === 2 ? 26 : section.level === 3 ? 22 : 20;
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.text || "", font: options.headingFont, size: headingSize, bold: true })],
            heading: headingLevel,
            spacing: { before: 400, after: 200 },
          })
        );
        break;

      case "paragraph":
        children.push(
          new Paragraph({
            children: parseInlineFormatting(section.text || "", options, TextRun),
            spacing: { after: 200, line: options.lineSpacing * 240 },
          })
        );
        break;

      case "list":
        for (let i = 0; i < (section.items?.length || 0); i++) {
          children.push(
            new Paragraph({
              children: parseInlineFormatting(section.items![i], options, TextRun),
              bullet: section.ordered ? undefined : { level: 0 },
              numbering: section.ordered ? { reference: "default-numbering", level: 0 } : undefined,
              spacing: { after: 100 },
            })
          );
        }
        break;

      case "quote":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.text || "", font: options.font, size: options.fontSize * 2, italics: true })],
            indent: { left: 720 },
            spacing: { before: 200, after: 200 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "888888" } },
          })
        );
        break;

      case "code":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.text || "", font: "Courier New", size: 20 })],
            shading: { fill: "f5f5f5" },
            spacing: { before: 200, after: 200 },
          })
        );
        break;

      case "table":
        if (section.rows && section.rows.length > 0) {
          const tableRows = section.rows.map((row, rowIndex) =>
            new TableRow({
              children: row.map(cell =>
                new TableCell({
                  children: [new Paragraph({
                    children: [new TextRun({
                      text: cell,
                      font: options.font,
                      size: options.fontSize * 2,
                      bold: rowIndex === 0,
                    })],
                  })],
                  shading: rowIndex === 0 ? { fill: "e0e0e0" } : undefined,
                })
              ),
            })
          );
          children.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
          );
          children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
        }
        break;

      case "hr":
        children.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "cccccc" } },
            spacing: { before: 200, after: 200 },
          })
        );
        break;
    }
  }

  // Build document
  const doc = new Document({
    creator: options.author || "skills.md",
    title: content.title,
    description: `Generated by generate-docx skill`,
    styles: {
      default: {
        document: {
          run: { font: options.font, size: options.fontSize * 2 },
        },
      },
    },
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{
          level: 0,
          format: NumberFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.LEFT,
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: pageSize,
          margin: {
            top: marginTwips,
            right: marginTwips,
            bottom: marginTwips,
            left: marginTwips,
          },
        },
      },
      headers: options.header ? {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: options.header, font: options.font, size: 18 })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      } : undefined,
      footers: options.pageNumbers || options.footer ? {
        default: new Footer({
          children: [new Paragraph({
            children: [
              ...(options.footer ? [new TextRun({ text: options.footer + "  ", font: options.font, size: 18 })] : []),
              ...(options.pageNumbers ? [
                new TextRun({ children: [PageNumber.CURRENT], font: options.font, size: 18 }),
                new TextRun({ text: " / ", font: options.font, size: 18 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: options.font, size: 18 }),
              ] : []),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      } : undefined,
      children,
    }],
  });

  return doc;
}
