import { log } from "./logger";

export function getAccessToken(): string {
  const token = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  if (!token) {
    log("Error: Google Calendar not connected.", "error");
    console.error("");
    console.error("To use this skill, provide a Google Calendar access token:");
    console.error("1. Set GOOGLE_CALENDAR_ACCESS_TOKEN in your environment, or");
    console.error("2. Connect the Google Calendar connector on your own Skills instance");
    console.error("   (its dashboard lives at $SKILLS_API_URL/dashboard/connectors)");
    process.exit(1);
  }
  return token;
}

// Get OpenAI API key
export function getOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

// Make authenticated Calendar API request
