import type { SkillMeta } from "../registry-types.js";

export const MEDIA_PROCESSING_SKILLS: SkillMeta[] = [
  {
    name: "video-highlight-pack",
    displayName: "Video Highlight Pack",
    description: "Generate video highlight packages with clip plans, captions, thumbnail briefs, chapter markers, social posts, and edit decisions",
    category: "Media Processing",
    kind: "instruction",
    tags: ["video", "highlights", "clips", "captions"],
  },
  {
    name: "compress-video",
    displayName: "Compress Video",
    description: "Compress video files while preserving visual quality using ffmpeg",
    category: "Media Processing",
    tags: ["video", "compression", "ffmpeg", "optimization"],
  },
  {
    name: "audio-extract",
    displayName: "Audio Extract",
    description: "Extract audio tracks from video files with multiple format support",
    category: "Media Processing",
    tags: ["audio", "extraction", "video", "conversion"],
  },
  {
    name: "extract-frames",
    displayName: "Extract Frames",
    description: "Extract frames from video files at specified intervals or timestamps",
    category: "Media Processing",
    tags: ["frames", "video", "extraction", "images"],
  },
  {
    name: "gif-maker",
    displayName: "GIF Maker",
    description: "Create animated GIFs from images, videos, or screen recordings",
    category: "Media Processing",
    tags: ["gif", "animation", "images", "video"],
  },
  {
    name: "video-downloader",
    displayName: "Video Downloader",
    description: "Download videos from various online platforms and services",
    category: "Media Processing",
    tags: ["video", "download", "platforms", "media"],
  },
  {
    name: "watermark",
    displayName: "Watermark",
    description: "Add watermarks to images and documents for copyright protection",
    category: "Media Processing",
    tags: ["watermark", "protection", "copyright", "images"],
  },
];
