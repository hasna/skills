#!/usr/bin/env bun
/**
 * Calendar Events Skill
 * Create, update, and manage Google Calendar events
 * Uses OpenAI for natural language parsing
 */

import { parseArgs } from "util";

import { getAccessToken } from "./auth";
import { parseEventWithAI } from "./ai-parser";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listCalendars,
  listEvents,
  updateEvent,
} from "./api";
import {
  formatCalendarsText,
  formatDate,
  formatEventsText,
  formatTime,
  parseAttendees,
  parseReminders,
} from "./format";
import { showHelp } from "./help";
import { log, SESSION_ID, SKILL_NAME } from "./logger";
import type { CalendarEvent } from "./types";

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
