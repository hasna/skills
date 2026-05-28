import type { Calendar, CalendarEvent } from "./types";

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Format time for display
export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Format events for text output
export function formatEventsText(events: CalendarEvent[]): string {
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
export function formatCalendarsText(calendars: Calendar[]): string {
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
export function parseAttendees(input: string): Array<{ email: string }> {
  return input
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

// Parse reminder minutes from comma-separated string
export function parseReminders(input: string): Array<{ method: string; minutes: number }> {
  return input
    .split(",")
    .map((m) => parseInt(m.trim(), 10))
    .filter((m) => !isNaN(m))
    .map((minutes) => ({ method: "popup", minutes }));
}

// Show help
