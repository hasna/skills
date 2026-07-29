import { Command } from 'commander';
import { requireProfile } from '../lib/config';
import { getActivitiesPath, getFunctionsPath } from '../lib/paths';
import { readArray, appendToArray, updateInArray, removeFromArray, findById, generateId, timestamp } from '../lib/storage';
import { printTable, success, error, info, formatDate } from '../lib/output';
import type { Activity, Function, ActivityStatus } from '../types';
import { ACTIVITY_STATUSES } from '../types';

export function registerActivityCommands(program: Command): void {
  const activityCmd = program
    .command('activity')
    .description('Manage activities');

  // activity:create
  activityCmd
    .command('create')
    .description('Create a new activity under a function')
    .requiredOption('-n, --name <name>', 'Activity name')
    .requiredOption('-f, --function <functionId>', 'Parent function ID')
    .option('-d, --description <description>', 'Activity description')
    .option('-s, --status <status>', 'Initial status (pending, in_progress, completed, cancelled)', 'pending')
    .option('-m, --metadata <json>', 'Metadata as JSON')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const activitiesPath = getActivitiesPath(profileName);
        const functionsPath = getFunctionsPath(profileName);

        // Verify function exists
        const func = await findById<Function>(functionsPath, options.function);
        if (!func) {
          error(`Function with ID "${options.function}" not found`);
          process.exit(1);
        }

        if (!ACTIVITY_STATUSES.includes(options.status)) {
          error(`Invalid status. Must be one of: ${ACTIVITY_STATUSES.join(', ')}`);
          process.exit(1);
        }

        const metadata = options.metadata ? JSON.parse(options.metadata) : undefined;

        const activity: Activity = {
          id: generateId('act'),
          functionId: options.function,
          name: options.name,
          description: options.description,
          status: options.status as ActivityStatus,
          metadata,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        };

        await appendToArray(activitiesPath, activity);
        success(`Activity "${activity.name}" created with ID: ${activity.id}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create activity');
        process.exit(1);
      }
    });

  // activity:list
  activityCmd
    .command('list')
    .description('List activities')
    .option('-f, --function <functionId>', 'Filter by function ID')
    .option('-s, --status <status>', 'Filter by status')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const activitiesPath = getActivitiesPath(profileName);
        const functionsPath = getFunctionsPath(profileName);

        let activities = await readArray<Activity>(activitiesPath);
        const functions = await readArray<Function>(functionsPath);
        const functionMap = new Map(functions.map(f => [f.id, f.name]));

        if (options.function) {
          activities = activities.filter(a => a.functionId === options.function);
        }
        if (options.status) {
          activities = activities.filter(a => a.status === options.status);
        }

        if (activities.length === 0) {
          info('No activities found');
          return;
        }

        const rows = activities.map(a => [
          a.id.slice(0, 12) + '...',
          a.name,
          functionMap.get(a.functionId) || '-',
          a.status,
          a.description || '-',
        ]);

        printTable(['ID', 'Name', 'Function', 'Status', 'Description'], rows);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list activities');
        process.exit(1);
      }
    });

  // activity:get
  activityCmd
    .command('get <id>')
    .description('Get activity details')
    .action(async (id) => {
      try {
        const { name: profileName } = await requireProfile();
        const activitiesPath = getActivitiesPath(profileName);
        const functionsPath = getFunctionsPath(profileName);

        const activity = await findById<Activity>(activitiesPath, id);

        if (!activity) {
          error(`Activity with ID "${id}" not found`);
          process.exit(1);
        }

        const func = await findById<Function>(functionsPath, activity.functionId);

        console.log(`\nActivity: ${activity.name}`);
        console.log(`ID: ${activity.id}`);
        console.log(`Function: ${func?.name || '-'}`);
        console.log(`Status: ${activity.status}`);
        console.log(`Description: ${activity.description || '-'}`);
        if (activity.metadata) {
          console.log(`Metadata: ${JSON.stringify(activity.metadata, null, 2)}`);
        }
        console.log(`Created: ${formatDate(activity.createdAt)}`);
        console.log(`Updated: ${formatDate(activity.updatedAt)}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get activity');
        process.exit(1);
      }
    });

  // activity:update
  activityCmd
    .command('update <id>')
    .description('Update an activity')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <description>', 'New description')
    .option('-s, --status <status>', 'New status')
    .option('-m, --metadata <json>', 'New metadata as JSON')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const activitiesPath = getActivitiesPath(profileName);

        const updates: Partial<Activity> = {};
        if (options.name) updates.name = options.name;
        if (options.description) updates.description = options.description;
        if (options.status) {
          if (!ACTIVITY_STATUSES.includes(options.status)) {
            error(`Invalid status. Must be one of: ${ACTIVITY_STATUSES.join(', ')}`);
            process.exit(1);
          }
          updates.status = options.status;
        }
        if (options.metadata) {
          updates.metadata = JSON.parse(options.metadata);
        }

        const activity = await updateInArray<Activity>(activitiesPath, id, updates);

        if (!activity) {
          error(`Activity with ID "${id}" not found`);
          process.exit(1);
        }

        success(`Activity "${activity.name}" updated`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to update activity');
        process.exit(1);
      }
    });

  // activity:delete
  activityCmd
    .command('delete <id>')
    .description('Delete an activity')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const activitiesPath = getActivitiesPath(profileName);

        const activity = await findById<Activity>(activitiesPath, id);

        if (!activity) {
          error(`Activity with ID "${id}" not found`);
          process.exit(1);
        }

        if (!options.force) {
          info(`This will delete activity "${activity.name}".`);
          info('Use --force to confirm deletion.');
          return;
        }

        await removeFromArray<Activity>(activitiesPath, id);
        success(`Activity "${activity.name}" deleted`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to delete activity');
        process.exit(1);
      }
    });
}
