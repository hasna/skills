import { CALENDAR_API_BASE, REQUEST_TIMEOUT_MS } from "./config";
import { log } from "./logger";
import type { Calendar, CalendarEvent, CalendarListResponse, EventsListResponse } from "./types";

export async function calendarRequest<T>(
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

export async function listCalendars(accessToken: string): Promise<Calendar[]> {
  const response = await calendarRequest<CalendarListResponse>(
    "/users/me/calendarList",
    accessToken
  );
  return response.items || [];
}

// List events
export async function listEvents(
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
export async function getEvent(
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
export async function createEvent(
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
export async function updateEvent(
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
export async function deleteEvent(
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
