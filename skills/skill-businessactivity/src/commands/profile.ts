import { Command } from 'commander';
import {
  createProfile,
  deleteProfile,
  setCurrentProfile,
  listProfiles,
  getCurrentProfile,
  getCurrentProfileName,
} from '../lib/config';
import { printTable, success, error, info, formatDate } from '../lib/output';
import { getProfileDir } from '../lib/paths';

export function registerProfileCommands(program: Command): void {
  const profileCmd = program
    .command('profile')
    .description('Manage profiles (companies)');

  // profile:create
  profileCmd
    .command('create')
    .description('Create a new profile')
    .requiredOption('-n, --name <name>', 'Profile name')
    .option('-d, --description <description>', 'Profile description')
    .action(async (options) => {
      try {
        const profile = await createProfile(options.name, options.description);
        success(`Profile "${profile.name}" created`);
        info(`Data stored at: ${getProfileDir(options.name)}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create profile');
        process.exit(1);
      }
    });

  // profile:list
  profileCmd
    .command('list')
    .description('List all profiles')
    .action(async () => {
      try {
        const profiles = await listProfiles();
        const currentName = await getCurrentProfileName();

        if (profiles.length === 0) {
          info('No profiles configured. Create one with: businessactivity profile create --name <name>');
          return;
        }

        const rows = profiles.map(p => [
          p.name === currentName ? '*' : '',
          p.name,
          p.id.slice(0, 12) + '...',
          p.description || '-',
          formatDate(p.createdAt),
        ]);

        printTable(['', 'Name', 'ID', 'Description', 'Created'], rows);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list profiles');
        process.exit(1);
      }
    });

  // profile:use
  profileCmd
    .command('use <name>')
    .description('Switch to a profile')
    .action(async (name) => {
      try {
        await setCurrentProfile(name);
        success(`Switched to profile "${name}"`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to switch profile');
        process.exit(1);
      }
    });

  // profile:delete
  profileCmd
    .command('delete <name>')
    .description('Delete a profile')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name, options) => {
      try {
        if (!options.force) {
          info(`This will delete profile "${name}" and ALL its data.`);
          info('Use --force to confirm deletion.');
          return;
        }

        await deleteProfile(name);
        success(`Profile "${name}" deleted`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to delete profile');
        process.exit(1);
      }
    });

  // profile:current
  profileCmd
    .command('current')
    .description('Show current profile')
    .action(async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          info('No profile selected. Create one with: businessactivity profile create --name <name>');
          return;
        }

        console.log(`Current profile: ${profile.name}`);
        console.log(`ID: ${profile.id}`);
        console.log(`Description: ${profile.description || '-'}`);
        console.log(`Data path: ${getProfileDir(profile.name)}`);
        console.log(`Created: ${formatDate(profile.createdAt)}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get current profile');
        process.exit(1);
      }
    });
}
