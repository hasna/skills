/**
 * Parsing and input processing logic
 */

export interface Slide {
  type: "title" | "content" | "two-column" | "image" | "code" | "quote" | "bullets";
  title?: string;
  subtitle?: string;
  content: string[];
  notes?: string;
  backgroundImage?: string;
  columns?: { left: string[]; right: string[] };
  codeLanguage?: string;
  imageUrl?: string;
  imagePrompt?: string;
}

export interface Presentation {
  title: string;
  subtitle?: string;
  author?: string;
  date: string;
  slides: Slide[];
  metadata: Record<string, any>;
}

export interface SlideOptions {
  // Input
  inputFile?: string;
  text?: string;
  topic?: string;
  outline: boolean;

  // AI Generation
  aiGenerate: boolean;
  slideCount: number;
  audience: string;
  style: string;
  language: string;
  includeImages: boolean;

  // Output
  format: "pptx" | "pdf" | "html" | "revealjs";
  output?: string;
  dir: string;

  // Theme
  theme: "corporate" | "creative" | "minimal" | "dark" | "light" | "tech";

  // Content
  title?: string;
  author?: string;
  date: string;
  notes: boolean;
  footer?: string;
  slideNumbers: boolean;

  // Layout
  aspectRatio: "16:9" | "4:3" | "16:10";

  // Branding
  logo?: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  primaryColor?: string;
  secondaryColor?: string;
  font?: string;

  // Animation
  transition: "none" | "fade" | "slide" | "convex" | "concave" | "zoom";
  transitionSpeed: "slow" | "default" | "fast";

  // Code
  codeTheme: string;
  lineNumbers: boolean;
}

export function parseMarkdown(content: string, options: SlideOptions): Presentation {
  const lines = content.split("\n");
  const slides: Slide[] = [];
  let currentSlide: Slide | null = null;
  let inNotes = false;
  let inColumns = false;
  let currentColumn: "left" | "right" | null = null;
  let inCodeBlock = false;
  let metadata: Record<string, any> = {};

  // Extract frontmatter
  let inFrontmatter = false;
  let frontmatterLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Frontmatter handling
    if (trimmed === "---" && i === 0) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && trimmed === "---") {
      inFrontmatter = false;
      metadata = parseFrontmatter(frontmatterLines.join("\n"));
      continue;
    }
    if (inFrontmatter) {
      frontmatterLines.push(line);
      continue;
    }

    // Code block tracking
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (!currentSlide) currentSlide = { type: "content", content: [] };
      if (inCodeBlock) {
        const lang = trimmed.substring(3).trim();
        if (lang) currentSlide.codeLanguage = lang;
        currentSlide.type = "code";
      }
      currentSlide.content.push(line);
      continue;
    }

    if (inCodeBlock) {
      if (currentSlide) currentSlide.content.push(line);
      continue;
    }

    // Slide separator
    if ((trimmed === "---" || trimmed === "===") && !inFrontmatter) {
      if (currentSlide) slides.push(currentSlide);
      currentSlide = { type: "bullets", content: [] };
      inNotes = false;
      inColumns = false;
      currentColumn = null;
      continue;
    }

    // Notes block
    if (trimmed === "::: notes" || trimmed.startsWith("::: notes")) {
      inNotes = true;
      if (!currentSlide) currentSlide = { type: "bullets", content: [] };
      currentSlide.notes = "";
      continue;
    }
    if (inNotes && trimmed === ":::") {
      inNotes = false;
      continue;
    }
    if (inNotes) {
      if (currentSlide) {
        currentSlide.notes = (currentSlide.notes || "") + line + "\n";
      }
      continue;
    }

    // Columns block
    if (trimmed === "::: columns") {
      inColumns = true;
      if (!currentSlide) currentSlide = { type: "two-column", content: [] };
      currentSlide.type = "two-column";
      currentSlide.columns = { left: [], right: [] };
      continue;
    }
    if (trimmed === ":::: column") {
      currentColumn = currentColumn ? "right" : "left";
      continue;
    }
    if (trimmed === "::::" && currentColumn) {
      currentColumn = null;
      continue;
    }
    if (trimmed === ":::" && inColumns) {
      inColumns = false;
      continue;
    }
    if (inColumns && currentColumn && currentSlide?.columns) {
      currentSlide.columns[currentColumn].push(trimmed);
      continue;
    }

    // Title slide (# heading)
    if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
      if (currentSlide) slides.push(currentSlide);
      currentSlide = {
        type: "title",
        title: trimmed.substring(2),
        content: [],
      };
      continue;
    }

    // Content slide (## heading)
    if (trimmed.startsWith("## ")) {
      if (currentSlide) slides.push(currentSlide);
      currentSlide = {
        type: "bullets",
        title: trimmed.substring(3),
        content: [],
      };
      continue;
    }

    // Subheading (### heading)
    if (trimmed.startsWith("### ")) {
      if (!currentSlide) currentSlide = { type: "bullets", content: [] };
      currentSlide.subtitle = trimmed.substring(4);
      continue;
    }

    // Quote block
    if (trimmed.startsWith("> ")) {
      if (!currentSlide) currentSlide = { type: "quote", content: [] };
      currentSlide.type = "quote";
      currentSlide.content.push(trimmed.substring(2));
      continue;
    }

    // Bullet points
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.match(/^\d+\. /)) {
      if (!currentSlide) currentSlide = { type: "bullets", content: [] };
      const bulletContent = trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
      currentSlide.content.push(bulletContent);
      continue;
    }

    // Image
    if (trimmed.match(/^!\[.*?\]\(.*?\)$/)) {
      if (!currentSlide) currentSlide = { type: "image", content: [] };
      const match = trimmed.match(/^!\[.*?\]\((.*?)\)$/);
      if (match) {
        currentSlide.type = "image";
        currentSlide.imageUrl = match[1];
      }
      continue;
    }

    // Regular content
    if (trimmed && !currentSlide) {
      currentSlide = { type: "content", content: [] };
    }
    if (currentSlide && trimmed) {
      currentSlide.content.push(trimmed);
    }
  }

  // Add last slide
  if (currentSlide) slides.push(currentSlide);

  const title = options.title || metadata.title || (slides[0]?.type === "title" ? slides[0].title : "Presentation");

  return {
    title,
    subtitle: metadata.subtitle,
    author: options.author || metadata.author,
    date: options.date,
    slides,
    metadata,
  };
}

function parseFrontmatter(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }

  return result;
}

export function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
