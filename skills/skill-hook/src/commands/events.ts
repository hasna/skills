/**
 * List available hook events
 */

export function listEvents() {
  console.log(`Claude Code Hook Events

EVENTS:
  PreToolUse     Runs BEFORE a tool executes
                 - Can block operations (return decision: "block")
                 - Receives: tool name, input
                 - Use for: validation, security, blocking

  PostToolUse    Runs AFTER a tool executes
                 - Cannot block (already executed)
                 - Receives: tool name, input, output
                 - Use for: logging, metrics, notifications

  Stop           Runs when agent stops working
                 - Cannot block
                 - Receives: session summary
                 - Use for: cleanup, commits, summaries

MATCHERS:
  *              All tools
  Bash           Shell commands only
  Write          File writes only
  Edit           File edits only
  Read           File reads only
  ["A", "B"]     Multiple specific tools

EXAMPLES:
  PreToolUse + Bash     = Block dangerous shell commands
  PostToolUse + Write   = Run linter after file changes
  Stop + *              = Auto-commit on agent stop
`);
}
