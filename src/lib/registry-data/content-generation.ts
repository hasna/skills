import type { SkillMeta } from "../registry-types.js";

export const CONTENT_GENERATION_SKILLS: SkillMeta[] = [
  {
    name: "emoji",
    displayName: "Emoji",
    description: "Generate complete emoji packs using AI with DALL-E 3 or Gemini",
    category: "Content Generation",
    tags: ["emoji", "generation", "ai", "design"],
  },
  {
    name: "generate-diagram",
    displayName: "Generate Diagram",
    description: "Generate diagrams including flowcharts, sequence diagrams, and system architecture",
    category: "Content Generation",
    tags: ["diagrams", "flowcharts", "visualization", "architecture"],
  },
  {
    name: "doc-generate",
    displayName: "Doc Generate",
    description: "Generate DOCX documents with rich formatting, templates, and AI content",
    category: "Content Generation",
    tags: ["docx", "document", "word", "generation"],
  },
  {
    name: "excel",
    displayName: "Excel",
    description: "Generate Excel spreadsheets with data, formulas, and professional styling",
    category: "Content Generation",
    tags: ["excel", "spreadsheet", "generation", "data"],
  },
  {
    name: "pdf-generate",
    displayName: "PDF Generate",
    description: "Generate PDF documents with rich formatting and layouts",
    category: "Content Generation",
    tags: ["pdf", "document", "generation", "formatting"],
  },
  {
    name: "generate-presentation",
    displayName: "Generate Presentation",
    description: "Generate presentation decks with slides, content, and visuals",
    category: "Content Generation",
    tags: ["presentation", "slides", "deck", "generation"],
  },
  {
    name: "slide-deck-generator",
    displayName: "Slide Deck Generator",
    description: "Generate self-hosted slide decks from briefs, docs, or outlines with PDF, PPTX, speaker notes, and structured slide metadata",
    category: "Content Generation",
    tags: ["presentation", "slides", "deck", "documents"],
  },
  {
    name: "generate-qrcode",
    displayName: "Generate QR Code",
    description: "Generate QR codes with custom styling and embedded data",
    category: "Content Generation",
    tags: ["qrcode", "generation", "encoding", "visual"],
  },
  {
    name: "generate-resume",
    displayName: "Generate Resume",
    description: "Generate professional resumes with formatting and content optimization",
    category: "Content Generation",
    tags: ["resume", "cv", "career", "generation"],
  },
];
