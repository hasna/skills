import type { SkillMeta } from "../registry-types.js";

export const DATA_ANALYSIS_SKILLS: SkillMeta[] = [
  {
    name: "analyze-data",
    displayName: "Analyze Data",
    description: "Data science insights for CSV and JSON datasets with statistical analysis",
    category: "Data & Analysis",
    tags: ["data", "analysis", "csv", "json", "statistics"],
  },
  {
    name: "dashboard-builder",
    displayName: "Dashboard Builder",
    description: "Build data dashboards with charts, metrics, and visualizations",
    category: "Data & Analysis",
    tags: ["dashboard", "visualization", "charts", "metrics"],
  },
  {
    name: "data-anonymizer",
    displayName: "Data Anonymizer",
    description: "Anonymize sensitive data in datasets for privacy compliance",
    category: "Data & Analysis",
    tags: ["anonymization", "privacy", "data", "compliance"],
  },
  {
    name: "generate-chart",
    displayName: "Generate Chart",
    description: "Generate data charts and visualizations from datasets",
    category: "Data & Analysis",
    tags: ["charts", "visualization", "data", "graphs"],
  },
  {
    name: "read-csv",
    displayName: "Read CSV",
    description: "Parse CSV files into structured JSON with delimiter and encoding detection",
    category: "Data & Analysis",
    tags: ["csv", "parsing", "tabular", "data"],
  },
  {
    name: "read-excel",
    displayName: "Read Excel",
    description: "Parse XLS and XLSX workbooks into structured JSON with sheet and formatted cell metadata",
    category: "Data & Analysis",
    tags: ["excel", "spreadsheet", "xlsx", "data"],
  },
  {
    name: "pdf-to-markdown",
    displayName: "PDF to Markdown",
    description: "Convert PDFs into clean markdown with remote extraction and structure cleanup",
    category: "Data & Analysis",
    tags: ["pdf", "markdown", "conversion"],
  },
  {
    name: "pdf-to-dataset",
    displayName: "PDF to Dataset",
    description: "Extract PDF tables, forms, invoices, and semi-structured content into CSV and JSON datasets",
    category: "Data & Analysis",
    tags: ["pdf", "dataset", "csv", "json", "extraction"],
  },
  {
    name: "doc-read",
    displayName: "Doc Read",
    description: "Read and extract text from DOCX files with section parsing and metadata extraction",
    category: "Data & Analysis",
    tags: ["docx", "reader", "extraction", "word"],
  },
];
