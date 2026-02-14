#!/usr/bin/env bun
/**
 * Generate Mock Data Skill
 * Generate realistic mock/fake data using AI (GPT-4o-mini) or built-in generators
 */

import { parseArgs } from "util";
import { mkdirSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join, dirname, extname } from "path";
import { randomUUID } from "crypto";
import OpenAI from "openai";

// Types
type Preset = "users" | "products" | "orders" | "companies" | "articles" | "reviews" | "events" | "transactions";
type OutputFormat = "json" | "csv" | "sql" | "typescript";
type Locale = "en-US" | "de-DE" | "ja-JP" | "fr-FR" | "es-ES" | "pt-BR" | "it-IT" | "nl-NL" | "sv-SE" | "pl-PL";

interface GenerateOptions {
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

interface SchemaField {
  [key: string]: string;
}

// Constants
const SKILL_NAME = "generate-mock-data";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available, otherwise fall back to cwd
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "ℹ️";
  console.log(`${prefix} ${message}`);
}

// Preset schemas
const PRESET_SCHEMAS: Record<Preset, SchemaField> = {
  users: {
    id: "uuid",
    firstName: "firstName",
    lastName: "lastName",
    email: "email",
    phone: "phone",
    dateOfBirth: "date",
    username: "username",
    avatarUrl: "avatarUrl",
    address: "address",
    city: "city",
    state: "state",
    zipCode: "zipCode",
    country: "country",
  },
  products: {
    id: "uuid",
    name: "productName",
    description: "paragraph",
    price: "price",
    category: "category",
    sku: "sku",
    stock: "number",
    brand: "company",
    imageUrl: "imageUrl",
    rating: "rating",
  },
  orders: {
    orderId: "uuid",
    customerId: "uuid",
    customerName: "name",
    customerEmail: "email",
    orderDate: "date",
    items: "orderItems",
    subtotal: "price",
    tax: "price",
    shipping: "price",
    total: "price",
    status: "orderStatus",
    trackingNumber: "trackingNumber",
  },
  companies: {
    id: "uuid",
    name: "company",
    industry: "industry",
    employees: "number",
    foundedYear: "year",
    revenue: "price",
    website: "url",
    description: "paragraph",
    logoUrl: "imageUrl",
    address: "address",
    city: "city",
    country: "country",
  },
  articles: {
    id: "uuid",
    title: "title",
    author: "name",
    content: "paragraph",
    excerpt: "sentence",
    publishedDate: "date",
    tags: "tags",
    category: "category",
    readingTime: "number",
    viewCount: "number",
    imageUrl: "imageUrl",
  },
  reviews: {
    id: "uuid",
    reviewerName: "name",
    rating: "rating",
    title: "sentence",
    text: "paragraph",
    date: "date",
    verifiedPurchase: "boolean",
    helpfulCount: "number",
    productId: "uuid",
  },
  events: {
    id: "uuid",
    name: "title",
    description: "paragraph",
    startDate: "date",
    endDate: "date",
    location: "address",
    organizer: "name",
    category: "category",
    attendees: "number",
    ticketPrice: "price",
    status: "eventStatus",
  },
  transactions: {
    transactionId: "uuid",
    amount: "price",
    currency: "currency",
    type: "transactionType",
    date: "date",
    description: "sentence",
    fromAccount: "accountNumber",
    toAccount: "accountNumber",
    status: "transactionStatus",
    balance: "price",
  },
};

// Seeded random number generator
class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = this.hashCode(seed);
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  choice<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }
}

// Built-in data generators
class DataGenerator {
  private random: SeededRandom | null;
  private locale: Locale;

  constructor(seed?: string, locale: Locale = "en-US") {
    this.random = seed ? new SeededRandom(seed) : null;
    this.locale = locale;
  }

  private rand(): number {
    return this.random ? this.random.next() : Math.random();
  }

