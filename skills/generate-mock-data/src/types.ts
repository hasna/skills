export type Preset = "users" | "products" | "orders" | "companies" | "articles" | "reviews" | "events" | "transactions";
export type OutputFormat = "json" | "csv" | "sql" | "typescript";
export type Locale = "en-US" | "de-DE" | "ja-JP" | "fr-FR" | "es-ES" | "pt-BR" | "it-IT" | "nl-NL" | "sv-SE" | "pl-PL";

export interface GenerateOptions {
  preset?: Preset;
  count: number;
  schema?: string;
  format: OutputFormat;
  locale: Locale;
  seed?: string;
  realistic: boolean;
  output?: string;
  table: string;
}

export interface SchemaField {
  [key: string]: string;
}

// Constants
