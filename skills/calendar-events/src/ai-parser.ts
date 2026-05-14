import { REQUEST_TIMEOUT_MS } from "./config";
import { getOpenAIKey } from "./auth";
import { log } from "./logger";
import type { ParsedEvent } from "./types";

export async function parseEventWithAI(
  text: string,
  timezone: string
): Promise<ParsedEvent> {
  const openaiKey = getOpenAIKey();
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY is required for natural language parsing. Use 'create' command with explicit options instead.");
  }

  const now = new Date();
  const currentDate = now.toISOString().split("T")[0];
  const currentTime = now.toTimeString().split(" ")[0];
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });

  const systemPrompt = `You are a calendar event parser. Extract event details from natural language and return a JSON object.

Current context:
- Today is ${dayOfWeek}, ${currentDate}
- Current time is ${currentTime}
- Timezone: ${timezone}

Rules:
1. Parse the input and extract: title, start date/time, end date/time, location, description, attendees
2. For relative dates like "tomorrow", "next week", "next Monday", calculate the actual date
3. "Next week" means 7 days from today
4. If only a time is given (e.g., "at 5am"), assume it's the next occurrence of that time
5. If no duration is specified, default to 1 hour for meetings/events
6. For all-day events (like "vacation on Dec 25"), set isAllDay to true
7. Return dates in ISO 8601 format with timezone offset

Return ONLY a valid JSON object with this structure:
{
  "title": "Event title",
  "startDateTime": "2025-01-15T10:00:00-08:00",
  "endDateTime": "2025-01-15T11:00:00-08:00",
  "isAllDay": false,
  "location": "optional location",
  "description": "optional description",
  "attendees": ["email@example.com"]
}

For all-day events, use date format without time:
{
  "title": "Vacation",
  "startDateTime": "2025-01-15",
  "endDateTime": "2025-01-16",
  "isAllDay": true
}`;

  log(`OpenAI API request: Parsing event`, "debug");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  log(`OpenAI API response: ${response.status}`, "debug");

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Failed to parse event from AI response");
  }

  try {
    const parsed = JSON.parse(content) as ParsedEvent;

    // Validate required fields
    if (!parsed.title || !parsed.startDateTime || !parsed.endDateTime) {
      throw new Error("AI response missing required fields");
    }

    return parsed;
  } catch (e) {
    throw new Error(`Failed to parse AI response: ${e instanceof Error ? e.message : "Invalid JSON"}`);
  }
}

// List calendars
