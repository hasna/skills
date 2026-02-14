import { Command } from 'commander';
import { requireProfile } from '../lib/config';
import { getFunctionsPath } from '../lib/paths';
import { readArray, appendToArray, updateInArray, removeFromArray, findById, generateId, timestamp } from '../lib/storage';
import { printTable, success, error, info, formatDate, buildTree, printTree } from '../lib/output';
import type { Function } from '../types';

export function registerFunctionCommands(program: Command): void {
  const functionCmd = program
    .command('function')
    .description('Manage business functions');

  // function:create
  functionCmd
    .command('create')
    .description('Create a new business function')
    .requiredOption('-n, --name <name>', 'Function name')
    .option('-d, --description <description>', 'Function description')
    .option('-p, --parent <parentId>', 'Parent function ID (for hierarchy)')
    .option('-m, --metadata <json>', 'Metadata as JSON')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getFunctionsPath(profileName);

        // Verify parent exists if provided
        if (options.parent) {
          const parent = await findById<Function>(path, options.parent);
          if (!parent) {
            error(`Parent function with ID "${options.parent}" not found`);
            process.exit(1);
          }
        }

        const metadata = options.metadata ? JSON.parse(options.metadata) : undefined;

        const func: Function = {
          id: generateId('func'),
          name: options.name,
          description: options.description,
          parentId: options.parent,
          metadata,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        };

        await appendToArray(path, func);
        success(`Function "${func.name}" created with ID: ${func.id}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create function');
        process.exit(1);
      }
    });

  // function:list
  functionCmd
    .command('list')
    .description('List all functions')
    .option('--flat', 'Show as flat list instead of tree')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getFunctionsPath(profileName);

        const functions = await readArray<Function>(path);

        if (functions.length === 0) {
          info('No functions found');
          return;
        }

        if (options.flat) {
          const rows = functions.map(f => [
            f.id.slice(0, 12) + '...',
            f.name,
            f.parentId ? f.parentId.slice(0, 12) + '...' : '-',
            f.description || '-',
          ]);

          printTable(['ID', 'Name', 'Parent', 'Description'], rows);
        } else {
          console.log('\nBusiness Functions:\n');
          const tree = buildTree(functions);
          printTree(tree);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list functions');
        process.exit(1);
      }
    });

  // function:get
  functionCmd
    .command('get <id>')
    .description('Get function details')
    .action(async (id) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getFunctionsPath(profileName);

        const func = await findById<Function>(path, id);

        if (!func) {
          error(`Function with ID "${id}" not found`);
          process.exit(1);
        }

        // Get parent name if exists
        let parentName = '-';
        if (func.parentId) {
          const parent = await findById<Function>(path, func.parentId);
          if (parent) parentName = parent.name;
        }

        // Get children
        const allFunctions = await readArray<Function>(path);
        const children = allFunctions.filter(f => f.parentId === id);

        console.log(`\nFunction: ${func.name}`);
        console.log(`ID: ${func.id}`);
        console.log(`Description: ${func.description || '-'}`);
        console.log(`Parent: ${parentName}`);
        if (func.metadata) {
          console.log(`Metadata: ${JSON.stringify(func.metadata, null, 2)}`);
        }
        console.log(`Created: ${formatDate(func.createdAt)}`);
        console.log(`Updated: ${formatDate(func.updatedAt)}`);

        if (children.length > 0) {
          console.log(`\nChild Functions (${children.length}):`);
          children.forEach(c => {
            console.log(`  - ${c.name} (${c.id.slice(0, 12)}...)`);
          });
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get function');
        process.exit(1);
      }
    });

  // function:update
  functionCmd
    .command('update <id>')
    .description('Update a function')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <description>', 'New description')
    .option('-p, --parent <parentId>', 'New parent function ID')
    .option('--no-parent', 'Remove parent (make root level)')
    .option('-m, --metadata <json>', 'New metadata as JSON')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getFunctionsPath(profileName);

        const updates: Partial<Function> = {};
        if (options.name) updates.name = options.name;
        if (options.description) updates.description = options.description;
        if (options.parent === false) {
          updates.parentId = undefined;
        } else if (options.parent) {
          if (options.parent === id) {
            error('A function cannot be its own parent');
            process.exit(1);
          }
          const parent = await findById<Function>(path, options.parent);
          if (!parent) {
            error(`Parent function with ID "${options.parent}" not found`);
            process.exit(1);
          }
          updates.parentId = options.parent;
        }
        if (options.metadata) {
          updates.metadata = JSON.parse(options.metadata);
        }

        const func = await updateInArray<Function>(path, id, updates);

        if (!func) {
          error(`Function with ID "${id}" not found`);
          process.exit(1);
        }

        success(`Function "${func.name}" updated`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to update function');
        process.exit(1);
      }
    });

  // function:delete
  functionCmd
    .command('delete <id>')
    .description('Delete a function')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getFunctionsPath(profileName);

        const func = await findById<Function>(path, id);

        if (!func) {
          error(`Function with ID "${id}" not found`);
          process.exit(1);
        }

        // Check for children
        const allFunctions = await readArray<Function>(path);
        const children = allFunctions.filter(f => f.parentId === id);

        if (!options.force) {
          info(`This will delete function "${func.name}" and all related activities.`);
          if (children.length > 0) {
            info(`Warning: This function has ${children.length} child function(s) that will become orphaned.`);
          }
          info('Use --force to confirm deletion.');
          return;
        }

        await removeFromArray<Function>(path, id);
        success(`Function "${func.name}" deleted`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to delete function');
        process.exit(1);
      }
    });
}
