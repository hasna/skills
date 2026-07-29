import { Command } from 'commander';
import { requireProfile } from '../lib/config';
import { getOwnersPath } from '../lib/paths';
import { readArray, appendToArray, updateInArray, removeFromArray, findById, generateId, timestamp } from '../lib/storage';
import { printTable, success, error, info, formatDate } from '../lib/output';
import type { Owner, OwnerType } from '../types';
import { OWNER_TYPES } from '../types';

export function registerOwnerCommands(program: Command): void {
  const ownerCmd = program
    .command('owner')
    .description('Manage owners (humans and agents)');

  // owner:create
  ownerCmd
    .command('create')
    .description('Create a new owner')
    .requiredOption('-n, --name <name>', 'Owner name')
    .requiredOption('-t, --type <type>', 'Owner type (human or agent)')
    .option('-e, --email <email>', 'Email address')
    .option('-c, --capabilities <capabilities>', 'Comma-separated list of capabilities')
    .option('-m, --metadata <json>', 'Metadata as JSON')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getOwnersPath(profileName);

        if (!OWNER_TYPES.includes(options.type)) {
          error(`Owner type must be one of: ${OWNER_TYPES.join(', ')}`);
          process.exit(1);
        }

        const capabilities = options.capabilities
          ? options.capabilities.split(',').map((c: string) => c.trim())
          : undefined;

        const metadata = options.metadata ? JSON.parse(options.metadata) : undefined;

        const owner: Owner = {
          id: generateId('own'),
          name: options.name,
          ownerType: options.type as OwnerType,
          email: options.email,
          capabilities,
          metadata,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        };

        await appendToArray(path, owner);
        success(`Owner "${owner.name}" created with ID: ${owner.id}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create owner');
        process.exit(1);
      }
    });

  // owner:list
  ownerCmd
    .command('list')
    .description('List all owners in current profile')
    .option('-t, --type <type>', 'Filter by owner type (human or agent)')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getOwnersPath(profileName);

        let owners = await readArray<Owner>(path);

        if (options.type) {
          owners = owners.filter(o => o.ownerType === options.type);
        }

        if (owners.length === 0) {
          info('No owners found');
          return;
        }

        const rows = owners.map(o => [
          o.id.slice(0, 12) + '...',
          o.name,
          o.ownerType,
          o.email || '-',
          (o.capabilities || []).join(', ') || '-',
        ]);

        printTable(['ID', 'Name', 'Type', 'Email', 'Capabilities'], rows);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list owners');
        process.exit(1);
      }
    });

  // owner:get
  ownerCmd
    .command('get <id>')
    .description('Get owner details')
    .action(async (id) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getOwnersPath(profileName);

        const owner = await findById<Owner>(path, id);

        if (!owner) {
          error(`Owner with ID "${id}" not found`);
          process.exit(1);
        }

        console.log(`\nOwner: ${owner.name}`);
        console.log(`ID: ${owner.id}`);
        console.log(`Type: ${owner.ownerType}`);
        console.log(`Email: ${owner.email || '-'}`);
        console.log(`Capabilities: ${(owner.capabilities || []).join(', ') || '-'}`);
        if (owner.metadata) {
          console.log(`Metadata: ${JSON.stringify(owner.metadata, null, 2)}`);
        }
        console.log(`Created: ${formatDate(owner.createdAt)}`);
        console.log(`Updated: ${formatDate(owner.updatedAt)}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get owner');
        process.exit(1);
      }
    });

  // owner:update
  ownerCmd
    .command('update <id>')
    .description('Update an owner')
    .option('-n, --name <name>', 'New name')
    .option('-e, --email <email>', 'New email')
    .option('-c, --capabilities <capabilities>', 'New capabilities (comma-separated)')
    .option('-m, --metadata <json>', 'New metadata as JSON')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getOwnersPath(profileName);

        const updates: Partial<Owner> = {};
        if (options.name) updates.name = options.name;
        if (options.email) updates.email = options.email;
        if (options.capabilities) {
          updates.capabilities = options.capabilities.split(',').map((c: string) => c.trim());
        }
        if (options.metadata) {
          updates.metadata = JSON.parse(options.metadata);
        }

        const owner = await updateInArray<Owner>(path, id, updates);

        if (!owner) {
          error(`Owner with ID "${id}" not found`);
          process.exit(1);
        }

        success(`Owner "${owner.name}" updated`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to update owner');
        process.exit(1);
      }
    });

  // owner:delete
  ownerCmd
    .command('delete <id>')
    .description('Delete an owner')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getOwnersPath(profileName);

        const owner = await findById<Owner>(path, id);

        if (!owner) {
          error(`Owner with ID "${id}" not found`);
          process.exit(1);
        }

        if (!options.force) {
          info(`This will delete owner "${owner.name}".`);
          info('Use --force to confirm deletion.');
          return;
        }

        await removeFromArray<Owner>(path, id);
        success(`Owner "${owner.name}" deleted`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to delete owner');
        process.exit(1);
      }
    });
}
