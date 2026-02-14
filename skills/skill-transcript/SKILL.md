---
name: Audio Transcription
description: Transcribe audio and video files using ElevenLabs Scribe, OpenAI Whisper, or Google Gemini. Supports automatic chunking for large files, speaker diarization, timestamps, and multiple output formats (text, SRT, VTT, JSON).
---

# Audio Transcription Skill

This skill provides high-quality speech-to-text transcription using multiple AI providers. It automatically handles large files through compression and chunking.

## Supported Providers

### ElevenLabs Scribe
- **Accuracy**: 96.7% for English (industry-leading)
- **Max file size**: 3GB / 10 hours
- **Features**: Speaker diarization (up to 32 speakers), word-level timestamps
- **Cost**: $0.40/hour
- **Best for**: Multi-speaker recordings, highest accuracy needs

### OpenAI Whisper
- **Accuracy**: Excellent
- **Max file size**: 25MB (automatic chunking for larger files)
- **Features**: Segment timestamps, language detection
- **Cost**: $0.006/min ($0.003/min with GPT-4o Mini)
- **Best for**: Standard transcription, good balance of cost and quality

### Google Gemini
- **Accuracy**: Very good
- **Max file size**: 2GB
- **Features**: Multimodal analysis, summarization capabilities
- **Cost**: ~$0.09-0.23/hour (generous free tier available)
- **Best for**: Cost-sensitive projects, multimodal needs

## Usage

### Basic Transcription
```bash
bun run src/index.ts transcribe \
  --provider openai \
  --input ./recording.mp3
```

### With Speaker Diarization
```bash
bun run src/index.ts transcribe \
  --provider elevenlabs \
  --input ./meeting.mp3 \
  --diarize \
  --timestamps \
  --format srt
```

### Export to Subtitles
```bash
bun run src/index.ts transcribe \
  --provider gemini \
  --input ./video.mp4 \
  --format vtt \
  --output ./captions.vtt
```

### View Provider Info
```bash
bun run src/index.ts providers
```

## Output Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| text | .txt | Plain text transcript |
| srt | .srt | SubRip subtitle format |
| vtt | .vtt | WebVTT subtitle format |
| json | .json | Full structured data with metadata |

## Large File Handling

The skill automatically handles files larger than provider limits:

- **Compression**: For OpenAI, files are first compressed using Opus codec
- **Chunking**: Files are split into 10-minute segments with overlap
- **Merging**: Results are intelligently merged to avoid duplicates

## Configuration

```bash
# ElevenLabs
export ELEVENLABS_API_KEY=your_key

# OpenAI
export OPENAI_API_KEY=your_key

# Google Gemini
export GOOGLE_API_KEY=your_key
```

## Dependencies

For chunking support (OpenAI with large files):
- `ffmpeg` - Audio processing
- `ffprobe` - Duration detection

Install on macOS:
```bash
brew install ffmpeg
```
