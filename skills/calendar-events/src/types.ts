export interface CalendarEvent {
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

export interface Calendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

export interface EventsListResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
}

export interface CalendarListResponse {
  items?: Calendar[];
}

// Parsed event from AI
export interface ParsedEvent {
  title: string;
  startDateTime: string; // ISO 8601
  endDateTime: string; // ISO 8601
  isAllDay: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
}

// Get access token from environment
