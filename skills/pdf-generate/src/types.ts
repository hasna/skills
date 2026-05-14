export const PAGE_FORMATS: Record<string, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 216, height: 279 },
  Legal: { width: 216, height: 356 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Tabloid: { width: 279, height: 432 },
};

export interface GenerateOptions {
  content?: string;
  contentType: "markdown" | "html" | "text";
  format: string;
  orientation: "portrait" | "landscape";
  margin: { top: string; right: string; bottom: string; left: string };
  header?: string;
  footer?: string;
  displayHeaderFooter: boolean;
  printBackground: boolean;
  css?: string;
  title?: string;
  author?: string;
  subject?: string;
  filename?: string;
  template?: string;
  data?: Record<string, string>;
  url?: string;
}
