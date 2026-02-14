#!/usr/bin/env bun

import { execFileSync, spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// URL validation to prevent command injection
const VALID_URL_PATTERN = /^https?:\/\/[^\s;|&`$()'"\\]+$/i;
const ALLOWED_HOSTS = [
  "youtube.com", "youtu.be", "www.youtube.com", "m.youtube.com",
  "vimeo.com", "www.vimeo.com", "player.vimeo.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
  "twitter.com", "x.com", "www.twitter.com",
  "facebook.com", "www.facebook.com", "fb.watch",
  "instagram.com", "www.instagram.com",
  "dailymotion.com", "www.dailymotion.com",
  "twitch.tv", "www.twitch.tv", "clips.twitch.tv",
  "reddit.com", "www.reddit.com", "v.redd.it",
  "soundcloud.com", "www.soundcloud.com",
  "bandcamp.com",
  "vk.com", "www.vk.com",
  "bilibili.com", "www.bilibili.com",
];

function validateUrl(url: string): boolean {
  // Check basic URL pattern (no shell metacharacters)
  if (!VALID_URL_PATTERN.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Check against allowlist (allow subdomains)
    return ALLOWED_HOSTS.some(allowed =>
      hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

// Types
interface DownloadOptions {
  quality: string;
  format: string;
  codec: string;
  audioOnly: boolean;
  audioFormat: string;
  audioQuality: number;
  output: string;
  dir: string;
  filename: string;
  subtitles: boolean;
  subLang: string;
  subFormat: string;
  subOnly: boolean;
  autoSub: boolean;
  playlist: boolean;
  playlistStart: number;
  playlistEnd: number | null;
  batch: string | null;
  limit: number | null;
  thumbnail: boolean;
  metadata: boolean;
  chapters: boolean;
  description: boolean;
  info: boolean;
  listFormats: boolean;
  cookies: string | null;
  rateLimit: string | null;
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["quality", "format", "codec", "audio-format", "output", "dir", "filename", "sub-lang", "sub-format", "batch", "cookies", "rate-limit"],
  boolean: ["audio-only", "subtitles", "sub-only", "auto-sub", "playlist", "thumbnail", "metadata", "chapters", "description", "info", "list-formats", "help"],
  default: {
    quality: "best",
    format: "mp4",
    "audio-format": "mp3",
    "audio-quality": 192,
    dir: ".skills/exports",
    filename: "%(title)s",
    "sub-lang": "en",
    "sub-format": "srt",
    "playlist-start": 1,
  },
  alias: {
    o: "output",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Video Downloader - Download videos from YouTube, Vimeo, TikTok, and 1000+ sites

Usage:
  skills run video-downloader -- <url> [options]
  skills run video-downloader -- --batch <file> [options]

Quality Options:
  --quality <res>       Resolution: best, 4k, 2k, 1080, 720, 480, 360, worst
  --format <type>       Video format: mp4, webm, mkv (default: mp4)
  --codec <name>        Video codec: h264, h265, vp9, av1

Audio Options:
  --audio-only          Download audio only
  --audio-format <type> Audio format: mp3, m4a, wav, flac, opus (default: mp3)
  --audio-quality <kbps> Audio bitrate: 128, 192, 256, 320 (default: 192)

Output Options:
  -o, --output <path>   Output file path
  --dir <path>          Output directory (default: .skills/exports)
  --filename <template> Filename template (default: %(title)s)

Subtitle Options:
  --subtitles           Download with subtitles
  --sub-lang <code>     Subtitle language(s): en, es, fr, all (default: en)
  --sub-format <type>   Format: srt, vtt, ass (default: srt)
  --sub-only            Download subtitles only
  --auto-sub            Include auto-generated subs

Playlist/Batch Options:
  --playlist            Download entire playlist
  --playlist-start <n>  Start from video N (default: 1)
  --playlist-end <n>    End at video N
  --batch <file>        File with URLs (one per line)
  --limit <n>           Max videos to download

Metadata Options:
  --thumbnail           Embed thumbnail
  --metadata            Embed metadata
  --chapters            Embed chapters
  --description         Save description to file

Other Options:
  --info                Show video info without downloading
  --list-formats        List available formats
  --cookies <file>      Cookies file for authentication
  --rate-limit <speed>  Download speed limit (e.g., 1M)
  -h, --help            Show this help message

Examples:
  skills run video-downloader -- "https://youtube.com/watch?v=..."
  skills run video-downloader -- "https://youtube.com/watch?v=..." --quality 1080
  skills run video-downloader -- "https://youtube.com/watch?v=..." --audio-only --audio-format mp3
  skills run video-downloader -- "https://youtube.com/playlist?list=..." --playlist
`);
  process.exit(0);
}

