export interface CliOptions {
  url?: string;
  output: string;
  timeout: number;
  maxAssets: number;
  download: boolean;
  json: boolean;
}

export interface AssetCandidate {
  role: string;
  sourceUrl: string;
  attributes: Record<string, string>;
}

export interface DownloadedAsset {
  role: string;
  file: string | null;
  sourceUrl: string;
  contentType: string | null;
  bytes: number | null;
  status: "downloaded" | "skipped" | "failed";
  note?: string;
  attributes: Record<string, string>;
}

export type ColorKind = "meta" | "manifest" | "custom-property" | "declaration";

export interface ColorHit {
  hex: string;
  raw: string;
  name: string;
  kind: ColorKind;
  foundIn: string;
}

export interface FontHit {
  stack: string;
  families: string[];
  property: string;
  foundIn: string;
}

/* ------------------------------------------------------------------ */
/* deps                                                                */
/* ------------------------------------------------------------------ */

export type HtmlNode = {
  getAttribute(name: string): string | undefined;
  removeAttribute?(name: string): void;
  text: string;
  rawText: string;
  toString(): string;
  querySelectorAll(selector: string): HtmlNode[];
  querySelector(selector: string): HtmlNode | null;
  tagName?: string;
  attributes: Record<string, string>;
};

