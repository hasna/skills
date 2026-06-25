---
name: transcript
description: Transcribe audio, video, YouTube, Vimeo, and generic media URLs with iapp-transcriber or the hosted Skills runtime. Supports OpenAI GPT-4o transcription, OpenAI diarization, ElevenLabs Scribe v2, DeepGram, chunking, source metadata, subtitles, and JSON outputs.
---

# Transcript

Create transcripts from local audio/video files or media URLs. Use this skill when the user asks to transcribe, caption, diarize, summarize, or package spoken audio/video content.

## Choose The Runtime

- Use the hosted Skills runtime when the user explicitly runs `skills run transcript`, needs remote execution, or has only `SKILLS_API_KEY` configured.
- Use local `iapp-transcriber` when you are on this machine and need direct access to local files, YouTube/Vimeo/generic `yt-dlp` sources, transcript DB records, MCP tools, comments, exports, or OpenLoops follow-up workflows.
- The local command is `transcriber` when installed, or `bun run src/cli/index.ts` from `/home/hasna/Workspace/hasnaxyz/internalapp/iapp-transcriber`.

## Hosted Usage

```bash
skills run transcript --source ./meeting.mp3 --title "Design review" --provider openai
skills run transcribe --source https://www.youtube.com/watch?v=... --provider openai --diarize
```

Poll hosted runs with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.

## Local Usage

```bash
transcriber transcribe ./meeting.mp3 --provider openai --json
transcriber transcribe https://www.youtube.com/watch?v=... --provider openai --model gpt-4o-transcribe --json
transcriber transcribe ./meeting.mp3 --provider openai --diarize --json
transcriber export <transcript-id> --format srt --output captions.srt
```

Local provider defaults:

- `openai`: default, uses `gpt-4o-transcribe`; `--diarize` uses `gpt-4o-transcribe-diarize`.
- `elevenlabs`: uses `scribe_v2`, supports diarization and keyterms.
- `deepgram`: uses Nova-3, supports diarization.

Local requirements:

- A configured provider credential for the selected local provider.
- `yt-dlp` for remote media URLs. Set `YTDLP_PATH` if needed.
- `ffmpeg`/`ffprobe`; the local app bundles npm ffmpeg/ffprobe and also respects `FFMPEG_PATH` and `FFPROBE_PATH`.

## Workflow

1. Inspect source metadata first for URLs:

   ```bash
   transcriber info <url> --json
   ```

2. Download audio when the user asks to keep media:

   ```bash
   transcriber download <url> --format mp3 --json
   ```

3. Transcribe with JSON for automation:

   ```bash
   transcriber transcribe <path-or-url> --provider openai --json
   ```

4. Export or post-process:

   ```bash
   transcriber get <id> --json
   transcriber export <id> --format txt --output transcript.txt
   transcriber summarize <id>
   ```

5. For repeat work, create OpenLoops command loops around JSON-producing commands, for example `transcriber feed check --json --dry-run`.

## Safety

- Only fetch URLs the user is authorized to process.
- The local app rejects private/local URL hosts by default; set `TRANSCRIBER_ALLOW_PRIVATE_URLS=1` only for trusted internal sources.
- Prefer `--json` for scripts and OpenLoops so failures include a structured transcript record and nonzero exit code.
