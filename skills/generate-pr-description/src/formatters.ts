import type { Options, PRDescription } from "./types";

function formatGitHub(description: PRDescription, options: Options): string {
  let output = '## Summary\n\n';
  output += `${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes\n\n';
    description.changes.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  if (options.includeFiles) {
    output += '## What Changed\n\n';

    if (description.whatChanged.added.length > 0) {
      output += '### Added\n';
      description.whatChanged.added.forEach(file => {
        output += `- \`${file}\`\n`;
      });
      output += '\n';
    }

    if (description.whatChanged.modified.length > 0) {
      output += '### Modified\n';
      description.whatChanged.modified.forEach(file => {
        output += `- \`${file}\`\n`;
      });
      output += '\n';
    }

    if (description.whatChanged.deleted.length > 0) {
      output += '### Deleted\n';
      description.whatChanged.deleted.forEach(file => {
        output += `- \`${file}\`\n`;
      });
      output += '\n';
    }
  }

  output += '## Why These Changes\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `- 🚨 ${change}\n`;
    });
    output += '\n';
  }

  if (description.testPlan.length > 0) {
    output += '## Testing\n\n';
    output += '### Test Plan\n';
    description.testPlan.forEach(test => {
      output += `- [ ] ${test}\n`;
    });
    output += '\n';
  }

  if (description.additionalNotes.length > 0) {
    output += '## Additional Notes\n\n';
    description.additionalNotes.forEach(note => {
      output += `- ${note}\n`;
    });
    output += '\n';
  }

  return output;
}

function formatGitLab(description: PRDescription, options: Options): string {
  let output = '## What does this MR do?\n\n';
  output += `${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes Made\n\n';
    description.changes.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  output += '## Why was this MR needed?\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `- ⚠️ ${change}\n`;
    });
    output += '\n';
  }

  output += '## Does this MR meet the acceptance criteria?\n\n';
  if (description.testPlan.length > 0) {
    description.testPlan.forEach(test => {
      output += `- [ ] ${test}\n`;
    });
  } else {
    output += '- [ ] Tests added/updated\n';
    output += '- [ ] Documentation updated\n';
    output += '- [ ] Code reviewed\n';
    output += '- [ ] All pipelines pass\n';
  }
  output += '\n';

  if (options.includeFiles) {
    output += '## Files Changed\n\n';
    const totalFiles =
      description.whatChanged.added.length +
      description.whatChanged.modified.length +
      description.whatChanged.deleted.length;
    output += `${totalFiles} files changed\n\n`;
  }

  return output;
}

function formatBitbucket(description: PRDescription, options: Options): string {
  let output = '# Description\n\n';
  output += `${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes\n\n';
    description.changes.forEach(change => {
      output += `* ${change}\n`;
    });
    output += '\n';
  }

  output += '## Context\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `* ${change}\n`;
    });
    output += '\n';
  }

  output += '## Testing\n\n';
  if (description.testPlan.length > 0) {
    description.testPlan.forEach(test => {
      output += `* [ ] ${test}\n`;
    });
  } else {
    output += '* [ ] Tests pass\n';
    output += '* [ ] Code reviewed\n';
  }
  output += '\n';

  return output;
}

function formatPlain(description: PRDescription, options: Options): string {
  let output = `# ${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes\n\n';
    description.changes.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  if (options.includeFiles) {
    const totalFiles =
      description.whatChanged.added.length +
      description.whatChanged.modified.length +
      description.whatChanged.deleted.length;
    output += `## Files Changed: ${totalFiles}\n\n`;
  }

  output += '## Details\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  return output;
}

export function formatOutput(description: PRDescription, options: Options): string {
  switch (options.format) {
    case 'gitlab':
      return formatGitLab(description, options);
    case 'bitbucket':
      return formatBitbucket(description, options);
    case 'plain':
      return formatPlain(description, options);
    case 'github':
    default:
      return formatGitHub(description, options);
  }
}

export function applyTemplate(template: string, description: PRDescription): string {
  let output = template;

  output = output.replace(/\{\{summary\}\}/g, description.summary);
  output = output.replace(/\{\{changes\}\}/g, description.changes.join('\n- '));
  output = output.replace(/\{\{why_changed\}\}/g, description.whyChanged);
  output = output.replace(
    /\{\{breaking_changes\}\}/g,
    description.breakingChanges.join('\n- ')
  );
  output = output.replace(/\{\{test_plan\}\}/g, description.testPlan.join('\n- [ ] '));
  output = output.replace(
    /\{\{files_added\}\}/g,
    description.whatChanged.added.join('\n- ')
  );
  output = output.replace(
    /\{\{files_modified\}\}/g,
    description.whatChanged.modified.join('\n- ')
  );
  output = output.replace(
    /\{\{files_deleted\}\}/g,
    description.whatChanged.deleted.join('\n- ')
  );

  return output;
}
