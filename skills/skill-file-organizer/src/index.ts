#!/usr/bin/env bun
import { readdir, stat, rename, mkdir } from "fs/promises";
import { join, extname } from "path";
import { existsSync } from "fs";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-file-organizer - Organize files into folders by extension or date

Usage:
  skills run file-organizer -- [options]

Options:
  -h, --help           Show this help message
  path=<dir>           Directory to organize (default: current directory)
  strategy=<type>      Organization strategy: extension | date (default: extension)
  dryRun=<bool>        Preview changes without moving files (default: false)

Strategies:
  extension            Group by file type (Images, Video, Audio, Documents, etc.)
  date                 Group by creation date (YYYY-MM folders)

Examples:
  skills run file-organizer -- path=./downloads
  skills run file-organizer -- path=./photos strategy=date
  skills run file-organizer -- path=./files dryRun=true
`);
  process.exit(0);
}

const pathArg = args.find(a => a.startsWith("path="))?.split("=")[1] || ".";
const strategyArg = args.find(a => a.startsWith("strategy="))?.split("=")[1] || "extension";
const dryRunArg = args.find(a => a.startsWith("dryRun="))?.split("=")[1] === "true";

const EXTENSION_MAP: Record<string, string> = {
  ".jpg": "Images", ".jpeg": "Images", ".png": "Images", ".gif": "Images", ".svg": "Images",
  ".mp4": "Video", ".mov": "Video", ".avi": "Video",
  ".mp3": "Audio", ".wav": "Audio",
  ".pdf": "Documents", ".doc": "Documents", ".docx": "Documents", ".txt": "Documents",
  ".zip": "Archives", ".tar": "Archives", ".gz": "Archives",
  ".js": "Code", ".ts": "Code", ".json": "Code", ".html": "Code", ".css": "Code"
};

async function main() {
  console.log(`Organizing ${pathArg} by ${strategyArg} (Dry Run: ${dryRunArg})...`);

  try {
    const files = await readdir(pathArg);

    for (const file of files) {
      const filePath = join(pathArg, file);
      const stats = await stat(filePath);

      if (stats.isDirectory()) continue; // Skip directories
      if (file.startsWith(".")) continue; // Skip hidden files

      let targetFolder = "Misc";

      if (strategyArg === "extension") {
        const ext = extname(file).toLowerCase();
        targetFolder = EXTENSION_MAP[ext] || "Misc";
      } else if (strategyArg === "date") {
        const date = new Date(stats.birthtime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        targetFolder = `${year}-${month}`;
      }

      const targetPath = join(pathArg, targetFolder);
      const newFilePath = join(targetPath, file);

      if (dryRunArg) {
        console.log(`[Dry Run] Move ${file} -> ${targetFolder}/${file}`);
      } else {
        if (!existsSync(targetPath)) {
          await mkdir(targetPath, { recursive: true });
        }
        await rename(filePath, newFilePath);
        console.log(`Moved ${file} -> ${targetFolder}/${file}`);
      }
    }
    console.log("Done!");
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
