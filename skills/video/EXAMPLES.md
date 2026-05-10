# Video Generation Examples

This document provides real-world examples for using the video generation skill.

## Quick Start

### 1. Basic Video Generation

```bash
# Simple prompt with Runway (fastest)
bun run src/index.ts generate \
  --provider runway \
  --prompt "a dog running through a field" \
  --output ./dog.mp4
```

### 2. Check Status

```bash
# After generation starts, check status with the returned job ID
bun run src/index.ts status \
  --provider runway \
  --job-id <your-job-id>
```

## Provider-Specific Examples

### Google Veo 2 - Cinematic Videos

```bash
# Wide-angle landscape shot
bun run src/index.ts generate \
  --provider google \
  --prompt "wide-angle shot of misty mountains at dawn, slow camera dolly forward" \
  --resolution 4k \
  --duration 5 \
  --output ./mountains.mp4

# Close-up with specific lens
bun run src/index.ts generate \
  --provider google \
  --prompt "macro lens close-up of water droplets on a leaf, shallow depth of field" \
  --resolution 1080p \
  --output ./droplets.mp4

# Camera movement
bun run src/index.ts generate \
  --provider google \
  --prompt "drone shot flying over a forest, ascending movement, golden hour lighting" \
  --resolution 4k \
  --output ./forest-drone.mp4
```

### OpenAI Sora - Creative Scenes

```bash
# Stylized animation
bun run src/index.ts generate \
  --provider openai \
  --prompt "a person walking through a neon-lit cyberpunk city at night" \
  --resolution 1080p \
  --output ./cyberpunk.mp4

# Natural scene
bun run src/index.ts generate \
  --provider openai \
  --prompt "waves crashing on a beach during sunset, slow motion" \
  --duration 8 \
  --output ./waves.mp4
```

### Runway - Fast Generation

```bash
# Product shot
bun run src/index.ts generate \
  --provider runway \
  --prompt "rotating product shot of a modern smartphone on a clean white background" \
  --aspect-ratio 1:1 \
  --output ./product.mp4

# Social media content (vertical)
bun run src/index.ts generate \
  --provider runway \
  --prompt "coffee being poured into a cup, steam rising" \
  --aspect-ratio 9:16 \
  --duration 5 \
  --output ./coffee-vertical.mp4

# Landscape (horizontal)
bun run src/index.ts generate \
  --provider runway \
  --prompt "time-lapse of clouds moving over a city skyline" \
  --aspect-ratio 16:9 \
  --duration 10 \
  --output ./timelapse.mp4
```

## Advanced Techniques

### High-Quality Cinematic Prompts (Google Veo 2)

Google Veo 2 understands professional cinematography terms. Use these for better results:

```bash
# Lens types
- "wide-angle lens"
- "telephoto lens"
- "macro lens"
- "fisheye lens"

# Camera movements
- "dolly forward/backward"
- "pan left/right"
- "tilt up/down"
- "crane shot"
- "steadicam tracking shot"
- "drone shot ascending/descending"

# Depth of field
- "shallow depth of field" (blurred background)
- "deep depth of field" (everything in focus)

# Lighting
- "golden hour lighting"
- "blue hour"
- "hard lighting"
- "soft diffused lighting"
- "rim lighting"
- "dramatic side lighting"
```

Example combining multiple techniques:

```bash
bun run src/index.ts generate \
  --provider google \
  --prompt "telephoto lens shot of a bird in flight, shallow depth of field with blurred background, golden hour warm lighting, slow-motion, tracking camera movement following the bird" \
  --resolution 4k \
  --duration 5 \
  --output ./bird-cinematic.mp4
```

### Aspect Ratios for Different Platforms

```bash
# Instagram Stories / TikTok (vertical)
--aspect-ratio 9:16

# YouTube / Standard video (horizontal)
--aspect-ratio 16:9

# Instagram Feed (square)
--aspect-ratio 1:1
```

### Resolution Guidelines

```bash
# Web preview / draft
--resolution 720p

# Standard quality / social media
--resolution 1080p

# High quality / professional (Google Veo 2)
--resolution 4k
```

## Workflow Examples

### Complete Workflow with Status Checking

```bash
# 1. Start generation
bun run src/index.ts generate \
  --provider runway \
  --prompt "ocean sunset with sailboat" \
  --output ./sunset.mp4

# Output: Job ID: runway_1234567890_abc

# 2. Check status (wait 10-30 seconds between checks)
bun run src/index.ts status \
  --provider runway \
  --job-id runway_1234567890_abc

# 3. Video automatically downloads when complete
```

### Batch Generation

```bash
# Generate multiple videos with different prompts
for prompt in "forest path" "city street" "ocean waves"; do
  bun run src/index.ts generate \
    --provider runway \
    --prompt "$prompt" \
    --output "./${prompt// /-}.mp4"
done
```

## Tips for Best Results

1. **Be Specific**: More detailed prompts yield better results
   - Bad: "a car"
   - Good: "a red sports car driving on a coastal highway at sunset"

2. **Describe Motion**: Explicitly mention the action or movement
   - "person walking slowly"
   - "camera panning across the scene"
   - "leaves falling gently"

3. **Set the Scene**: Include environment and lighting details
   - "in a modern office with natural window light"
   - "at night with neon signs"
   - "during golden hour with warm tones"

4. **Duration**: Start with 5 seconds, increase if needed
   - Short videos (3-5s) generate faster
   - Longer videos (8-10s) allow more complex scenes

5. **Resolution**: Match your use case
   - Social media: 1080p is sufficient
   - Professional work: 4k if available

## Troubleshooting

### Generation Takes Too Long
- Try a shorter duration (3-5 seconds)
- Use a different provider (Runway is typically fastest)
- Simplify your prompt

### Video Quality Issues
- Increase resolution to 1080p or 4k
- Add lighting details to your prompt
- For Google Veo 2, add cinematography terms

### API Errors
- Check your API keys in `.env`
- Verify API access for your provider
- Check rate limits (wait and retry)

## Getting API Keys

### Google Veo 2
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable Vertex AI API
3. Create service account or API key
4. Set `GOOGLE_CLOUD_PROJECT` environment variable

### OpenAI Sora
1. Join the [OpenAI API waitlist](https://openai.com/sora)
2. Note: API access may be limited

### Runway
1. Sign up at [Runway](https://runwayml.com)
2. Generate API key from dashboard
3. Check [API documentation](https://docs.runwayml.com)

## Support

For issues or questions:
- Check the README.md for setup instructions
- Review SKILL.md for skill details
- Verify your API keys and environment variables
