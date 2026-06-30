import { resolveSkillAlias } from "./skill-aliases.js";

export interface HostedRunUnavailable {
  ok: false;
  status: 503;
  code: "HOSTED_PROVIDER_UNAVAILABLE";
  message: string;
  details: string[];
}

export type HostedRunAvailability = { ok: true } | HostedRunUnavailable;

const UNAVAILABLE_HOSTED_PROVIDER_SKILLS = new Set([
  "audio",
  "brand-photo-shoot",
  "browse",
  "deepresearch",
  "generate-book-cover",
  "icon-pack",
  "image",
  "music",
  "music-album",
  "pdf-read",
  "photo-album",
  "playlist-maker",
  "read-pdf",
  "remove-background",
  "short-video-pack",
  "transcript",
  "video",
  "voiceover-jingle-pack",
  "webcrawling",
]);

export function getHostedRunAvailability(slug: string): HostedRunAvailability {
  const canonicalSlug = resolveSkillAlias(slug);
  if (!UNAVAILABLE_HOSTED_PROVIDER_SKILLS.has(canonicalSlug)) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 503,
    code: "HOSTED_PROVIDER_UNAVAILABLE",
    message: "hosted execution is temporarily unavailable for this skill",
    details: [
      "This skill requires a platform-managed execution path that is not enabled for live hosted runs yet.",
      "No balance was charged.",
    ],
  };
}
