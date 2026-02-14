#!/usr/bin/env bun

/**
 * QR Code Generator Skill
 *
 * Generates customizable QR codes from text, URLs, or structured data.
 * Supports logos, custom colors, multiple formats, and various QR code types.
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, basename, extname } from "path";
import QRCode from "qrcode";
import sharp from "sharp";

// Types
interface QRCodeOptions {
  type: "text" | "url" | "vcard" | "wifi" | "email" | "sms" | "phone";
  output?: string;
  format: "png" | "svg";
  size: number;
  margin: number;
  color: string;
  background: string;
  errorCorrection: "L" | "M" | "Q" | "H";
  logo?: string;
  logoSize: number;
  logoMargin: number;
  batch?: string;
  batchFormat: string;
}

interface VCardOptions {
  name?: string;
  email?: string;
  phone?: string;
  organization?: string;
  title?: string;
  url?: string;
  address?: string;
  note?: string;
}

interface WiFiOptions {
  ssid?: string;
  password?: string;
  encryption: "WPA" | "WEP" | "nopass";
  hidden: boolean;
}

interface EmailOptions {
  email?: string;
  subject?: string;
  body?: string;
}

interface SMSOptions {
  phone?: string;
  message?: string;
}

function showHelp(): void {
  console.log(`
skill-generate-qrcode - Generate customizable QR codes from text, URLs, or structured data

Usage:
  skills run generate-qrcode -- <content> [options]
  skills run generate-qrcode -- --type wifi --ssid "MyNetwork" --password "secret"

Options:
  -h, --help               Show this help message
  --type <type>            QR code type: text | url | vcard | wifi | email | sms | phone (default: text)
  --output <path>          Output file path
  --format <fmt>           Output format: png | svg (default: png)
  --size <px>              Image size in pixels (default: 300)
  --margin <units>         Quiet zone margin (default: 4)
  --color <hex>            Foreground color (default: #000000)
  --background <hex>       Background color (default: #FFFFFF)
  --error-correction <L|M|Q|H>  Error correction level (default: M)
  --logo <path>            Logo image to embed in center
  --logo-size <percent>    Logo size as percentage (default: 20)
  --logo-margin <px>       Logo margin in pixels (default: 10)
  --batch <file>           Batch file with one content per line
  --batch-format <fmt>     Batch filename format (default: {index})

vCard options:
  --name <name>            Full name
  --email <email>          Email address
  --phone <phone>          Phone number
  --organization <org>     Organization name
  --title <title>          Job title
  --url <url>              Website URL
  --address <addr>         Address
  --note <note>            Additional note

WiFi options:
  --ssid <name>            Network name (required for wifi type)
  --password <pass>        Network password
  --encryption <type>      WPA | WEP | nopass (default: WPA)
  --hidden                 Hidden network flag

Email options:
  --email <email>          Email address (required for email type)
  --subject <subject>      Email subject
  --body <body>            Email body

SMS options:
  --phone <phone>          Phone number (required for sms type)
  --message <msg>          SMS message

Examples:
  skills run generate-qrcode -- "https://example.com" --format svg
  skills run generate-qrcode -- --type wifi --ssid "Office" --password "pass123"
  skills run generate-qrcode -- --type vcard --name "John Doe" --email "john@example.com"
`);
}

// Parse command line arguments
function parseArguments(): {
  content: string;
  options: QRCodeOptions;
  typeOptions: VCardOptions | WiFiOptions | EmailOptions | SMSOptions;
} {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      type: { type: "string", default: "text" },
      output: { type: "string" },
      format: { type: "string", default: "png" },
      size: { type: "string", default: "300" },
      margin: { type: "string", default: "4" },
      color: { type: "string", default: "#000000" },
      background: { type: "string", default: "#FFFFFF" },
      "error-correction": { type: "string", default: "M" },
      logo: { type: "string" },
      "logo-size": { type: "string", default: "20" },
      "logo-margin": { type: "string", default: "10" },
      batch: { type: "string" },
      "batch-format": { type: "string", default: "{index}" },
      // vCard options
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      organization: { type: "string" },
      title: { type: "string" },
      url: { type: "string" },
      address: { type: "string" },
      note: { type: "string" },
      // WiFi options
      ssid: { type: "string" },
      password: { type: "string" },
      encryption: { type: "string", default: "WPA" },
      hidden: { type: "boolean", default: false },
      // Email options
      subject: { type: "string" },
      body: { type: "string" },
      // SMS options
      message: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  const content = positionals[0] || "";

  const options: QRCodeOptions = {
    type: (values.type as any) || "text",
    output: values.output,
    format: (values.format as any) || "png",
    size: parseInt(values.size as string) || 300,
    margin: parseInt(values.margin as string) || 4,
    color: values.color || "#000000",
    background: values.background || "#FFFFFF",
    errorCorrection: (values["error-correction"] as any) || "M",
    logo: values.logo,
    logoSize: parseInt(values["logo-size"] as string) || 20,
    logoMargin: parseInt(values["logo-margin"] as string) || 10,
    batch: values.batch,
    batchFormat: values["batch-format"] || "{index}",
  };

  const typeOptions: any = {};

  if (options.type === "vcard") {
    typeOptions.name = values.name;
    typeOptions.email = values.email;
    typeOptions.phone = values.phone;
    typeOptions.organization = values.organization;
    typeOptions.title = values.title;
    typeOptions.url = values.url;
    typeOptions.address = values.address;
    typeOptions.note = values.note;
  } else if (options.type === "wifi") {
    typeOptions.ssid = values.ssid;
    typeOptions.password = values.password;
    typeOptions.encryption = values.encryption || "WPA";
    typeOptions.hidden = values.hidden || false;
  } else if (options.type === "email") {
    typeOptions.email = values.email;
    typeOptions.subject = values.subject;
    typeOptions.body = values.body;
  } else if (options.type === "sms") {
    typeOptions.phone = values.phone;
    typeOptions.message = values.message;
  } else if (options.type === "phone") {
    typeOptions.phone = values.phone;
  }

  return { content, options, typeOptions };
}

// Generate QR code data based on type
function generateQRData(
  content: string,
  type: string,
  typeOptions: any
): string {
  switch (type) {
    case "vcard":
      return generateVCard(typeOptions);
    case "wifi":
      return generateWiFi(typeOptions);
    case "email":
      return generateEmail(typeOptions);
    case "sms":
      return generateSMS(typeOptions);
    case "phone":
      return generatePhone(typeOptions);
    case "url":
    case "text":
    default:
      return content;
  }
}

// Generate vCard format
function generateVCard(options: VCardOptions): string {
  let vcard = "BEGIN:VCARD\nVERSION:3.0\n";

  if (options.name) {
    const [firstName = "", ...lastNameParts] = options.name.split(" ");
    const lastName = lastNameParts.join(" ");
    vcard += `N:${lastName};${firstName};;;\n`;
    vcard += `FN:${options.name}\n`;
  }

  if (options.organization) {
    vcard += `ORG:${options.organization}\n`;
  }

  if (options.title) {
    vcard += `TITLE:${options.title}\n`;
  }

  if (options.phone) {
    vcard += `TEL;TYPE=WORK,VOICE:${options.phone}\n`;
  }

  if (options.email) {
    vcard += `EMAIL;TYPE=INTERNET:${options.email}\n`;
  }

  if (options.url) {
    vcard += `URL:${options.url}\n`;
  }

  if (options.address) {
    vcard += `ADR;TYPE=WORK:;;${options.address};;;;\n`;
  }

  if (options.note) {
    vcard += `NOTE:${options.note}\n`;
  }

  vcard += "END:VCARD";

  return vcard;
}

// Generate WiFi format
function generateWiFi(options: WiFiOptions): string {
  if (!options.ssid) {
    throw new Error("WiFi SSID is required (use --ssid)");
  }

  const encryption = options.encryption || "WPA";
  const password = options.password || "";
  const hidden = options.hidden ? "true" : "false";

  return `WIFI:T:${encryption};S:${options.ssid};P:${password};H:${hidden};;`;
}

// Generate Email format
function generateEmail(options: EmailOptions): string {
  if (!options.email) {
    throw new Error("Email address is required (use --email)");
  }

  let mailto = `mailto:${options.email}`;
  const params: string[] = [];

  if (options.subject) {
    params.push(`subject=${encodeURIComponent(options.subject)}`);
  }

  if (options.body) {
    params.push(`body=${encodeURIComponent(options.body)}`);
  }

  if (params.length > 0) {
    mailto += "?" + params.join("&");
  }

  return mailto;
}

// Generate SMS format
function generateSMS(options: SMSOptions): string {
  if (!options.phone) {
    throw new Error("Phone number is required (use --phone)");
  }

  let sms = `sms:${options.phone}`;

  if (options.message) {
    sms += `?body=${encodeURIComponent(options.message)}`;
  }

  return sms;
}

// Generate Phone format
function generatePhone(options: any): string {
  if (!options.phone) {
    throw new Error("Phone number is required (use --phone)");
  }

  return `tel:${options.phone}`;
}

// Generate QR code
async function generateQRCode(
  data: string,
  options: QRCodeOptions,
  outputPath: string
): Promise<void> {
  const qrOptions: QRCode.QRCodeToDataURLOptions = {
    errorCorrectionLevel: options.errorCorrection,
    type: options.format === "svg" ? "svg" : "image/png",
    quality: 1,
    margin: options.margin,
    color: {
      dark: options.color,
      light: options.background,
    },
    width: options.size,
  };

  if (options.format === "svg") {
    // Generate SVG
    const svgString = await QRCode.toString(data, {
      ...qrOptions,
      type: "svg",
    });

    writeFileSync(outputPath, svgString);
    console.log(`✓ QR code saved: ${outputPath}`);
  } else {
    // Generate PNG
    const buffer = await QRCode.toBuffer(data, qrOptions);

    // Add logo if specified
    if (options.logo && existsSync(options.logo)) {
      const qrWithLogo = await addLogoToQR(
        buffer,
        options.logo,
        options.size,
        options.logoSize,
        options.logoMargin
      );
      writeFileSync(outputPath, qrWithLogo);
    } else {
      writeFileSync(outputPath, buffer);
    }

    console.log(`✓ QR code saved: ${outputPath}`);
  }
}

// Add logo to QR code
async function addLogoToQR(
  qrBuffer: Buffer,
  logoPath: string,
  qrSize: number,
  logoSizePercent: number,
  logoMargin: number
): Promise<Buffer> {
  const logoSize = Math.floor((qrSize * logoSizePercent) / 100);
  const position = Math.floor((qrSize - logoSize) / 2);

  // Prepare logo
  const logo = await sharp(logoPath)
    .resize(logoSize - logoMargin * 2, logoSize - logoMargin * 2, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .extend({
      top: logoMargin,
      bottom: logoMargin,
      left: logoMargin,
      right: logoMargin,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toBuffer();

  // Composite logo onto QR code
  const result = await sharp(qrBuffer)
    .composite([
      {
        input: logo,
        top: position,
        left: position,
      },
    ])
    .png()
    .toBuffer();

  return result;
}

// Generate output path
function generateOutputPath(
  options: QRCodeOptions,
  index: number = 0,
  content: string = ""
): string {
  if (options.output) {
    // If output is a directory, generate filename
    if (options.output.endsWith("/")) {
      const filename = `qrcode-${Date.now()}-${index}.${options.format}`;
      return join(options.output, filename);
    }
    return options.output;
  }

  // Default output path
  const outputDir =
    process.env.SKILLS_OUTPUT_DIR ||
    join(process.cwd(), ".skills", "exports", "generate-qrcode");

  mkdirSync(outputDir, { recursive: true });

  const timestamp = Date.now();
  const filename = `qrcode-${timestamp}.${options.format}`;

  return join(outputDir, filename);
}

// Process batch file
async function processBatch(options: QRCodeOptions): Promise<void> {
  if (!options.batch || !existsSync(options.batch)) {
    throw new Error(`Batch file not found: ${options.batch}`);
  }

  const content = readFileSync(options.batch, "utf-8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  console.log(`📦 Processing batch: ${lines.length} QR codes\n`);

  // Ensure output directory exists
  const outputDir = options.output || join(
    process.env.SKILLS_OUTPUT_DIR ||
      join(process.cwd(), ".skills", "exports", "generate-qrcode"),
    "batch"
  );

  mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const index = i + 1;

    // Generate filename based on format
    let filename = options.batchFormat
      .replace("{index}", index.toString().padStart(3, "0"))
      .replace("{timestamp}", Date.now().toString())
      .replace("{hash}", Buffer.from(line).toString("hex").substring(0, 8));

    if (!filename.includes(".")) {
      filename += `.${options.format}`;
    }

    const outputPath = join(outputDir, filename);

    // Generate QR code data
    const qrData = generateQRData(line, options.type, {});

    // Generate QR code
    await generateQRCode(qrData, options, outputPath);

    console.log(`  [${index}/${lines.length}] ${line.substring(0, 50)}...`);
  }

  console.log(`\n✓ Batch complete: ${lines.length} QR codes generated`);
  console.log(`📁 Output directory: ${outputDir}`);
}

// Main function
async function main() {
  try {
    console.log("🔲 QR Code Generator\n");

    const { content, options, typeOptions } = parseArguments();

    // Validate inputs
    if (!options.batch && !content && options.type === "text") {
      throw new Error("Please provide content to encode or use --batch for batch generation");
    }

    // Validate format
    if (!["png", "svg"].includes(options.format)) {
      throw new Error(`Invalid format: ${options.format}. Use 'png' or 'svg'`);
    }

    // Validate error correction
    if (!["L", "M", "Q", "H"].includes(options.errorCorrection)) {
      throw new Error(`Invalid error correction: ${options.errorCorrection}. Use 'L', 'M', 'Q', or 'H'`);
    }

    // Process batch if specified
    if (options.batch) {
      await processBatch(options);
      return;
    }

    // Generate QR code data
    const qrData = generateQRData(content, options.type, typeOptions);

    // Generate output path
    const outputPath = generateOutputPath(options);

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    mkdirSync(outputDir, { recursive: true });

    // Generate QR code
    console.log(`📝 Content: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`);
    console.log(`🎨 Format: ${options.format.toUpperCase()}`);
    console.log(`📐 Size: ${options.size}x${options.size}px`);
    console.log(`🔧 Error Correction: ${options.errorCorrection}`);

    if (options.logo) {
      console.log(`🖼️  Logo: ${options.logo}`);
    }

    console.log();

    await generateQRCode(qrData, options, outputPath);

    console.log(`\n✅ QR code generated successfully!`);
    console.log(`📁 Location: ${outputPath}`);

    // Show usage tips
    console.log(`\n💡 Tips:`);
    console.log(`   - Test the QR code with multiple scanners`);
    console.log(`   - Use higher error correction (Q or H) for logos`);
    console.log(`   - Ensure high contrast for reliable scanning`);

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the script
main();
