import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import { log } from "./runtime";

export const SUPPORTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".heic", ".webp"];

export function validateFiles(files: string[]): string[] {
  const validFiles: string[] = [];

  for (const file of files) {
    if (!existsSync(file)) {
      log(`File not found: ${file}`, "warn");
      continue;
    }

    const ext = extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      log(`Unsupported file type: ${file}`, "warn");
      continue;
    }

    validFiles.push(file);
  }

  return validFiles;
}

export function fileToBase64(filePath: string): string {
  const buffer = readFileSync(filePath);
  return buffer.toString("base64");
}

export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".heic": "image/heic",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "application/octet-stream";
}
