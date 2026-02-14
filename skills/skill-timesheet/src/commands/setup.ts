import { Command } from 'commander';
import { setupService, isServiceSetup } from '../lib/profiles';
import { getServiceDir } from '../lib/paths';

export const setupCommand = new Command('setup')
  .description('Initialize service directory')
  .action(async () => {
    if (isServiceSetup()) {
      console.log(`Service already set up at ${getServiceDir()}`);
      console.log('\nTo create a profile, run:');
      console.log('  service-timesheetgenerate profile create <name>');
      return;
    }

    const result = await setupService();
    console.log(`Service initialized at ${result.path}`);
    console.log('\nNext steps:');
    console.log('  1. Create a profile: service-timesheetgenerate profile create <name>');
    console.log('  2. Add employees: service-timesheetgenerate employee add -n "Name"');
    console.log('  3. Generate timesheet: service-timesheetgenerate generate --month 2025-01');
  });
