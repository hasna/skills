import type { SkillMeta } from "../registry-types.js";

export const CONTENT_GENERATION_SKILLS: SkillMeta[] = [
  {
    name: "pdf-generate",
    displayName: "PDF Generate",
    description: "Generate PDF documents with rich formatting and layouts",
    category: "Content Generation",
    tags: ["pdf", "document", "generation", "formatting"],
  },
  {
    name: "slide-deck-generator",
    displayName: "Slide Deck Generator",
    description: "Generate slide decks from briefs, docs, or outlines with PDF, PPTX, speaker notes, and structured slide metadata",
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