// Check for yt-dlp
function checkYtDlp(): boolean {
  try {
    execFileSync("yt-dlp", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

if (!checkYtDlp()) {
  console.error("Error: yt-dlp is not installed");
  console.error("Install it:");
  console.error("  macOS: brew install yt-dlp");
  console.error("  Linux: pip install yt-dlp");
  console.error("  Windows: winget install yt-dlp");
  process.exit(1);
}

// Get URL(s)
const urls: string[] = [];
const inputUrl = args._[0] as string | undefined;

if (args.batch) {
  if (!fs.existsSync(args.batch)) {
    console.error(`Error: Batch file not found: ${args.batch}`);
    process.exit(1);
  }
  const content = fs.readFileSync(args.batch, "utf-8");
  const rawUrls = content.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));

  // Validate each URL
  for (const url of rawUrls) {
    if (!validateUrl(url)) {
      console.error(`Error: Invalid or unsupported URL: ${url}`);
      console.error("Only URLs from supported video platforms are allowed.");
      process.exit(1);
    }
  }
  urls.push(...rawUrls);
} else if (inputUrl) {
  if (!validateUrl(inputUrl)) {
    console.error(`Error: Invalid or unsupported URL: ${inputUrl}`);
    console.error("Only URLs from supported video platforms are allowed.");
    console.error("Supported: YouTube, Vimeo, TikTok, Twitter, Facebook, Instagram, etc.");
    process.exit(1);
  }
  urls.push(inputUrl);
} else if (!args.help) {
  console.error("Error: No URL specified");
  console.error("Usage: skills run video-downloader -- <url> [options]");
  process.exit(1);
}

// Build options
const options: DownloadOptions = {
  quality: args.quality,
  format: args.format,
  codec: args.codec || "",
  audioOnly: args["audio-only"],
  audioFormat: args["audio-format"],
  audioQuality: parseInt(args["audio-quality"]) || 192,
  output: args.output || "",
  dir: args.dir,
  filename: args.filename,
  subtitles: args.subtitles,
  subLang: args["sub-lang"],
  subFormat: args["sub-format"],
  subOnly: args["sub-only"],
  autoSub: args["auto-sub"],
  playlist: args.playlist,
  playlistStart: parseInt(args["playlist-start"]) || 1,
  playlistEnd: args["playlist-end"] ? parseInt(args["playlist-end"]) : null,
  batch: args.batch || null,
  limit: args.limit ? parseInt(args.limit) : null,
  thumbnail: args.thumbnail,
  metadata: args.metadata,
  chapters: args.chapters,
  description: args.description,
  info: args.info,
  listFormats: args["list-formats"],
  cookies: args.cookies || null,
  rateLimit: args["rate-limit"] || null,
};

// Build quality format string
function buildFormatString(): string {
  if (options.audioOnly) {
    return "bestaudio";
  }

  const qualityMap: Record<string, string> = {
    best: "bestvideo+bestaudio/best",
    "4k": "bestvideo[height<=2160]+bestaudio/best[height<=2160]",
    "2k": "bestvideo[height<=1440]+bestaudio/best[height<=1440]",
    "1080": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "720": "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "480": "bestvideo[height<=480]+bestaudio/best[height<=480]",
    "360": "bestvideo[height<=360]+bestaudio/best[height<=360]",
    worst: "worstvideo+worstaudio/worst",
  };

  let format = qualityMap[options.quality] || qualityMap.best;

  // Add codec preference
  if (options.codec) {
    const codecMap: Record<string, string> = {
      h264: "avc1",
      h265: "hvc1",
      vp9: "vp9",
      av1: "av01",
    };
    if (codecMap[options.codec]) {
      format = format.replace("bestvideo", `bestvideo[vcodec^=${codecMap[options.codec]}]`);
    }
  }

  return format;
}

// Build yt-dlp command arguments
function buildArgs(url: string): string[] {
  const ytdlpArgs: string[] = [];

  // Info only mode
  if (options.info) {
    ytdlpArgs.push("--dump-json");
    ytdlpArgs.push(url);
    return ytdlpArgs;
  }

  // List formats mode
  if (options.listFormats) {
    ytdlpArgs.push("--list-formats");
    ytdlpArgs.push(url);
    return ytdlpArgs;
  }

  // Subtitles only mode
  if (options.subOnly) {
    ytdlpArgs.push("--write-sub");
    ytdlpArgs.push("--skip-download");
    if (options.autoSub) {
      ytdlpArgs.push("--write-auto-sub");
    }
    ytdlpArgs.push("--sub-lang", options.subLang);
    ytdlpArgs.push("--sub-format", options.subFormat);
  } else {
    // Format selection
    ytdlpArgs.push("-f", buildFormatString());

    // Output format
    if (options.audioOnly) {
      ytdlpArgs.push("-x");
      ytdlpArgs.push("--audio-format", options.audioFormat);
      ytdlpArgs.push("--audio-quality", `${options.audioQuality}k`);
    } else {
      ytdlpArgs.push("--merge-output-format", options.format);
    }

    // Subtitles
    if (options.subtitles) {
      ytdlpArgs.push("--write-sub");
      ytdlpArgs.push("--embed-subs");
      if (options.autoSub) {
        ytdlpArgs.push("--write-auto-sub");
      }
      ytdlpArgs.push("--sub-lang", options.subLang);
      ytdlpArgs.push("--sub-format", options.subFormat);
    }

    // Metadata
    if (options.thumbnail) {
      ytdlpArgs.push("--embed-thumbnail");
    }
    if (options.metadata) {
      ytdlpArgs.push("--embed-metadata");
    }
    if (options.chapters) {
      ytdlpArgs.push("--embed-chapters");
    }
    if (options.description) {
      ytdlpArgs.push("--write-description");
    }
  }

  // Playlist options
  if (!options.playlist) {
    ytdlpArgs.push("--no-playlist");
  } else {
    ytdlpArgs.push("--yes-playlist");
    if (options.playlistStart > 1) {
      ytdlpArgs.push("--playlist-start", String(options.playlistStart));
    }
    if (options.playlistEnd) {
      ytdlpArgs.push("--playlist-end", String(options.playlistEnd));
    }
  }

  // Limit
  if (options.limit) {
    ytdlpArgs.push("--max-downloads", String(options.limit));
  }

  // Output path
  let outputPath: string;
  if (options.output) {
    outputPath = options.output;
  } else {
    const ext = options.audioOnly ? options.audioFormat : options.format;
    outputPath = path.join(options.dir, `${options.filename}.%(ext)s`);
  }
  ytdlpArgs.push("-o", outputPath);

  // Cookies
  if (options.cookies) {
    ytdlpArgs.push("--cookies", options.cookies);
  }

  // Rate limit
  if (options.rateLimit) {
    ytdlpArgs.push("--limit-rate", options.rateLimit);
  }

  // Progress
  ytdlpArgs.push("--progress");
  ytdlpArgs.push("--newline");

  // URL
  ytdlpArgs.push(url);

  return ytdlpArgs;
}

// Get video info
async function getVideoInfo(url: string): Promise<any> {
  try {
    const result = execFileSync("yt-dlp", ["--dump-json", "--no-playlist", url], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch (error) {
    return null;
  }
}

// Download video
async function downloadVideo(url: string): Promise<{ success: boolean; file?: string; error?: string }> {
  return new Promise((resolve) => {
    const ytdlpArgs = buildArgs(url);

    // For info mode, use execFileSync with array args (safe from injection)
    if (options.info) {
      try {
        const result = execFileSync("yt-dlp", ytdlpArgs, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });
        const info = JSON.parse(result);
        console.log("\nVideo Information:");
        console.log("==================");
        console.log(`Title: ${info.title}`);
        console.log(`Channel: ${info.uploader || info.channel}`);
        console.log(`Duration: ${formatDuration(info.duration)}`);
        console.log(`Views: ${info.view_count?.toLocaleString() || "N/A"}`);
        console.log(`Upload Date: ${info.upload_date || "N/A"}`);
        console.log(`Resolution: ${info.resolution || `${info.width}x${info.height}`}`);
        console.log(`URL: ${info.webpage_url}`);
        if (info.description) {
          console.log(`\nDescription:\n${info.description.slice(0, 500)}${info.description.length > 500 ? "..." : ""}`);
        }
        resolve({ success: true });
      } catch (error: any) {
        resolve({ success: false, error: error.message });
      }
      return;
    }

    // For list-formats mode, use spawnSync with array args (safe from injection)
    if (options.listFormats) {
      try {
        const result = spawnSync("yt-dlp", ["--list-formats", url], { stdio: "inherit" });
        if (result.error) {
          throw result.error;
        }
        resolve({ success: result.status === 0 });
      } catch (error: any) {
        resolve({ success: false, error: error.message });
      }
      return;
    }

    // Ensure output directory exists
    if (!fs.existsSync(options.dir)) {
      fs.mkdirSync(options.dir, { recursive: true });
    }

    // Spawn yt-dlp process
    const ytdlp = spawn("yt-dlp", ytdlpArgs, {
      stdio: ["inherit", "pipe", "pipe"],
    });

    let outputFile = "";
    let lastLine = "";

    ytdlp.stdout?.on("data", (data) => {
      const output = data.toString();
      process.stdout.write(output);

      // Try to capture the output filename
      const destMatch = output.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        outputFile = destMatch[1];
      }
      const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergeMatch) {
        outputFile = mergeMatch[1];
      }
      lastLine = output.trim();
    });

    ytdlp.stderr?.on("data", (data) => {
      process.stderr.write(data);
    });

    ytdlp.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, file: outputFile });
      } else {
        resolve({ success: false, error: `yt-dlp exited with code ${code}` });
      }
    });

    ytdlp.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

// Format duration
function formatDuration(seconds: number): string {
  if (!seconds) return "N/A";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nVideo Downloader`);
  console.log("================\n");

  if (options.info || options.listFormats) {
    // Info mode - just show info
    await downloadVideo(urls[0]);
    return;
  }

  console.log(`URLs to download: ${urls.length}`);
  console.log(`Quality: ${options.quality}`);
  console.log(`Format: ${options.audioOnly ? options.audioFormat + " (audio)" : options.format}`);
  console.log(`Output: ${options.dir}`);
  console.log("");

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] Downloading: ${url}\n`);

    const result = await downloadVideo(url);

    if (result.success) {
      successful++;
      if (result.file) {
        console.log(`\nSaved: ${result.file}`);
      }
    } else {
      failed++;
      console.error(`\nFailed: ${result.error}`);
    }
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log("Download Complete");
  console.log("=".repeat(50));
  console.log(`  Successful: ${successful}`);
  if (failed > 0) {
    console.log(`  Failed: ${failed}`);
  }
  console.log(`  Output: ${options.dir}`);
  console.log("");
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
