export interface DocOptions {
  output: string;
  dir: string;
  template: "default" | "report" | "letter" | "memo" | "resume" | "article";
  title: string;
  author: string;
  company: string;
  date: string;
  font: string;
  fontSize: number;
  headingFont: string;
  lineSpacing: number;
  margins: number;
  pageSize: "letter" | "a4" | "legal";
  toc: boolean;
  pageNumbers: boolean;
  header: string;
  footer: string;
  topic: string | null;
  prompt: string | null;
  text: string | null;
  sections: number;
  style: "professional" | "casual" | "formal" | "academic";
  tone: "neutral" | "friendly" | "authoritative";
  length: "short" | "medium" | "long" | "comprehensive";
}

export interface ParsedContent {
  title: string;
  sections: ContentSection[];
}

export interface ContentSection {
  type: "heading" | "paragraph" | "list" | "table" | "quote" | "code" | "image" | "hr";
  level?: number;
  text?: string;
  items?: string[];
  rows?: string[][];
  language?: string;
  src?: string;
  ordered?: boolean;
}

export interface CliResult {
  options: DocOptions;
  inputFile?: string;
}

export interface DocumentDeps {
  Document: any;
  Packer: any;
  Paragraph: any;
  TextRun: any;
  HeadingLevel: any;
  Table: any;
  TableRow: any;
  TableCell: any;
  WidthType: any;
  AlignmentType: any;
  BorderStyle: any;
  PageNumber: any;
  NumberFormat: any;
  Header: any;
  Footer: any;
  TableOfContents: any;
  PageBreak: any;
  marked: any;
}