  private randInt(min: number, max: number): number {
    return this.random ? this.random.nextInt(min, max) : Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private choice<T>(array: T[]): T {
    return this.random ? this.random.choice(array) : array[Math.floor(Math.random() * array.length)];
  }

  // Locale-specific data
  private getFirstNames(): string[] {
    const names: Record<string, string[]> = {
      "en-US": ["James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Christopher", "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen"],
      "de-DE": ["Lukas", "Leon", "Tim", "Paul", "Felix", "Jonas", "Maximilian", "Luis", "Ben", "Noah", "Emma", "Mia", "Hannah", "Sofia", "Anna", "Lena", "Lea", "Marie", "Lina", "Emily"],
      "ja-JP": ["Haruto", "Sota", "Yuto", "Yuki", "Kaito", "Takumi", "Riku", "Sora", "Hinata", "Yui", "Hina", "Sakura", "Yuna", "Aoi", "Miyu", "Rin", "Mei", "Mio", "Nanami", "Riko"],
      "fr-FR": ["Gabriel", "Louis", "Raphael", "Arthur", "Lucas", "Jules", "Adam", "Hugo", "Nathan", "Tom", "Emma", "Louise", "Alice", "Chloe", "Lea", "Manon", "Rose", "Jade", "Clara", "Anna"],
      "es-ES": ["Lucas", "Hugo", "Martin", "Mateo", "Leo", "Daniel", "Alejandro", "Pablo", "Manuel", "Adrian", "Lucia", "Maria", "Sofia", "Julia", "Paula", "Emma", "Martina", "Valeria", "Olivia", "Sara"],
    };
    return names[this.locale] || names["en-US"];
  }

  private getLastNames(): string[] {
    const names: Record<string, string[]> = {
      "en-US": ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"],
      "de-DE": ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann", "Schäfer", "Koch", "Bauer", "Richter", "Klein", "Wolf", "Schröder", "Neumann", "Schwarz", "Zimmermann"],
      "ja-JP": ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Yamaguchi", "Saito", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu"],
      "fr-FR": ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier"],
      "es-ES": ["García", "Rodríguez", "González", "Fernández", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Martín", "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno", "Muñoz", "Álvarez", "Romero", "Alonso", "Gutiérrez"],
    };
    return names[this.locale] || names["en-US"];
  }

  private getCities(): string[] {
    const cities: Record<string, string[]> = {
      "en-US": ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose"],
      "de-DE": ["Berlin", "Hamburg", "München", "Köln", "Frankfurt", "Stuttgart", "Düsseldorf", "Dortmund", "Essen", "Leipzig"],
      "ja-JP": ["Tokyo", "Osaka", "Nagoya", "Sapporo", "Fukuoka", "Kobe", "Kyoto", "Yokohama", "Kawasaki", "Saitama"],
      "fr-FR": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Montpellier", "Bordeaux", "Lille"],
      "es-ES": ["Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza", "Málaga", "Murcia", "Palma", "Las Palmas", "Bilbao"],
    };
    return cities[this.locale] || cities["en-US"];
  }

  private getCountries(): string[] {
    const countries: Record<string, string[]> = {
      "en-US": ["United States", "Canada", "United Kingdom", "Australia", "New Zealand"],
      "de-DE": ["Deutschland", "Österreich", "Schweiz", "Luxemburg", "Belgien"],
      "ja-JP": ["日本", "アメリカ", "中国", "韓国", "オーストラリア"],
      "fr-FR": ["France", "Belgique", "Suisse", "Canada", "Luxembourg"],
      "es-ES": ["España", "México", "Argentina", "Colombia", "Chile"],
    };
    return countries[this.locale] || countries["en-US"];
  }

  uuid(): string {
    return randomUUID();
  }

  string(length: number = 10): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(this.randInt(0, chars.length - 1));
    }
    return result;
  }

  number(min: number = 0, max: number = 1000): number {
    return this.randInt(min, max);
  }

  boolean(): boolean {
    return this.rand() > 0.5;
  }

  email(firstName?: string, lastName?: string): string {
    const first = firstName || this.firstName();
    const last = lastName || this.lastName();
    const domains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "example.com"];
    return `${first.toLowerCase()}.${last.toLowerCase()}@${this.choice(domains)}`;
  }

  phone(): string {
    const formats: Record<string, () => string> = {
      "en-US": () => `+1-${this.randInt(200, 999)}-${this.randInt(200, 999)}-${this.randInt(1000, 9999)}`,
      "de-DE": () => `+49-${this.randInt(30, 89)}-${this.randInt(10000000, 99999999)}`,
      "ja-JP": () => `+81-${this.randInt(3, 9)}-${this.randInt(1000, 9999)}-${this.randInt(1000, 9999)}`,
      "fr-FR": () => `+33-${this.randInt(1, 9)}-${this.randInt(10, 99)}-${this.randInt(10, 99)}-${this.randInt(10, 99)}-${this.randInt(10, 99)}`,
      "es-ES": () => `+34-${this.randInt(600, 799)}-${this.randInt(100, 999)}-${this.randInt(100, 999)}`,
    };
    const format = formats[this.locale] || formats["en-US"];
    return format();
  }

  url(): string {
    const protocols = ["https://"];
    const domains = ["example.com", "test.com", "demo.com", "sample.org", "mock.io"];
    return `${this.choice(protocols)}${this.choice(domains)}`;
  }

  date(): string {
    const start = new Date(2020, 0, 1).getTime();
    const end = new Date().getTime();
    const randomTime = start + this.rand() * (end - start);
    return new Date(randomTime).toISOString();
  }

  firstName(): string {
    return this.choice(this.getFirstNames());
  }

  lastName(): string {
    return this.choice(this.getLastNames());
  }

  name(): string {
    return `${this.firstName()} ${this.lastName()}`;
  }

  username(): string {
    return `${this.firstName().toLowerCase()}${this.randInt(100, 9999)}`;
  }

  address(): string {
    return `${this.randInt(1, 9999)} ${this.choice(["Main", "Oak", "Pine", "Maple", "Cedar", "Elm", "Park", "Washington"])} ${this.choice(["St", "Ave", "Rd", "Blvd", "Dr", "Ln", "Way"])}`;
  }

  city(): string {
    return this.choice(this.getCities());
  }

  state(): string {
    const states = ["CA", "TX", "FL", "NY", "PA", "IL", "OH", "GA", "NC", "MI"];
    return this.choice(states);
  }

  zipCode(): string {
    return this.randInt(10000, 99999).toString();
  }

  country(): string {
    return this.choice(this.getCountries());
  }

  company(): string {
    const prefixes = ["Tech", "Global", "Digital", "Smart", "Dynamic", "Advanced", "Premier"];
    const suffixes = ["Solutions", "Systems", "Corp", "Industries", "Group", "Enterprises", "Technologies"];
    return `${this.choice(prefixes)} ${this.choice(suffixes)}`;
  }

  price(): string {
    return (this.randInt(100, 999999) / 100).toFixed(2);
  }

  paragraph(): string {
    const words = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua"];
    const length = this.randInt(20, 50);
    let paragraph = "";
    for (let i = 0; i < length; i++) {
      paragraph += this.choice(words) + " ";
    }
    return paragraph.trim().charAt(0).toUpperCase() + paragraph.trim().slice(1) + ".";
  }

  sentence(): string {
    const words = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit"];
    const length = this.randInt(5, 12);
    let sentence = "";
    for (let i = 0; i < length; i++) {
      sentence += this.choice(words) + " ";
    }
    return sentence.trim().charAt(0).toUpperCase() + sentence.trim().slice(1) + ".";
  }

  productName(): string {
    const adjectives = ["Premium", "Deluxe", "Professional", "Advanced", "Ultimate", "Essential", "Classic"];
    const products = ["Laptop", "Phone", "Tablet", "Monitor", "Keyboard", "Mouse", "Headphones", "Speaker", "Camera", "Watch"];
    return `${this.choice(adjectives)} ${this.choice(products)}`;
  }

  category(): string {
    return this.choice(["Electronics", "Clothing", "Food", "Books", "Sports", "Home", "Garden", "Toys", "Automotive", "Health"]);
  }

  sku(): string {
    return `SKU-${this.randInt(10000, 99999)}`;
  }

  imageUrl(): string {
    return `https://picsum.photos/seed/${this.randInt(1, 1000)}/800/600`;
  }

  avatarUrl(): string {
    return `https://i.pravatar.cc/300?u=${this.randInt(1, 10000)}`;
  }

  rating(): number {
    return this.randInt(1, 5);
  }

  orderItems(): string {
    const count = this.randInt(1, 5);
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(`${this.productName()} (qty: ${this.randInt(1, 3)})`);
    }
    return items.join(", ");
  }

  orderStatus(): string {
    return this.choice(["pending", "processing", "shipped", "delivered", "cancelled"]);
  }

  trackingNumber(): string {
    return `TRK${this.randInt(100000000, 999999999)}`;
  }

  industry(): string {
    return this.choice(["Technology", "Healthcare", "Finance", "Retail", "Manufacturing", "Education", "Entertainment", "Hospitality", "Transportation", "Energy"]);
  }

  year(): number {
    return this.randInt(1990, 2024);
  }

  title(): string {
    const words = ["How to", "The Best", "Top 10", "Guide to", "Understanding", "Introduction to", "Mastering", "Essential"];
    const topics = ["Technology", "Business", "Marketing", "Design", "Programming", "Leadership", "Innovation", "Strategy"];
    return `${this.choice(words)} ${this.choice(topics)}`;
  }

  tags(): string {
    const allTags = ["technology", "business", "marketing", "design", "development", "productivity", "innovation", "strategy", "leadership", "education"];
    const count = this.randInt(2, 5);
    const selected = [];
    for (let i = 0; i < count; i++) {
      selected.push(this.choice(allTags));
    }
    return selected.join(", ");
  }

  eventStatus(): string {
    return this.choice(["upcoming", "ongoing", "completed", "cancelled"]);
  }

  currency(): string {
    return this.choice(["USD", "EUR", "GBP", "JPY", "CAD", "AUD"]);
  }

  transactionType(): string {
    return this.choice(["debit", "credit", "transfer", "payment", "refund"]);
  }

  accountNumber(): string {
    return `${this.randInt(1000, 9999)}-${this.randInt(1000, 9999)}-${this.randInt(1000, 9999)}`;
  }

  transactionStatus(): string {
    return this.choice(["pending", "completed", "failed", "cancelled"]);
  }

  generateField(fieldType: string): any {
    switch (fieldType) {
      case "string": return this.string();
      case "number": return this.number();
      case "boolean": return this.boolean();
      case "email": return this.email();
      case "phone": return this.phone();
      case "url": return this.url();
      case "date": return this.date();
      case "uuid": return this.uuid();
      case "name": return this.name();
      case "firstName": return this.firstName();
      case "lastName": return this.lastName();
      case "username": return this.username();
      case "address": return this.address();
      case "city": return this.city();
      case "state": return this.state();
      case "zipCode": return this.zipCode();
      case "country": return this.country();
      case "company": return this.company();
      case "price": return this.price();
      case "paragraph": return this.paragraph();
      case "sentence": return this.sentence();
      case "productName": return this.productName();
      case "category": return this.category();
      case "sku": return this.sku();
      case "imageUrl": return this.imageUrl();
      case "avatarUrl": return this.avatarUrl();
      case "rating": return this.rating();
      case "orderItems": return this.orderItems();
      case "orderStatus": return this.orderStatus();
      case "trackingNumber": return this.trackingNumber();
      case "industry": return this.industry();
      case "year": return this.year();
      case "title": return this.title();
      case "tags": return this.tags();
      case "eventStatus": return this.eventStatus();
      case "currency": return this.currency();
      case "transactionType": return this.transactionType();
      case "accountNumber": return this.accountNumber();
      case "transactionStatus": return this.transactionStatus();
      default: return this.string();
    }
  }
}

