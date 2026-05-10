#!/usr/bin/env bun
/**
 * Calendar Events Skill
 * Create, update, and manage Google Calendar events
 * Uses OpenAI for natural language parsing
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Google Calendar API base URL
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// Request timeout in milliseconds (30 seconds)
const REQUEST_TIMEOUT_MS = 30000;

// Constants
const SKILL_NAME = "calendar-events";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else if (level !== "debug") {
    console.log(`${prefix} ${message}`);
  }
}

// Types
interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  htmlLink?: string;
  status?: string;
  created?: string;
  updated?: string;
  organizer?: {
    email: string;
    displayName?: string;
  };
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: string;
      minutes: number;
    }>;
  };
}

interface Calendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

interface EventsListResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
}

interface CalendarListResponse {
  items?: Calendar[];
}

// Parsed event from AI
interface ParsedEvent {
  title: string;
  startDateTime: string; // ISO 8601
  endDateTime: string; // ISO 8601
  isAllDay: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
}

// Get access token from environment
function getAccessToken(): string {
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
function getOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

// Make authenticated Calendar API request
async function calendarRequest<T>(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${CALENDAR_API_BASE}${endpoint}`;

  log(`Calendar API request: ${options.method || "GET"} ${endpoint}`, "debug");

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    log(`Calendar API response: ${response.status}`, "debug");

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) {
        log("Error: Google Calendar access token expired or invalid.", "error");
        console.error("Please reconnect your Google Calendar in the Connectors dashboard.");
        process.exit(1);
      }
      throw new Error(error.error?.message || `Calendar API error: ${response.status}`);
    }

    // Handle empty responses
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Calendar API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
}

// Parse natural language event using OpenAI
async function parseEventWithAI(
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
async function listCalendars(accessToken: string): Promise<Calendar[]> {
  const response = await calendarRequest<CalendarListResponse>(
    "/users/me/calendarList",
    accessToken
  );
  return response.items || [];
}

// List events
async function listEvents(
  accessToken: string,
  options: {
    calendarId: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    pageToken?: string;
  }
): Promise<EventsListResponse> {
  const params = new URLSearchParams();

  if (options.timeMin) {
    params.set("timeMin", options.timeMin);
  }
  if (options.timeMax) {
    params.set("timeMax", options.timeMax);
  }
  if (options.maxResults) {
    params.set("maxResults", options.maxResults.toString());
  }
  if (options.pageToken) {
    params.set("pageToken", options.pageToken);
  }

  params.set("singleEvents", "true");
  params.set("orderBy", "startTime");

  return calendarRequest(
    `/calendars/${encodeURIComponent(options.calendarId)}/events?${params.toString()}`,
    accessToken
  );
}

// Get single event
async function getEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<CalendarEvent> {
  return calendarRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken
  );
}

// Create event
async function createEvent(
  accessToken: string,
  calendarId: string,
  event: Partial<CalendarEvent>
): Promise<CalendarEvent> {
  return calendarRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(event),
    }
  );
}

// Update event
async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  updates: Partial<CalendarEvent>
): Promise<CalendarEvent> {
  return calendarRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    }
  );
}

// Delete event
async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await calendarRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    {
      method: "DELETE",
    }
  );
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Format time for display
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Format events for text output
function formatEventsText(events: CalendarEvent[]): string {
  if (events.length === 0) {
    return "No upcoming events found.";
  }

  const lines: string[] = [];
  let currentDate = "";

  for (const event of events) {
    const startDate = event.start.dateTime || event.start.date || "";
    const eventDate = formatDate(startDate);

    if (eventDate !== currentDate) {
      if (currentDate !== "") lines.push("");
      lines.push(eventDate);
      currentDate = eventDate;
    }

    const isAllDay = !event.start.dateTime;
    if (isAllDay) {
      lines.push(`  All Day     ${event.summary || "(No title)"}`);
    } else {
      const startTime = formatTime(event.start.dateTime!);
      const endTime = formatTime(event.end.dateTime!);
      lines.push(`  ${startTime} - ${endTime}  ${event.summary || "(No title)"}`);
    }

    if (event.location) {
      lines.push(`              Location: ${event.location}`);
    }

    lines.push(`              ID: ${event.id}`);
  }

  return lines.join("\n");
}

// Format calendars for text output
function formatCalendarsText(calendars: Calendar[]): string {
  const lines = ["Your Calendars", "==============", ""];

  for (const cal of calendars) {
    const primary = cal.primary ? " (primary)" : "";
    lines.push(`${cal.summary}${primary}`);
    lines.push(`  ID: ${cal.id}`);
    if (cal.description) {
      lines.push(`  Description: ${cal.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// Parse attendees from comma-separated string
function parseAttendees(input: string): Array<{ email: string }> {
  return input
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

// Parse reminder minutes from comma-separated string
function parseReminders(input: string): Array<{ method: string; minutes: number }> {
  return input
    .split(",")
    .map((m) => parseInt(m.trim(), 10))
    .filter((m) => !isNaN(m))
    .map((minutes) => ({ method: "popup", minutes }));
}

// Show help
function showHelp(): void {
  console.log(`
Calendar Events - Manage Google Calendar events

Usage:
  skills run calendar-events -- <command> [options]

Commands:
  list                List upcoming events
  create              Create a new event with explicit options
  add <text>          Create event from natural language (AI-powered)
  update              Update an existing event
  delete              Delete an event
  get                 Get details of a specific event
  calendars           List available calendars

Options:
  --days <n>          Days to look ahead (for list) [default: 14]
  --max <n>           Maximum events to return [default: 50]
  --calendar <id>     Calendar ID [default: primary]
  --id <event-id>     Event ID (for get/update/delete)
  --title <text>      Event title
  --start <datetime>  Start time (ISO 8601: "2025-01-15T10:00:00")
  --end <datetime>    End time (ISO 8601: "2025-01-15T11:00:00")
  --duration <mins>   Duration in minutes (alternative to --end)
  --date <date>       Date for all-day event (YYYY-MM-DD)
  --all-day           Create as all-day event
  --location <text>   Event location
  --description <text> Event description
  --attendees <emails> Comma-separated attendee emails (create/update)
  --reminder <mins>   Reminder minutes (comma-separated, e.g., 10,30)
  --format <format>   Output format: text or json [default: text]
  --help, -h          Show this help

Examples:
  # List events for next 7 days
  skills run calendar-events -- list --days 7

  # Create an event with explicit options
  skills run calendar-events -- create --title "Meeting" --start "2025-01-15T10:00:00" --end "2025-01-15T11:00:00"

  # Create an event using natural language (AI-powered)
  skills run calendar-events -- add "Team standup next Monday at 9am for 30 minutes"
  skills run calendar-events -- add "Lunch with Sarah tomorrow at noon at Cafe Milano"
  skills run calendar-events -- add "Vacation Dec 25-27"

  # Delete an event
  skills run calendar-events -- delete --id abc123

Note: The 'add' command requires OPENAI_API_KEY for natural language parsing.
`);
}

// Main function
async function main() {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`, "debug");

  // Running from CLI - parse command line arguments
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      days: { type: "string", default: "14" },
      max: { type: "string", default: "50" },
      calendar: { type: "string", default: "primary" },
      id: { type: "string" },
      title: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      duration: { type: "string" },
      date: { type: "string" },
      "all-day": { type: "boolean", default: false },
      location: { type: "string" },
      description: { type: "string" },
      attendees: { type: "string" },
      reminder: { type: "string" },
      format: { type: "string", default: "text" },
      timezone: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  const values = parsed.values;
  const positionals = parsed.positionals;

  if (values.help || positionals.length === 0) {
    showHelp();
    process.exit(values.help ? 0 : 1);
  }

  log(`Getting access token...`, "debug");

  const accessToken = getAccessToken();

  log(`Access token obtained (length: ${accessToken.length})`, "debug");

  const command = positionals[0];
  const calendarId = values.calendar as string;
  const outputFormat = values.format as string;
  const timezone = (values.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;

  log(`Executing command: ${command}, calendarId: ${calendarId}`, "debug");

  try {
    switch (command) {
      case "calendars": {
        const calendars = await listCalendars(accessToken);
        if (outputFormat === "json") {
          console.log(JSON.stringify(calendars, null, 2));
        } else {
          console.log(formatCalendarsText(calendars));
        }
        break;
      }

      case "list": {
        const days = parseInt(values.days as string, 10) || 14;
        const maxResults = parseInt(values.max as string, 10) || 50;

        const now = new Date();
        const timeMin = now.toISOString();
        const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

        const response = await listEvents(accessToken, {
          calendarId,
          timeMin,
          timeMax,
          maxResults,
        });

        const events = response.items || [];

        if (outputFormat === "json") {
          console.log(JSON.stringify({ events, count: events.length }, null, 2));
        } else {
          console.log(`Upcoming Events (next ${days} days)`);
          console.log("=".repeat(30));
          console.log("");
          console.log(formatEventsText(events));
        }
        break;
      }

      case "get": {
        const eventId = values.id as string;
        if (!eventId) {
          log("Error: --id is required for get command", "error");
          process.exit(1);
        }

        const event = await getEvent(accessToken, calendarId, eventId);

        if (outputFormat === "json") {
          console.log(JSON.stringify(event, null, 2));
        } else {
          console.log("Event Details");
          console.log("=============");
          console.log(`Title: ${event.summary || "(No title)"}`);
          console.log(`ID: ${event.id}`);

          if (event.start.dateTime) {
            console.log(`Start: ${formatDate(event.start.dateTime)} ${formatTime(event.start.dateTime)}`);
            console.log(`End: ${formatDate(event.end.dateTime!)} ${formatTime(event.end.dateTime!)}`);
          } else {
            console.log(`Date: ${event.start.date} (All Day)`);
          }

          if (event.location) console.log(`Location: ${event.location}`);
          if (event.description) console.log(`Description: ${event.description}`);
          if (event.htmlLink) console.log(`Link: ${event.htmlLink}`);

          if (event.attendees?.length) {
            console.log("Attendees:");
            event.attendees.forEach((a) => {
              console.log(`  - ${a.email} (${a.responseStatus || "unknown"})`);
            });
          }
        }
        break;
      }

      case "create": {
        const title = values.title as string;
        if (!title) {
          log("Error: --title is required for create command", "error");
          console.error("Tip: Use 'add' command for natural language input");
          process.exit(1);
        }

        const isAllDay = values["all-day"] as boolean;
        const eventDate = values.date as string;
        let startTime = values.start as string;
        let endTime = values.end as string;
        const durationMins = values.duration ? parseInt(values.duration as string, 10) : null;

        if (isAllDay && !eventDate) {
          log("Error: --date is required for all-day events", "error");
          process.exit(1);
        }

        if (!isAllDay && !startTime) {
          log("Error: --start is required for timed events", "error");
          console.error("Tip: Use 'add' command for natural language input");
          process.exit(1);
        }

        // Calculate end time from duration if provided
        if (!isAllDay && startTime && !endTime && durationMins) {
          const startDate = new Date(startTime);
          const endDate = new Date(startDate.getTime() + durationMins * 60 * 1000);
          endTime = endDate.toISOString();
        }

        if (!isAllDay && (!startTime || !endTime)) {
          log("Error: --end or --duration is required for timed events", "error");
          process.exit(1);
        }

        const newEvent: Partial<CalendarEvent> = {
          summary: title,
        };

        if (isAllDay) {
          newEvent.start = { date: eventDate };
          // All-day events need end date to be next day
          const endDate = new Date(eventDate);
          endDate.setDate(endDate.getDate() + 1);
          newEvent.end = { date: endDate.toISOString().split("T")[0] };
        } else {
          newEvent.start = { dateTime: startTime, timeZone: timezone };
          newEvent.end = { dateTime: endTime, timeZone: timezone };
        }

        if (values.location) {
          newEvent.location = values.location as string;
        }

        if (values.description) {
          newEvent.description = values.description as string;
        }

        if (values.attendees) {
          newEvent.attendees = parseAttendees(values.attendees as string);
        }

        if (values.reminder) {
          newEvent.reminders = {
            useDefault: false,
            overrides: parseReminders(values.reminder as string),
          };
        }

        log(`Creating event: ${JSON.stringify(newEvent)}`, "debug");

        const createdEvent = await createEvent(accessToken, calendarId, newEvent);

        log(`Event created successfully: ${createdEvent.id}`, "debug");

        if (outputFormat === "json") {
          console.log(JSON.stringify(createdEvent, null, 2));
        } else {
          console.log("Event created successfully!");
          console.log(`  Title: ${createdEvent.summary}`);
          console.log(`  ID: ${createdEvent.id}`);
          if (createdEvent.start.dateTime) {
            console.log(`  Start: ${formatDate(createdEvent.start.dateTime)} ${formatTime(createdEvent.start.dateTime)}`);
            console.log(`  End: ${formatDate(createdEvent.end.dateTime!)} ${formatTime(createdEvent.end.dateTime!)}`);
          } else {
            console.log(`  Date: ${createdEvent.start.date} (All Day)`);
          }
          if (createdEvent.htmlLink) {
            console.log(`  Link: ${createdEvent.htmlLink}`);
          }
        }
        break;
      }

      // AI-powered natural language event creation
      case "add": {
        const text = positionals.slice(1).join(" ");
        if (!text) {
          log("Error: Text is required for add command", "error");
          console.error("Usage: add <natural language description>");
          console.error('Example: add "Team meeting next Monday at 10am for 1 hour"');
          process.exit(1);
        }

        // Parse with AI
        console.log("Parsing event...");
        const parsed = await parseEventWithAI(text, timezone);

        // Create the event
        const newEvent: Partial<CalendarEvent> = {
          summary: parsed.title,
        };

        if (parsed.isAllDay) {
          newEvent.start = { date: parsed.startDateTime };
          newEvent.end = { date: parsed.endDateTime };
        } else {
          newEvent.start = { dateTime: parsed.startDateTime, timeZone: timezone };
          newEvent.end = { dateTime: parsed.endDateTime, timeZone: timezone };
        }

        if (parsed.location) {
          newEvent.location = parsed.location;
        }

        if (parsed.description) {
          newEvent.description = parsed.description;
        }

        if (parsed.attendees?.length) {
          newEvent.attendees = parsed.attendees.map((email) => ({ email }));
        }

        const createdEvent = await createEvent(accessToken, calendarId, newEvent);

        if (outputFormat === "json") {
          console.log(JSON.stringify({ parsed, event: createdEvent }, null, 2));
        } else {
          console.log("Event created successfully!");
          console.log(`  Title: ${createdEvent.summary}`);
          console.log(`  ID: ${createdEvent.id}`);
          if (createdEvent.start.dateTime) {
            console.log(`  Start: ${formatDate(createdEvent.start.dateTime)} ${formatTime(createdEvent.start.dateTime)}`);
            console.log(`  End: ${formatDate(createdEvent.end.dateTime!)} ${formatTime(createdEvent.end.dateTime!)}`);
          } else {
            console.log(`  Date: ${createdEvent.start.date} (All Day)`);
          }
          if (createdEvent.location) {
            console.log(`  Location: ${createdEvent.location}`);
          }
          if (createdEvent.htmlLink) {
            console.log(`  Link: ${createdEvent.htmlLink}`);
          }
        }
        break;
      }

      case "update": {
        const eventId = values.id as string;
        if (!eventId) {
          log("Error: --id is required for update command", "error");
          process.exit(1);
        }

        const updates: Partial<CalendarEvent> = {};

        if (values.title) {
          updates.summary = values.title as string;
        }

        if (values.start) {
          updates.start = { dateTime: values.start as string, timeZone: timezone };
        }

        if (values.end) {
          updates.end = { dateTime: values.end as string, timeZone: timezone };
        }

        if (values.location) {
          updates.location = values.location as string;
        }

        if (values.description) {
          updates.description = values.description as string;
        }

        if (values.attendees) {
          updates.attendees = parseAttendees(values.attendees as string);
        }

        if (Object.keys(updates).length === 0) {
          log("Error: At least one field to update is required (--title, --start, --end, --location, --description, --attendees)", "error");
          process.exit(1);
        }

        const updatedEvent = await updateEvent(accessToken, calendarId, eventId, updates);

        if (outputFormat === "json") {
          console.log(JSON.stringify(updatedEvent, null, 2));
        } else {
          console.log("Event updated successfully!");
          console.log(`  Title: ${updatedEvent.summary}`);
          console.log(`  ID: ${updatedEvent.id}`);
          if (updatedEvent.start.dateTime) {
            console.log(`  Start: ${formatDate(updatedEvent.start.dateTime)} ${formatTime(updatedEvent.start.dateTime)}`);
            console.log(`  End: ${formatDate(updatedEvent.end.dateTime!)} ${formatTime(updatedEvent.end.dateTime!)}`);
          }
          if (updatedEvent.location) {
            console.log(`  Location: ${updatedEvent.location}`);
          }
          if (updatedEvent.attendees?.length) {
            console.log(`  Attendees: ${updatedEvent.attendees.map(a => a.email).join(", ")}`);
          }
          if (updatedEvent.htmlLink) {
            console.log(`  Link: ${updatedEvent.htmlLink}`);
          }
        }
        break;
      }

      case "delete": {
        const eventId = values.id as string;
        if (!eventId) {
          log("Error: --id is required for delete command", "error");
          process.exit(1);
        }

        await deleteEvent(accessToken, calendarId, eventId);

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, eventId }, null, 2));
        } else {
          console.log(`Event deleted successfully: ${eventId}`);
        }
        break;
      }

      default:
        log(`Unknown command: ${command}`, "error");
        showHelp();
        process.exit(1);
    }

    log(`Command completed successfully`, "debug");
  } catch (error) {
    if (error instanceof Error) {
      log(`Error occurred: ${error.stack}`, "debug");
      log(`Error: ${error.message}`, "error");
    } else {
      log(`Error: Unknown error`, "error");
    }
    process.exit(1);
  }
}

main();
