#!/usr/bin/env bun
import { Octokit } from "@octokit/rest";

function showHelp(): void {
  console.log(`
skill-github-manager - Manage GitHub issues and pull requests

Usage:
  skills run github-manager -- action=<action> [options]

Options:
  -h, --help               Show this help message
  action=<action>          Action to perform: list-issues, create-issue, list-prs
  repo=<owner/repo>        Repository in owner/repo format
  title=<title>            Issue title (for create-issue)
  body=<body>              Issue body (for create-issue)

Actions:
  list-issues              List issues (all if no repo, or for specific repo)
  create-issue             Create a new issue (requires repo and title)
  list-prs                 List pull requests for a repository

Examples:
  skills run github-manager -- action=list-issues
  skills run github-manager -- action=list-issues repo=owner/repo
  skills run github-manager -- action=create-issue repo=owner/repo title="Bug report" body="Description"
  skills run github-manager -- action=list-prs repo=owner/repo

Requirements:
  GitHub connector must be connected in skills.md (provides GITHUB_ACCESS_TOKEN).
`);
}

const args = process.argv.slice(2);

// Check for help flag
if (args.includes("-h") || args.includes("--help")) {
  showHelp();
  process.exit(0);
}
const actionArg = args.find(a => a.startsWith("action="))?.split("=")[1];
const repoArg = args.find(a => a.startsWith("repo="))?.split("=")[1];
const titleArg = args.find(a => a.startsWith("title="))?.split("=")[1];
const bodyArg = args.find(a => a.startsWith("body="))?.split("=")[1];

if (!process.env.GITHUB_ACCESS_TOKEN) {
  console.error("Error: GitHub connector not connected. Please connect GitHub in skills.md.");
  process.exit(1);
}

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

async function main() {
  try {
    switch (actionArg) {
      case "list-issues":
        if (repoArg) {
          const [owner, repo] = repoArg.split("/");
          const { data } = await octokit.issues.listForRepo({ owner, repo });
          console.log(JSON.stringify(data.map(i => ({ number: i.number, title: i.title, state: i.state })), null, 2));
        } else {
          const { data } = await octokit.issues.list();
          console.log(JSON.stringify(data.map(i => ({ repo: i.repository?.full_name, number: i.number, title: i.title })), null, 2));
        }
        break;
      case "create-issue":
        if (!repoArg || !titleArg) {
          console.error("Error: repo and title are required for create-issue");
          process.exit(1);
        }
        const [owner, repo] = repoArg.split("/");
        const { data: newIssue } = await octokit.issues.create({
          owner,
          repo,
          title: titleArg,
          body: bodyArg,
        });
        console.log(`Issue created: ${newIssue.html_url}`);
        break;
      case "list-prs":
        if (!repoArg) {
           console.error("Error: repo is required for list-prs");
           process.exit(1);
        }
        const [prOwner, prRepo] = repoArg.split("/");
        const { data: prs } = await octokit.pulls.list({ owner: prOwner, repo: prRepo });
        console.log(JSON.stringify(prs.map(pr => ({ number: pr.number, title: pr.title, user: pr.user?.login })), null, 2));
        break;
      default:
        console.log("Usage: skills run github-manager -- action=<action> [repo=owner/repo] [title=...] [body=...]");
        console.log("Actions: list-issues, create-issue, list-prs");
    }
  } catch (error: any) {
    console.error("GitHub API Error:", error.message);
    process.exit(1);
  }
}

main();
