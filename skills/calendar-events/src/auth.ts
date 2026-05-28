import { log } from "./logger";

export function getAccessToken(): string {
  const token = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  if (!token) {
    log("Error: Google Calendar not connected.", "error");
    console.error("");
    console.error("To use this skill, you need to connect your Google Calendar:");
    console.error("1. Go to https://skills.md/dashboard/connectors");
    console.error("2. Click 'Connect' on the Google Calendar connector");
    console.error("3. Authorize access to your Google Calendar");
    process.exit(1);
  }
  return token;
}

// Get OpenAI API key
export function getOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

// Make authenticated Calendar API request
