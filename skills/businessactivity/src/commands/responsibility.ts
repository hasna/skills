import { Command } from 'commander';
import { requireProfile } from '../lib/config';
import { getResponsibilitiesPath, getOwnersPath, getFunctionsPath, getActivitiesPath } from '../lib/paths';
import { readArray, appendToArray, removeFromArray, findById, generateId, timestamp } from '../lib/storage';
import { printTable, success, error, info } from '../lib/output';
import type { Responsibility, Owner, Function, Activity, ResponsibilityType } from '../types';
import { RESPONSIBILITY_TYPES } from '../types';

export function registerResponsibilityCommands(program: Command): void {
  const responsibilityCmd = program
    .command('responsibility')
    .description('Manage responsibilities (RACI assignments)');

  // responsibility:assign
  responsibilityCmd
    .command('assign')
    .description('Assign an owner to a function or activity')
    .requiredOption('-o, --owner <ownerId>', 'Owner ID')
    .requiredOption('-t, --type <type>', 'Responsibility type (owner, accountable, consulted, informed)')
    .option('-f, --function <functionId>', 'Function ID')
    .option('-a, --activity <activityId>', 'Activity ID')
    .option('-m, --metadata <json>', 'Metadata as JSON')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const responsibilitiesPath = getResponsibilitiesPath(profileName);
        const ownersPath = getOwnersPath(profileName);
        const functionsPath = getFunctionsPath(profileName);
        const activitiesPath = getActivitiesPath(profileName);

        if (!options.function && !options.activity) {
          error('Must specify either --function or --activity');
          process.exit(1);
        }

        if (options.function && options.activity) {
          error('Cannot specify both --function and --activity. Choose one.');
          process.exit(1);
        }

        if (!RESPONSIBILITY_TYPES.includes(options.type)) {
          error(`Invalid responsibility type. Must be one of: ${RESPONSIBILITY_TYPES.join(', ')}`);
          process.exit(1);
        }

        // Verify owner exists
        const owner = await findById<Owner>(ownersPath, options.owner);
        if (!owner) {
          error(`Owner with ID "${options.owner}" not found`);
          process.exit(1);
        }

        // Verify function or activity exists
        if (options.function) {
          const func = await findById<Function>(functionsPath, options.function);
          if (!func) {
            error(`Function with ID "${options.function}" not found`);
            process.exit(1);
          }
        }

        if (options.activity) {
          const activity = await findById<Activity>(activitiesPath, options.activity);
          if (!activity) {
            error(`Activity with ID "${options.activity}" not found`);
            process.exit(1);
          }
        }

        const metadata = options.metadata ? JSON.parse(options.metadata) : undefined;

        const responsibility: Responsibility = {
          id: generateId('resp'),
          ownerId: options.owner,
          functionId: options.function,
          activityId: options.activity,
          responsibilityType: options.type as ResponsibilityType,
          metadata,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        };

        await appendToArray(responsibilitiesPath, responsibility);

        const target = options.function ? 'function' : 'activity';
        success(`Assigned "${owner.name}" as ${options.type} for ${target}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to assign responsibility');
        process.exit(1);
      }
    });

  // responsibility:list
  responsibilityCmd
    .command('list')
    .description('List responsibilities')
    .option('-o, --owner <ownerId>', 'Filter by owner ID')
    .option('-f, --function <functionId>', 'Filter by function ID')
    .option('-a, --activity <activityId>', 'Filter by activity ID')
    .option('-t, --type <type>', 'Filter by responsibility type')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const responsibilitiesPath = getResponsibilitiesPath(profileName);
        const ownersPath = getOwnersPath(profileName);
        const functionsPath = getFunctionsPath(profileName);
        const activitiesPath = getActivitiesPath(profileName);

        let responsibilities = await readArray<Responsibility>(responsibilitiesPath);
        const owners = await readArray<Owner>(ownersPath);
        const functions = await readArray<Function>(functionsPath);
        const activities = await readArray<Activity>(activitiesPath);

        if (options.owner) {
          responsibilities = responsibilities.filter(r => r.ownerId === options.owner);
        }
        if (options.function) {
          responsibilities = responsibilities.filter(r => r.functionId === options.function);
        }
        if (options.activity) {
          responsibilities = responsibilities.filter(r => r.activityId === options.activity);
        }
        if (options.type) {
          responsibilities = responsibilities.filter(r => r.responsibilityType === options.type);
        }

        if (responsibilities.length === 0) {
          info('No responsibilities found');
          return;
        }

        const ownerMap = new Map(owners.map(o => [o.id, o.name]));
        const functionMap = new Map(functions.map(f => [f.id, f.name]));
        const activityMap = new Map(activities.map(a => [a.id, a.name]));

        const rows = responsibilities.map(r => [
          r.id.slice(0, 12) + '...',
          ownerMap.get(r.ownerId) || '-',
          r.responsibilityType.toUpperCase()[0], // R, A, C, or I
          r.functionId ? functionMap.get(r.functionId) || '-' : '-',
          r.activityId ? activityMap.get(r.activityId) || '-' : '-',
        ]);

        printTable(['ID', 'Owner', 'Type', 'Function', 'Activity'], rows);

        console.log('\nType legend: R=Responsible (owner), A=Accountable, C=Consulted, I=Informed');
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list responsibilities');
        process.exit(1);
      }
    });

  // responsibility:revoke
  responsibilityCmd
    .command('revoke <id>')
    .description('Remove a responsibility assignment')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const responsibilitiesPath = getResponsibilitiesPath(profileName);
        const ownersPath = getOwnersPath(profileName);

        const responsibility = await findById<Responsibility>(responsibilitiesPath, id);

        if (!responsibility) {
          error(`Responsibility with ID "${id}" not found`);
          process.exit(1);
        }

        const owner = await findById<Owner>(ownersPath, responsibility.ownerId);

        if (!options.force) {
          info(`This will revoke ${responsibility.responsibilityType} responsibility from "${owner?.name || 'Unknown'}".`);
          info('Use --force to confirm.');
          return;
        }

        await removeFromArray<Responsibility>(responsibilitiesPath, id);
        success('Responsibility revoked');
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to revoke responsibility');
        process.exit(1);
      }
    });

  // responsibility:matrix
  responsibilityCmd
    .command('matrix')
    .description('Show RACI matrix for a function')
    .requiredOption('-f, --function <functionId>', 'Function ID')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const responsibilitiesPath = getResponsibilitiesPath(profileName);
        const ownersPath = getOwnersPath(profileName);
        const functionsPath = getFunctionsPath(profileName);
        const activitiesPath = getActivitiesPath(profileName);

        // Get function
        const func = await findById<Function>(functionsPath, options.function);
        if (!func) {
          error(`Function with ID "${options.function}" not found`);
          process.exit(1);
        }

        // Get activities for this function
        const allActivities = await readArray<Activity>(activitiesPath);
        const functionActivities = allActivities.filter(a => a.functionId === options.function);

        // Get all owners
        const owners = await readArray<Owner>(ownersPath);

        // Get responsibilities for function and its activities
        const allResponsibilities = await readArray<Responsibility>(responsibilitiesPath);
        const relevantResponsibilities = allResponsibilities.filter(r =>
          r.functionId === options.function ||
          functionActivities.some(a => a.id === r.activityId)
        );

        console.log(`\nRACI Matrix for: ${func.name}`);
        console.log('='.repeat(60));

        if (owners.length === 0) {
          info('No owners found. Create owners first.');
          return;
        }

        // Build matrix
        const ownerHeaders = owners.map(o => o.name.slice(0, 10));
        const headers = ['Activity/Function', ...ownerHeaders];

        const rows: string[][] = [];

        // Function row
        const functionRow = [func.name];
        for (const owner of owners) {
          const resp = relevantResponsibilities.find(r =>
            r.ownerId === owner.id && r.functionId === options.function
          );
          functionRow.push(resp ? resp.responsibilityType.toUpperCase()[0] : '-');
        }
        rows.push(functionRow);

        // Activity rows
        for (const activity of functionActivities) {
          const activityRow = [`  ${activity.name}`];
          for (const owner of owners) {
            const resp = relevantResponsibilities.find(r =>
              r.ownerId === owner.id && r.activityId === activity.id
            );
            activityRow.push(resp ? resp.responsibilityType.toUpperCase()[0] : '-');
          }
          rows.push(activityRow);
        }

        printTable(headers, rows);
        console.log('\nLegend: R=Responsible (owner), A=Accountable, C=Consulted, I=Informed');
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to generate matrix');
        process.exit(1);
      }
    });
}
