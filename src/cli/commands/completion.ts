/**
 * completion — shell completion generation
 */

import type { Command } from "commander";
import { SKILLS, CATEGORIES } from "../../lib/registry.js";

const subcommands = [
  "interactive", "install", "list", "search", "info", "docs", "requires",
  "run", "init", "remove", "update", "categories", "tags", "mcp", "serve",
  "self-update", "completion", "export", "import", "doctor", "auth", "whoami",
  "test", "outdated", "config", "create", "sync", "validate", "diff", "schedule",
];
const skillCmds = ["install", "info", "docs", "requires", "run", "remove"];
const skillNames = SKILLS.map((s) => s.name);
const categoryNames = CATEGORIES.map((c) => c);

export function registerCompletion(parent: Command) {
  parent
    .command("completion")
    .argument("<shell>", "Shell type: bash, zsh, or fish")
    .description("Generate shell completions")
    .action((shell: string) => generateCompletion(shell));
}

function generateCompletion(shell: string) {
  switch (shell) {
    case "bash": {
      console.log(`# Bash completion for skills CLI
_skills_completions() {
  local cur prev subcmds skill_cmds skills categories
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  subcmds="${subcommands.join(" ")}"
  skill_cmds="${skillCmds.join(" ")}"
  skills="${skillNames.join(" ")}"
  categories="${categoryNames.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "\${subcmds}" -- "\${cur}") )
    return 0
  fi

  case "\${prev}" in
    --category|-c)
      COMPREPLY=( \$(compgen -W "\${categories}" -- "\${cur}") )
      return 0
      ;;
  esac

  for cmd in \${skill_cmds}; do
    if [[ "\${COMP_WORDS[1]}" == "\${cmd}" && \${COMP_CWORD} -eq 2 ]]; then
      COMPREPLY=( \$(compgen -W "\${skills}" -- "\${cur}") )
      return 0
    fi
  done

  return 0
}
complete -F _skills_completions skills
`);
      break;
    }
    case "zsh": {
      console.log(`#compdef skills
# Zsh completion for skills CLI

_skills() {
  local -a subcmds skill_cmds skills categories

  subcmds=(
${subcommands.map((c) => `    '${c}:${c} command'`).join("\n")}
  )

  skills=(${skillNames.join(" ")})
  categories=(${categoryNames.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ")})

  skill_cmds=(${skillCmds.join(" ")})

  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'skills command' subcmds
      ;;
    args)
      case \${words[1]} in
        ${skillCmds.join("|")})
          _describe 'skill' skills
          ;;
        list|search)
          _arguments '--category[Filter by category]:category:($categories)'
          ;;
        completion)
          _describe 'shell' '(bash zsh fish)'
          ;;
      esac
      ;;
  esac
}

_skills "$@"
`);
      break;
    }
    case "fish": {
      const lines = [
        "# Fish completion for skills CLI", "", "# Disable file completions by default", "complete -c skills -f", "", "# Subcommands",
      ];
      for (const cmd of subcommands) lines.push(`complete -c skills -n '__fish_use_subcommand' -a '${cmd}' -d '${cmd} command'`);
      lines.push("", "# Skill names for relevant subcommands");
      for (const cmd of skillCmds) for (const name of skillNames) lines.push(`complete -c skills -n '__fish_seen_subcommand_from ${cmd}' -a '${name}'`);
      lines.push("", "# Category completions for --category flag");
      for (const cat of categoryNames) lines.push(`complete -c skills -l category -s c -a '${cat}' -d 'Category'`);
      console.log(lines.join("\n"));
      break;
    }
    default:
      console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
      process.exitCode = 1;
  }
}
