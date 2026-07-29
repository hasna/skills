import type { SkillMeta } from "../registry-types.js";

export const PRODUCTIVITY_ORGANIZATION_SKILLS: SkillMeta[] = [
  {
    name: "meeting-pack",
    displayName: "Meeting Pack",
    description: "Generate meeting artifact packages with summaries, decisions, action items, follow-up email, timeline, project export, and manifest",
    category: "Productivity & Organization",
    kind: "instruction",
    tags: ["meeting", "summary", "action-items", "decisions"],
  },
  {
    name: "file-organizer",
    displayName: "File Organizer",
    description: "Organize files into structured directories based on type, date, or content",
    category: "Productivity & Organization",
    tags: ["files", "organization", "sorting", "cleanup"],
  },
  {
    name: "folder-tree",
    displayName: "Folder Tree",
    description: "Generate and display folder tree structures for documentation",
    category: "Productivity & Organization",
    tags: ["folder", "tree", "structure", "visualization"],
  },
  {
    name: "form-filler",
    displayName: "Form Filler",
    description: "Automatically fill out web forms and document templates",
    category: "Productivity & Organization",
    tags: ["forms", "automation", "filling", "data-entry"],
  },
  {
    name: "merge-pdfs",
    displayName: "Merge PDFs",
    description: "Merge multiple PDF files into a single document",
    category: "Productivity & Organization",
    tags: ["pdf", "merge", "documents", "combining"],
  },
  {
    name: "split-pdf",
    displayName: "Split PDF",
    description: "Split PDF documents into separate pages or sections",
    category: "Productivity & Organization",
    tags: ["pdf", "split", "documents", "pages"],
  },
];
