---
name: audio-transcript-pack
description: Build a transcript package - timestamped transcript, SRT captions, summary, show notes, clip suggestions, and repurposing copy - from an existing text transcript with no API key, or from audio/video using your own OpenAI-compatible key.
---

# Audio Transcript Pack

Turn a recording or an existing transcript into a publishable package: a timestamped transcript,
caption file, extractive summary, chapterized show notes, clip queue, and repurposing copy.

There are two paths:

- **Text path (no key, fully offline).** Give it a `.txt`, `.md`, `.srt`, or `.vtt` file and
  everything is parsed, timed, scored, and rendered locally. Nothing leaves the machine.
- **Audio path (your own key).** Give it a media file and it uploads that file to an
  OpenAI-compatible transcription endpoint using **your** `OPENAI_API_KEY`.

## Requirements

- [Bun](https://bun.sh) 1.1+.
- `bun install` inside this skill directory. There are **no runtime dependencies** — the skill uses
  only Bun/Node built-ins and the platform `fetch`.
- **Text sources need no API key and make no network calls.**
- **Audio and video sources require `OPENAI_API_KEY`** — your own OpenAI (or OpenAI-compatible)
  credential. The file is POSTed as multipart form data to `{api-base}/audio/transcriptions` with
  `model=whisper-1` and `response_format=verbose_json` so segment timings come back with the text.
  There is no proxy, no bundled credential, and no fallback: if the variable is missing the run
  fails immediately with exit code 1 and this message:

  ```
  audio-transcript-pack: OPENAI_API_KEY is not set. Transcribing audio requires your own OpenAI-compatible API key. Export OPENAI_API_KEY, or pass a text transcript with --source <file>.txt to run without any key.
  ```

- Optional environment variable: `OPENAI_API_BASE` sets the default for `--api-base` (useful for
  self-hosted or OpenAI-compatible servers). `--api-base` on the command line wins.

Supported text extensions: `.txt`, `.md`, `.markdown`, `.text`, `.srt`, `.vtt`.
Supported media extensions: `.mp3`, `.m4a`, `.m4b`, `.mp4`, `.mpeg`, `.mpga`, `.wav`, `.webm`,
`.flac`, `.ogg`, `.oga`, `.opus`, `.aac`, `.mov`, `.avi`, `.mkv`, `.wma`.

## Usage

```bash
# No key needed — text transcript in, full package out
bun run src/index.ts --source ./episode-transcript.txt \
  --title "Usage-based billing teardown" --speakers "Host,Guest" \
  --format podcast --duration-minutes 42 --output ./pack

# Caption files keep their original cue timings
bun run src/index.ts --source ./episode.srt --output ./pack

# Audio — requires YOUR key
export OPENAI_API_KEY=sk-...
bun run src/index.ts --source ./episode.mp3 --speakers "Host" --output ./pack

# Any OpenAI-compatible server
bun run src/index.ts --source ./episode.wav --api-base https://my-whisper.internal/v1 --model whisper-1
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --source <path>` | Transcript file or audio/video file. Also accepted as a bare positional argument. | required |
| `-t, --title <text>` | Recording title. | derived from the file name |
| `--speakers <list>` | Comma-separated speaker names. Text transcripts keep any `Name:` labels found in the source. | `Speaker 1` |
| `-f, --format <type>` | `podcast`, `meeting`, `lecture`, `interview`, or `general`. | `general` |
| `-d, --duration-minutes <n>` | Known runtime. Used to pace timings for untimed text (otherwise 150 wpm). | — |
| `--clips <n>` | Number of clip suggestions (1–50). | `6` |
| `-o, --output <dir>` | Output directory. | `./transcript-pack` |
| `-m, --model <name>` | Transcription model (audio path only). | `whisper-1` |
| `--api-base <url>` | OpenAI-compatible base URL (audio path only). | `$OPENAI_API_BASE` or `https://api.openai.com/v1` |
| `-l, --language <code>` | ISO-639-1 language hint for transcription. | auto |
| `--json` | Print `manifest.json` to stdout instead of the text summary. | off |
| `-h, --help` | Show help. | — |
| `-v, --version` | Show version. | — |

## Outputs

Written under `--output`:

| File | Contents |
|------|----------|
| `transcript.md` | Metadata header plus the timestamped, speaker-labelled transcript. |
| `captions.srt` | Valid SRT: cues wrapped at 42 characters, capped at 7 seconds, 0.8s minimum. |
| `summary.md` | Extractive TL;DR with timestamps, ranked key topics, chapter recap, and stats. |
| `show-notes.md` | Description, chapter list with timestamps, pull quotes, detected links, tags. |
| `clips.csv` | Clip queue: `rank,start,end,duration_seconds,speaker,title,hook,quote`. |
| `repurposing.md` | Hook, social post, thread, newsletter blurb, blog outline, video description, clip queue. |
| `segments.json` | Machine-readable segments: index, start, end, speaker, text. |
| `manifest.json` | Run metadata including whether transcription was used, the model and API base, and how timings were derived. |

## Notes

- Timing provenance is always recorded in `manifest.json` as one of `from source cues`,
  `from transcription segments`, or `estimated from word counts`.
- Summaries, chapters, and clips are **extractive** — every sentence in the output appears verbatim
  in the transcript. Nothing is invented, and no language model is called for this analysis.
- The transcription API does not return diarization, so audio-path transcripts attribute every line
  to the first `--speakers` name and say so in `transcript.md`.
- Errors from the transcription endpoint are surfaced verbatim (status, endpoint, response body)
  rather than being swallowed or retried against a different host.
