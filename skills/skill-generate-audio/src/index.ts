#!/usr/bin/env bun
/**
 * Text to Speech Skill
 * Converts text to natural speech using multiple AI providers:
 * - ElevenLabs (v3, v2, turbo, flash)
 * - OpenAI TTS (tts-1-hd, tts-1)
 * - Google Cloud TTS (optional)
 *
 * API Documentation:
 * - ElevenLabs: https://elevenlabs.io/docs/api-reference/text-to-speech
 * - OpenAI: https://platform.openai.com/docs/guides/text-to-speech
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ============================================================================ 
// Types
// ============================================================================ 
type Provider = "elevenlabs" | "openai";

interface TTSOptions {
  text: string;
  provider: Provider;
  voice: string;
  model: string;
  format: string;
  quality: string;
  stability: number;
  clarity: number;
  style: number;
  speed: number;
  language?: string;
}

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

// ============================================================================ 
// Constants
// ============================================================================ 
const SKILL_NAME = "generate-audio";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "_")
  .replace(/-/g, "_")
  .slice(0, 19)
  .toLowerCase();

// ============================================================================ 
// Provider Configurations
// ============================================================================ 
const PROVIDERS: Record<Provider, { name: string; envKey: string }> = {
  elevenlabs: { name: "ElevenLabs", envKey: "ELEVENLABS_API_KEY" },
  openai: { name: "OpenAI TTS", envKey: "OPENAI_API_KEY" },
};

// ============================================================================ 
// ElevenLabs Voice IDs (Default Premium Voices)
// ============================================================================ 
const ELEVENLABS_VOICE_IDS: Record<string, string> = {
  // Female voices - Narrative & Professional
  rachel: "21m00Tcm4TlvDq8ikWAM", // Warm, professional - narration, podcasts
  domi: "AZnzlk1XvdvUeBnXmlld", // Energetic - marketing, ads
  bella: "EXAVITQu4vr4xnSDxMaL", // Soft, gentle
  elli: "MF3mGyEYCl7XYWbV9V6O", // Young female
  charlotte: "XB0fDUnXU5powFXDhCwa", // Swedish female
  matilda: "XrExE9yKIg1WjnnlVkGX", // Warm - children's content
  dorothy: "ThT5KcBeYPX3keUQqHPh", // Pleasant British
  sarah: "EXAVITQu4vr4xnSDxMaL", // Soft, soothing
  emily: "LcfcDJNUP1GQjkzn1xUU", // American female
  gigi: "jBpfuIE2acCO8z3wKNLl", // Expressive
  freya: "jsCqWAovK2LkecY7zXl4", // Warm
  grace: "oWAxZDx7w5VEj9dCyTzz", // Professional
  lily: "pFZP5JQG7iQjIQuC4Bku", // British, elegant
  serena: "pMsXgVXv3BLzUgSXRplE", // Soothing
  nicole: "piTKgcLEGmPE4e6mEKli", // Clear
  jessie: "t0jbNlBVZ17f02VDIeMI", // Friendly
  glinda: "z9fAnlkpzviPz146aGWa", // Magical
  mimi: "zrHiDhphv9ZnVXBqCLjz", // Swedish, gentle

  // Male voices - Narrative & Professional
  drew: "29vD33N1CtxCmqQRPOHJ", // Authoritative - documentaries
  clyde: "2EiwWnXFnvU5JabPnv8n", // Deep, resonant - audiobooks
  paul: "5Q0t7uMcjvnagumLfvZi", // Friendly conversational
  dave: "CYw3kZ02Hs0563khs1Fj", // Casual British
  fin: "D38z5RcWu1voky8WS1ja", // Irish
  antoni: "ErXwobaYiN019PkySvjV", // Young male
  thomas: "GBv7mTt0atIp3Br8iCZE", // Calm - educational
  charlie: "IKne3meq5aSn9XLyUdCD", // Australian
  george: "JBFqnCBsd6RMkjVDRZzb", // British narrator - audiobooks
  callum: "N2lVS1w4EtoT3dr4eOWO", // Scottish
  patrick: "ODq5zmih8GrVes37Dizd", // Deep - trailers
  harry: "SOYHLrjzK2X1ezoPC6cr", // Young British
  liam: "TX3LPaxmHKxFdv7VOQHJ", // Irish - storytelling
  josh: "TxGEqnHWrfWFTfGW9XjX", // Young American
  arnold: "VR6AewLTigWG4xSOukaG", // Robust - action
  matthew: "Yko7PKHZNXotIFUBG7I9", // British - formal
  james: "ZQe5CZNOzWyzPSCn5a3c", // Australian - news
  joseph: "Zlb1dXrM653N07WRdFW3", // British - classic
  jeremy: "bVMeCyTHy58xNoL34h3p", // American conversational
  michael: "flq6f7yk4E4fJM5XTYuZ", // American business
  ethan: "g5CIjZEefAph4nQFvHAz", // American young adult
  chris: "iP95p4xoKVk53GoZ742B", // Energetic
  daniel: "onwK4e9ZLuTAKqWW03F9", // Deep British - authority
  adam: "pNInz6obpgDQGcFmaJgB", // Deep American - professional
  bill: "pqHfZKP75CvOlQylNhV4", // Trustworthy
  sam: "yoZ06aMxZJJ28mfd3POQ", // Neutral
  giovanni: "zcAOhNBS3c14rBihAFp1", // Italian - expressive
};

// ============================================================================ 
// OpenAI Voice Names
// ============================================================================ 
const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

// ============================================================================ 
// Model Configurations
// ============================================================================ 
const ELEVENLABS_MODELS: Record<string, { id: string; description: string; supportsAudioTags: boolean }> = {
  v3: {
    id: "eleven_v3",
    description: "Eleven v3 (Alpha) - Most expressive, supports audio tags",
    supportsAudioTags: true,
  },
  v2: {
    id: "eleven_multilingual_v2",
    description: "Multilingual v2 - Highest quality, 29 languages",
    supportsAudioTags: false,
  },
  multilingual: {
    id: "eleven_multilingual_v2",
    description: "Multilingual v2 - Highest quality, 29 languages",
    supportsAudioTags: false,
  },
  turbo: {
    id: "eleven_turbo_v2_5",
    description: "Turbo v2.5 - Low latency (~300ms), English optimized",
    supportsAudioTags: false,
  },
  flash: {
    id: "eleven_flash_v2_5",
    description: "Flash v2.5 - Ultra-low latency (75ms), real-time applications",
    supportsAudioTags: false,
  },
  v1: {
    id: "eleven_monolingual_v1",
    description: "Monolingual v1 - Legacy English model",
    supportsAudioTags: false,
  },
};

const OPENAI_MODELS: Record<string, { id: string; description: string }> = {
  "tts-1-hd": {
    id: "tts-1-hd",
    description: "OpenAI TTS HD - Highest quality",
  },
  "tts-1": {
    id: "tts-1",
    description: "OpenAI TTS - Fast, good quality",
  },
};

// ============================================================================ 
// Output Format Configurations
// ============================================================================ 
const ELEVENLABS_FORMATS: Record<string, Record<string, string>> = {
  mp3: {
    low: "mp3_22050_32",
    medium: "mp3_44100_64",
    high: "mp3_44100_128",
    ultra: "mp3_44100_192",
  },
  wav: {
    low: "pcm_16000",
    medium: "pcm_22050",
    high: "pcm_44100",
    ultra: "pcm_48000",
  },
  ogg: {
    low: "opus_48000_32",
    medium: "opus_48000_64",
    high: "opus_48000_128",
    ultra: "opus_48000_192",
  },
  flac: {
    low: "pcm_22050",
    medium: "pcm_44100",
    high: "pcm_44100",
    ultra: "pcm_48000",
  },
};

// OpenAI supported formats
const OPENAI_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"];

// File extensions
const FORMAT_EXTENSIONS: Record<string, string> = {
  mp3: "mp3",
  wav: "wav",
  ogg: "ogg",
  flac: "flac",
  opus: "opus",
  aac: "aac",
  pcm: "pcm",
};

// ============================================================================ 
// Utility Functions
// ============================================================================ 
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: "info" | "error" | "success" | "warn" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️";
  console.log(`${prefix} ${message}`);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\\\[.*?\\\\]/g, "") // Remove audio tags for slug
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);
}

function detectAudioTags(text: string): string[] {
  const tagRegex = /\\\\[[^\\]+\\\\]/g;
  const matches = text.match(tagRegex);
  return matches || [];
}

function getProvider(model: string): Provider {
  if (model.startsWith("tts-")) {
    return "openai";
  }
  return "elevenlabs";
}

// ============================================================================ 
// ElevenLabs API Integration
// ============================================================================ 
async function generateWithElevenLabs(options: TTSOptions): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY;

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is not set");
  }

  // Resolve voice ID
  const voiceId = ELEVENLABS_VOICE_IDS[options.voice.toLowerCase()] || options.voice;

  // Resolve model
  const modelKey = options.model.toLowerCase();
  const modelConfig = ELEVENLABS_MODELS[modelKey] || ELEVENLABS_MODELS.v2;
  const modelId = modelConfig.id;

  // Check for audio tags in text
  const audioTags = detectAudioTags(options.text);
  if (audioTags.length > 0) {
    log(`Detected audio tags: ${audioTags.join(", ")}`);
    if (!modelConfig.supportsAudioTags) {
      log(`Warning: Model '${modelKey}' does not support audio tags. Consider using 'v3' for best results.`, "warn");
    }
  }

  // Resolve output format
  const formatConfig = ELEVENLABS_FORMATS[options.format.toLowerCase()] || ELEVENLABS_FORMATS.mp3;
  const outputFormat = formatConfig[options.quality.toLowerCase()] || formatConfig.high;

  log(`Provider: ElevenLabs`);
  log(`Voice: ${options.voice} (${voiceId})`);
  log(`Model: ${modelId} - ${modelConfig.description}`);
  log(`Format: ${outputFormat}`);
  log(`Text length: ${options.text.length} characters`);

  // Build voice settings
  const voiceSettings: VoiceSettings = {
    stability: options.stability,
    similarity_boost: options.clarity,
    style: options.style,
    use_speaker_boost: true,
    speed: options.speed,
  };

  log(
    `Voice settings: stability=${options.stability}, clarity=${options.clarity}, style=${options.style}, speed=${options.speed}`
  );

  // Build request body
  const body: Record<string, unknown> = {
    text: options.text,
    model_id: modelId,
    voice_settings: voiceSettings,
  };

  // Add language if specified
  if (options.language) {
    body.language_code = options.language;
    log(`Language: ${options.language}`);
  }

  // Make API request
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `ElevenLabs API error: ${response.status} ${response.statusText}`;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.detail?.message) {
        errorMessage = `ElevenLabs API error: ${errorJson.detail.message}`;
      } else if (errorJson.detail) {
        errorMessage = `ElevenLabs API error: ${JSON.stringify(errorJson.detail)}`;
      }
    } catch {
      if (errorText) {
        errorMessage = `ElevenLabs API error: ${errorText}`;
      }
    }

    throw new Error(errorMessage);
  }

  log("Speech generated successfully", "success");

  return response.arrayBuffer();
}

// ============================================================================ 
// OpenAI TTS API Integration
// ============================================================================ 
async function generateWithOpenAI(options: TTSOptions): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Resolve voice
  const voice = OPENAI_VOICES.includes(options.voice.toLowerCase()) ? options.voice.toLowerCase() : "alloy";

  // Resolve model
  const modelConfig = OPENAI_MODELS[options.model] || OPENAI_MODELS["tts-1-hd"];
  const modelId = modelConfig.id;

  // Resolve format - OpenAI supports mp3, opus, aac, flac, wav, pcm
  let format = options.format.toLowerCase();
  if (format === "ogg") format = "opus";
  if (!OPENAI_FORMATS.includes(format)) format = "mp3";

  log(`Provider: OpenAI TTS`);
  log(`Voice: ${voice}`);
  log(`Model: ${modelId} - ${modelConfig.description}`);
  log(`Format: ${format}`);
  log(`Speed: ${options.speed}`);
  log(`Text length: ${options.text.length} characters`);

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      input: options.text,
      voice: voice,
      response_format: format,
      speed: options.speed,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  log("Speech generated successfully", "success");

  return response.arrayBuffer();
}

// ============================================================================ 
// Main Generate Function
// ============================================================================ 
async function generateSpeech(options: TTSOptions): Promise<ArrayBuffer> {
  const provider = getProvider(options.model);

  switch (provider) {
    case "openai":
      return generateWithOpenAI(options);
    case "elevenlabs":
    default:
      return generateWithElevenLabs(options);
  }
}

// ============================================================================ 
// Main CLI Handler
// ============================================================================ 
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      voice: { type: "string", default: "rachel" },
      model: { type: "string", default: "v2" },
      format: { type: "string", default: "mp3" },
      quality: { type: "string", default: "high" },
      stability: { type: "string", default: "0.5" },
      clarity: { type: "string", default: "0.75" },
      style: { type: "string", default: "0" },
      speed: { type: "string", default: "1.0" },
      language: { type: "string" },
      file: { type: "string" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                      TEXT TO SPEECH - Multi-Provider AI                        ║
║              Convert text to natural, lifelike speech                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝

USAGE:
  skills run generate-audio -- "<text>" [options]
  skills run generate-audio -- --file ./script.txt [options]

═══════════════════════════════════════════════════════════════════════════════
                              MODELS
═══════════════════════════════════════════════════════════════════════════════

  ElevenLabs (--model):
    v3        Eleven v3 (Alpha) - Most expressive, supports audio tags ⭐
    v2        Multilingual v2 - Highest quality, 29 languages (default)
    turbo     Turbo v2.5 - Low latency (~300ms), English optimized
    flash     Flash v2.5 - Ultra-low latency (75ms), real-time apps

  OpenAI TTS (--model):
    tts-1-hd  OpenAI TTS HD - Highest quality
    tts-1     OpenAI TTS - Fast, good quality

═══════════════════════════════════════════════════════════════════════════════
                              VOICES
═══════════════════════════════════════════════════════════════════════════════

  ElevenLabs Voices (40+ premium voices):
    Female: rachel, domi, bella, elli, charlotte, matilda, dorothy, sarah,
            emily, gigi, freya, grace, lily, serena, nicole, jessie, glinda, mimi
    Male:   drew, clyde, paul, dave, fin, antoni, thomas, charlie, george,
            callum, patrick, harry, liam, josh, arnold, matthew, james, joseph,
            jeremy, michael, ethan, chris, daniel, adam, bill, sam, giovanni

  OpenAI Voices (--voice with --model tts-1 or tts-1-hd):
    alloy     Neutral, balanced
    echo      Warm, conversational
    fable     British, narrative
    onyx      Deep, authoritative
    nova      Energetic, bright
    shimmer   Soft, gentle

═══════════════════════════════════════════════════════════════════════════════
                        ELEVEN V3 AUDIO TAGS ⭐
═══════════════════════════════════════════════════════════════════════════════

  V3 supports inline audio tags for expressive speech. Use --model v3

  EMOTIONS:     [excited] [nervous] [frustrated] [calm] [curious] [happily]
                [angry] [sad] [sorrowful] [crying] [mischievously]

  REACTIONS:    [laughs] [sighs] [gasps] [gulps] [clears throat] [sniffs]

  DELIVERY:     [whispers] [shouts] [softly] [loudly]

  PACING:       [pauses] [hesitates] [stammers]

  TONE:         [cheerfully] [flatly] [deadpan] [playfully] [sarcastically]

  Example:
    skills run generate-audio -- "[sighs] I can't believe it. [excited] We won!" --model v3

═══════════════════════════════════════════════════════════════════════════════

FORMATS (--format):
  mp3     Standard MP3 (default)
  wav     Uncompressed WAV
  ogg     Ogg Vorbis (ElevenLabs) / Opus (OpenAI)
  flac    Lossless FLAC
  aac     AAC (OpenAI only)

QUALITY (--quality for ElevenLabs):
  low     32 kbps - Small files
  medium  64 kbps - Balanced
  high    128 kbps - Good quality (default)
  ultra   192 kbps - Best quality

VOICE SETTINGS (ElevenLabs only):
  --stability <0-1>   Voice stability (default: 0.5)
                      Lower = more expressive, Higher = more consistent
  --clarity <0-1>     Clarity + similarity boost (default: 0.75)
  --style <0-1>       Style exaggeration (default: 0)
  --speed <0.5-2>     Speech speed multiplier (default: 1.0)

OTHER OPTIONS:
  --language <code>   ISO 639-1 language code (auto-detect by default)
  --file <path>       Read text from file instead of argument
  --output, -o <path> Custom output path

EXAMPLES:
  # ElevenLabs - Default v2 model
  skills run generate-audio -- "Hello, welcome to our podcast!"

  # ElevenLabs V3 with audio tags
  skills run generate-audio -- "[whispers] Listen... [excited] This is amazing!" --model v3

  # OpenAI TTS HD with nova voice
  skills run generate-audio -- "Welcome to the future of AI" --model tts-1-hd --voice nova

  # OpenAI TTS fast generation
  skills run generate-audio -- "Quick announcement" --model tts-1 --voice onyx

  # ElevenLabs professional narration
  skills run generate-audio -- "In today's episode..." --voice george --quality ultra

  # ElevenLabs fast turbo for real-time
  skills run generate-audio -- "Breaking news!" --voice drew --model turbo

  # OpenAI with slower speed
  skills run generate-audio -- "Take your time..." --model tts-1-hd --voice shimmer --speed 0.8
");
    process.exit(0);
  }

  // Get text from argument or file
  let text = positionals.join(" ");

  if (values.file) {
    if (!existsSync(values.file as string)) {
      log(`File not found: ${values.file}`, "error");
      process.exit(1);
    }
    text = readFileSync(values.file as string, "utf-8").trim();
    log(`Read ${text.length} characters from ${values.file}`);
  }

  if (!text) {
    log("Please provide text to convert or use --file <path>", "error");
    console.log("Run with --help for usage information");
    process.exit(1);
  }

  try {
    // Determine output path
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "_")
      .replace(/-/g, "_")
      .slice(0, 19)
      .toLowerCase();
    const textSlug = slugify(text);
    const voiceSlug = values.voice || "rachel";
    const modelSlug = values.model || "v2";
    const provider = getProvider(values.model as string);

    // Determine format extension
    let format = (values.format as string)?.toLowerCase() || "mp3";
    if (provider === "openai" && format === "ogg") format = "opus";
    const extension = FORMAT_EXTENSIONS[format] || "mp3";

    const defaultOutput = join(EXPORTS_DIR, `export_${timestamp}_${textSlug}_${voiceSlug}_${modelSlug}.${extension}`);
    const outputPath = (values.output as string) || defaultOutput;

    log(`Session ID: ${SESSION_ID}`);
    log(`Output will be saved to: ${outputPath}`);

    // Generate speech
    const audioBuffer = await generateSpeech({
      text,
      provider,
      voice: values.voice as string,
      model: values.model as string,
      format: format,
      quality: values.quality as string,
      stability: parseFloat(values.stability as string),
      clarity: parseFloat(values.clarity as string),
      style: parseFloat(values.style as string),
      speed: parseFloat(values.speed as string),
      language: values.language as string | undefined,
    });

    // Save audio file
    ensureDir(dirname(outputPath));
    writeFileSync(outputPath, Buffer.from(audioBuffer));

    const fileSizeKB = Math.round(audioBuffer.byteLength / 1024);
    log(`Audio saved: ${outputPath} (${fileSizeKB} KB)`, "success");

    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         ✨ SPEECH GENERATED SUCCESSFULLY                       ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  📁 Output: ${outputPath.padEnd(63)}║
║  📊 Size: ${(fileSizeKB + " KB").padEnd(66)}║
║  🤖 Provider: ${(PROVIDERS[provider].name).padEnd(61)}║
║  📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`).padEnd(66)}║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();