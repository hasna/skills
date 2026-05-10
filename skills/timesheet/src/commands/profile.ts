import { Command } from 'commander';
import {
  listProfiles,
  createProfile,
  getProfile,
  deleteProfile,
  getDefaultProfile,
  setDefaultProfile,
  profileExists,
} from '../lib/profiles';

export const profileCommand = new Command('profile')
  .description('Manage profiles (companies)');

profileCommand
  .command('list')
  .description('List all profiles')
  .action(async () => {
    const profiles = await listProfiles();
    const defaultProfile = await getDefaultProfile();

    if (profiles.length === 0) {
      console.log('No profiles found.');
      console.log('\nCreate one with:');
      console.log('  service-timesheetgenerate profile create <name>');
      return;
    }

    console.log('Profiles:\n');
    for (const name of profiles) {
      const isDefault = name === defaultProfile ? ' (default)' : '';
      console.log(`  ${name}${isDefault}`);
    }
  });

profileCommand
  .command('create <name>')
  .description('Create a new profile')
  .option('-c, --country <country>', 'Country', 'Romania')
  .option('-t, --timezone <timezone>', 'Timezone', 'Europe/Bucharest')
  .option('-w, --weekend <days>', 'Weekend days (comma-separated, 0=Sun, 6=Sat)', '0,6')
  .action(async (name, options) => {
    const weekendDays = options.weekend.split(',').map((d: string) => parseInt(d.trim()));

    try {
      const profile = await createProfile(name, {
        country: options.country,
        timezone: options.timezone,
        weekendDays,
      });

      console.log(`Profile "${profile.name}" created.`);
      console.log(`  Country: ${profile.country}`);
      console.log(`  Timezone: ${profile.timezone}`);
      console.log(`  Weekend days: ${profile.weekendDays.join(', ')}`);

      // Set as default if it's the first profile
      const profiles = await listProfiles();
      if (profiles.length === 1) {
        await setDefaultProfile(name);
        console.log(`\nSet as default profile.`);
      } else {
        console.log(`\nTo use this profile by default, run:`);
        console.log(`  service-timesheetgenerate profile use ${name}`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

profileCommand
  .command('use <name>')
  .description('Set default profile')
  .action(async (name) => {
    if (!profileExists(name)) {
      console.error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }

    await setDefaultProfile(name);
    console.log(`Default profile set to "${name}".`);
  });

profileCommand
  .command('show [name]')
  .description('Show profile details')
  .action(async (name) => {
    const profileName = name || (await getDefaultProfile());
    if (!profileName) {
      console.error('No profile specified and no default profile set.');
      process.exit(1);
    }

    const profile = await getProfile(profileName);
    if (!profile) {
      console.error(`Profile "${profileName}" not found.`);
      process.exit(1);
    }

    const isDefault = profileName === (await getDefaultProfile());

    console.log(`Profile: ${profile.name}${isDefault ? ' (default)' : ''}`);
    console.log(`  Country: ${profile.country}`);
    console.log(`  Timezone: ${profile.timezone}`);
    console.log(`  Weekend days: ${profile.weekendDays.join(', ')}`);
    console.log(`  Created: ${profile.createdAt}`);
  });

profileCommand
  .command('delete <name>')
  .description('Delete a profile')
  .option('-f, --force', 'Skip confirmation')
  .action(async (name, options) => {
    if (!profileExists(name)) {
      console.error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }

    if (!options.force) {
      console.log(`This will permanently delete profile "${name}" and all its data.`);
      console.log('Use --force to confirm.');
      return;
    }

    const deleted = await deleteProfile(name);
    if (deleted) {
      console.log(`Profile "${name}" deleted.`);
    } else {
      console.error(`Failed to delete profile "${name}".`);
      process.exit(1);
    }
  });
