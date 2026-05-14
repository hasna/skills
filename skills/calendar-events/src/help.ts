export function showHelp(): void {
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
