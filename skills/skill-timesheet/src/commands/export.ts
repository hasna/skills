import { Command } from 'commander';
import { listExports } from '../lib/export';
import { resolveProfile } from '../lib/profiles';

export const exportCommand = new Command('export')
  .description('Manage exports');

exportCommand
  .command('list')
  .description('List all exports')
  .action(async () => {
    const profileName = await resolveProfile((exportCommand.parent as Command)?.opts().profile);
    const exports = await listExports(profileName);

    if (exports.length === 0) {
      console.log(`No exports in profile "${profileName}".`);
      console.log('\nGenerate one with:');
      console.log('  service-timesheetgenerate generate --month YYYY-MM');
      return;
    }

    console.log(`Exports in "${profileName}":\n`);
    for (const exp of exports) {
      console.log(`  [${exp.id}] ${exp.startDate} to ${exp.endDate}`);
      console.log(`      Format: ${exp.format}`);
      console.log(`      File: ${exp.filePath}`);
      console.log(`      Created: ${exp.createdAt}`);
    }
  });
