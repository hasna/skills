import type { DocumentDeps } from "./types";

let loadedDeps: DocumentDeps | null = null;

export async function loadDocumentDeps(): Promise<DocumentDeps> {
  if (loadedDeps) return loadedDeps;

  try {
    const docx = await import("docx");
    const { marked } = await import("marked");
    loadedDeps = {
      Document: docx.Document,
      Packer: docx.Packer,
      Paragraph: docx.Paragraph,
      TextRun: docx.TextRun,
      HeadingLevel: docx.HeadingLevel,
      Table: docx.Table,
      TableRow: docx.TableRow,
      TableCell: docx.TableCell,
      WidthType: docx.WidthType,
      AlignmentType: docx.AlignmentType,
      BorderStyle: docx.BorderStyle,
      PageNumber: docx.PageNumber,
      NumberFormat: docx.NumberFormat,
      Header: docx.Header,
      Footer: docx.Footer,
      TableOfContents: docx.TableOfContents,
      PageBreak: docx.PageBreak,
      marked,
    };
    return loadedDeps;
  } catch {
    throw new Error("Missing document generation dependencies. Run bun install in this skill directory.");
  }
}

export async function createOpenAIClient(apiKey: string) {
  try {
    const { default: OpenAI } = await import("openai");
    return new OpenAI({ apiKey });
  } catch {
    throw new Error("Missing dependency 'openai'. Run bun install in this skill directory.");
  }
}