// Generate data using built-in generators
async function generateDataBuiltin(
  schema: SchemaField,
  count: number,
  seed?: string,
  locale: Locale = "en-US"
): Promise<any[]> {
  const generator = new DataGenerator(seed, locale);
  const data = [];

  for (let i = 0; i < count; i++) {
    const record: any = {};
    for (const [field, type] of Object.entries(schema)) {
      record[field] = generator.generateField(type);
    }
    data.push(record);
  }

  return data;
}

// Generate data using AI (OpenAI GPT-4o-mini)
async function generateDataAI(
  schema: SchemaField,
  count: number,
  locale: Locale = "en-US"
): Promise<any[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for AI mode");
  }

  const openai = new OpenAI({ apiKey });

  log(`Generating ${count} records using AI (GPT-4o-mini)...`);

  const schemaDescription = Object.entries(schema)
    .map(([field, type]) => `- ${field}: ${type}`)
    .join("\n");

  const prompt = `Generate ${count} realistic mock data records as a JSON array.

Schema:
${schemaDescription}

Requirements:
- Return ONLY a valid JSON array of objects
- Each object must have all fields from the schema
- Data should be realistic and diverse
- Use ${locale} locale for localized data (names, addresses, phone numbers)
- No explanations, just the JSON array

Example format:
[
  { "field1": "value1", "field2": "value2" },
  { "field1": "value3", "field2": "value4" }
]`;

  try {
    // Split into batches if count > 50 to avoid token limits
    const batchSize = Math.min(count, 50);
    const batches = Math.ceil(count / batchSize);
    const allData: any[] = [];

    for (let batch = 0; batch < batches; batch++) {
      const currentBatchSize = Math.min(batchSize, count - allData.length);

      log(`Generating batch ${batch + 1}/${batches} (${currentBatchSize} records)...`);

      const batchPrompt = prompt.replace(`Generate ${count}`, `Generate ${currentBatchSize}`);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a data generator that returns only valid JSON arrays. No explanations, no markdown, just JSON.",
          },
          {
            role: "user",
            content: batchPrompt,
          },
        ],
        temperature: 0.8,
      });

      const content = completion.choices[0].message.content || "[]";

      // Clean up response (remove markdown code blocks if present)
      const cleanContent = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const batchData = JSON.parse(cleanContent);

      if (!Array.isArray(batchData)) {
        throw new Error("AI response is not a JSON array");
      }

      allData.push(...batchData);

      // Log cost estimate
      const inputTokens = completion.usage?.prompt_tokens || 0;
      const outputTokens = completion.usage?.completion_tokens || 0;
      const cost = (inputTokens * 0.00015 / 1000) + (outputTokens * 0.0006 / 1000);
      log(`Batch ${batch + 1} cost: $${cost.toFixed(4)}`);
    }

    return allData.slice(0, count);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`AI generation failed: ${error.message}`);
    }
    throw error;
  }
}

