import type { SkillMeta } from "../registry-types.js";

export const COMMUNICATION_SKILLS: SkillMeta[] = [
  {
    name: "calendar-events",
    displayName: "Calendar Events",
    description: "Create, manage, and organize calendar events and scheduling",
    category: "Communication",
    tags: ["calendar", "events", "scheduling", "organization"],
  },
  {
    name: "gmail",
    displayName: "Gmail",
    description: "Compose, read, and manage Gmail messages with AI assistance",
    category: "Communication",
    tags: ["email", "gmail", "compose", "management"],
  },
  {
    name: "slack-assistant",
    displayName: "Slack Assistant",
    description: "Automate Slack interactions with message management and channel operations",
    category: "Communication",
    tags: ["slack", "assistant", "automation", "messaging"],
  },
  {
    name: "sms",
    displayName: "SMS",
    description: "Send and receive SMS messages via Twilio",
    category: "Communication",
    tags: ["sms", "twilio", "messaging", "text"],
  },
];
