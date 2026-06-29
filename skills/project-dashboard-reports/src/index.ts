#!/usr/bin/env bun

type GuideSection = {
  title: string;
  items: string[];
};

const sections: GuideSection[] = [
  {
    title: "layout",
    items: [
      "Keep dashboard assets under .hasna/project/.",
      "Use .hasna/project/dashboard/render.json as the render manifest.",
      "Write snapshots under .hasna/project/dashboard/snapshots/.",
      "Use iproj-<project-slug> for the conversation channel name.",
    ],
  },
  {
    title: "commands",
    items: [
      "projects dashboard snapshot <project> --write --json",
      "projects dashboard render <project> --json",
      "projects dashboard validate <project> --json",
      "PROJECTS_DASHBOARD_TOKEN=<token> projects dashboard serve <project> --host 0.0.0.0 --port <port>",
    ],
  },
  {
    title: "provider-panels",
    items: [
      "todos project-panel --project <project> --json --contract",
      "files project-panel --project <project> --json --contract",
      "mailery status project-panel --project <project> --limit 20 --json --contract",
      "conversations project-panel --project <project> --limit 30 --json --contract",
      "knowledge project-panel --project <project> --scope project --limit 30 --json --contract",
      "mementos --json project-panel --project <project> --contract",
      "reports project-panel --project <project> --json --contract",
    ],
  },
];

function printHelp() {
  console.log(`project-dashboard-reports

Prints the Hasna project dashboard reporting checklist.

Usage:
  project-dashboard-reports [--json]

The full agent-facing guidance lives in SKILL.md.`);
}

function printText() {
  for (const section of sections) {
    console.log(`${section.title}:`);
    for (const item of section.items) {
      console.log(`  - ${item}`);
    }
  }
}

if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
  printHelp();
} else if (Bun.argv.includes("--json")) {
  console.log(JSON.stringify({ skill: "project-dashboard-reports", sections }, null, 2));
} else {
  printText();
}