// Format data as JSON
function formatJSON(data: any[]): string {
  return JSON.stringify(data, null, 2);
}

// Format data as CSV
function formatCSV(data: any[]): string {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  const rows = data.map(record =>
    headers.map(header => {
      const value = record[header];
      // Escape quotes and wrap in quotes if contains comma or quote
      if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// Format data as SQL INSERT statements
function formatSQL(data: any[], tableName: string): string {
  if (data.length === 0) return "";

  const fields = Object.keys(data[0]);
  const fieldList = fields.join(", ");

  const values = data.map(record =>
    `(${fields.map(field => {
      const value = record[field];
      if (value === null || value === undefined) {
        return "NULL";
      }
      if (typeof value === "string") {
        return `'${value.replace(/'/g, "''")}'`;
      }
      if (typeof value === "boolean") {
        return value ? "TRUE" : "FALSE";
      }
      return value;
    }).join(", ")})`
  );

  return `INSERT INTO ${tableName} (${fieldList}) VALUES\n${values.join(",\n")};`;
}

// Format data as TypeScript
function formatTypeScript(data: any[]): string {
  if (data.length === 0) return "";

  // Generate interface from first record
  const sample = data[0];
  const interfaceFields = Object.entries(sample)
    .map(([key, value]) => {
      let type = typeof value;
      if (type === "object" && value === null) {
        type = "any";
      }
      return `  ${key}: ${type};`;
    })
    .join("\n");

  const interfaceCode = `interface MockData {\n${interfaceFields}\n}`;
  const dataCode = `export const mockData: MockData[] = ${JSON.stringify(data, null, 2)};`;

  return `${interfaceCode}\n\n${dataCode}`;
}

// Generate output filename
function generateOutputFilename(format: OutputFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();
  const extension = format === "typescript" ? "ts" : format;
  return join(EXPORTS_DIR, `mock_data_${timestamp}.${extension}`);
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      preset: { type: "string" },
      count: { type: "string", default: "10" },
      schema: { type: "string" },
      format: { type: "string", default: "json" },
      locale: { type: "string", default: "en-US" },
      seed: { type: "string" },
      realistic: { type: "boolean", default: true },
      "no-ai": { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      table: { type: "string", default: "mock_data" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Generate Mock Data - Generate realistic mock/fake data using AI or built-in generators

Usage:
  bun run src/index.ts [options]

Options:
  --preset <preset>       Data preset (users, products, orders, companies, articles, reviews, events, transactions)
  --count <number>        Number of records to generate [default: 10]
  --schema <json|file>    JSON schema string or file path for custom data
  --format <format>       Output format (json, csv, sql, typescript) [default: json]
  --locale <locale>       Locale for localized data (en-US, de-DE, ja-JP, etc.) [default: en-US]
  --seed <string>         Seed for reproducible random results
  --realistic             Use AI for more realistic data [default: true]
  --no-ai                 Disable AI generation, use built-in generators only
  --output, -o <path>     Custom output file path
  --table <name>          Table name for SQL format [default: mock_data]
  --help, -h              Show this help

Presets:
  users, products, orders, companies, articles, reviews, events, transactions

Examples:
  bun run src/index.ts --preset users --count 100
  bun run src/index.ts --preset products --format csv --no-ai
  bun run src/index.ts --schema '{"name":"string","age":"number"}' --count 50
  bun run src/index.ts --preset orders --format sql --table orders
  bun run src/index.ts --preset users --locale de-DE --count 50
`);
    process.exit(0);
  }

  try {
    log(`Session ID: ${SESSION_ID}`);

    // Parse options
    const count = parseInt(values.count || "10", 10);
    const format = (values.format?.toLowerCase() || "json") as OutputFormat;
    const locale = (values.locale || "en-US") as Locale;
    const realistic = values.realistic && !values["no-ai"];
    const table = values.table || "mock_data";

    // Validate format
    const validFormats: OutputFormat[] = ["json", "csv", "sql", "typescript"];
    if (!validFormats.includes(format)) {
      log(`Invalid format: ${format}. Valid formats: ${validFormats.join(", ")}`, "error");
      process.exit(1);
    }

    // Validate count
    if (isNaN(count) || count < 1) {
      log("Count must be a positive number", "error");
      process.exit(1);
    }

    if (count > 10000) {
      log("Warning: Large datasets (>10000) may take a long time", "info");
    }

    // Get schema
    let schema: SchemaField;

    if (values.schema) {
      // Custom schema from string or file
      let schemaContent = values.schema;

      if (existsSync(values.schema)) {
        log(`Loading schema from file: ${values.schema}`);
        schemaContent = readFileSync(values.schema, "utf-8");
      }

      try {
        schema = JSON.parse(schemaContent);
      } catch (error) {
        log(`Invalid JSON schema: ${error}`, "error");
        process.exit(1);
      }
    } else if (values.preset) {
      // Preset schema
      const preset = values.preset.toLowerCase() as Preset;

      if (!PRESET_SCHEMAS[preset]) {
        log(`Invalid preset: ${preset}. Valid presets: ${Object.keys(PRESET_SCHEMAS).join(", ")}`, "error");
        process.exit(1);
      }

      schema = PRESET_SCHEMAS[preset];
      log(`Using preset: ${preset}`);
    } else {
      log("Please provide either --preset or --schema", "error");
      process.exit(1);
    }

    // Generate data
    log(`Generating ${count} records...`);
    log(`Format: ${format}, Locale: ${locale}`);
    log(`Mode: ${realistic ? "AI (realistic)" : "Built-in (fast)"}`);

    let data: any[];

    if (realistic) {
      data = await generateDataAI(schema, count, locale);
    } else {
      data = await generateDataBuiltin(schema, count, values.seed, locale);
    }

    if (data.length === 0) {
      log("No data generated", "error");
      process.exit(1);
    }

    log(`Generated ${data.length} records`, "success");

    // Format data
    let output: string;

    switch (format) {
      case "json":
        output = formatJSON(data);
        break;
      case "csv":
        output = formatCSV(data);
        break;
      case "sql":
        output = formatSQL(data, table);
        break;
      case "typescript":
        output = formatTypeScript(data);
        break;
    }

    // Save to file
    const outputFile = values.output || generateOutputFilename(format);
    const outputDir = dirname(outputFile);

    ensureDir(outputDir);

    await Bun.write(outputFile, output);

    log(`Data saved to: ${outputFile}`, "success");

    // Show summary
    console.log(`\n✨ Mock data generated successfully!`);
    console.log(`   📊 Records: ${data.length}`);
    console.log(`   📄 Format: ${format}`);
    console.log(`   🌍 Locale: ${locale}`);
    console.log(`   🤖 Mode: ${realistic ? "AI" : "Built-in"}`);
    console.log(`   📁 Output: ${outputFile}`);
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
