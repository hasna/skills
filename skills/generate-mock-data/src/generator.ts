import { randomUUID } from "crypto";

import type { Locale, SchemaField } from "./types";

export class SeededRandom {
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
export class DataGenerator {
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
export async function generateDataBuiltin(
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
