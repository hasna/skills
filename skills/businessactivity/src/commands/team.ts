import { Command } from 'commander';
import { requireProfile } from '../lib/config';
import { getTeamsPath, getTeamMembersPath, getOwnersPath } from '../lib/paths';
import { readArray, appendToArray, updateInArray, removeFromArray, findById, generateId, timestamp, writeJson } from '../lib/storage';
import { printTable, success, error, info, formatDate } from '../lib/output';
import type { Team, TeamMember, Owner } from '../types';

export function registerTeamCommands(program: Command): void {
  const teamCmd = program
    .command('team')
    .description('Manage teams');

  // team:create
  teamCmd
    .command('create')
    .description('Create a new team')
    .requiredOption('-n, --name <name>', 'Team name')
    .option('-d, --description <description>', 'Team description')
    .option('-m, --metadata <json>', 'Metadata as JSON')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getTeamsPath(profileName);

        const metadata = options.metadata ? JSON.parse(options.metadata) : undefined;

        const team: Team = {
          id: generateId('team'),
          name: options.name,
          description: options.description,
          metadata,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        };

        await appendToArray(path, team);
        success(`Team "${team.name}" created with ID: ${team.id}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create team');
        process.exit(1);
      }
    });

  // team:list
  teamCmd
    .command('list')
    .description('List all teams')
    .action(async () => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getTeamsPath(profileName);

        const teams = await readArray<Team>(path);

        if (teams.length === 0) {
          info('No teams found');
          return;
        }

        const rows = teams.map(t => [
          t.id.slice(0, 12) + '...',
          t.name,
          t.description || '-',
          formatDate(t.createdAt),
        ]);

        printTable(['ID', 'Name', 'Description', 'Created'], rows);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list teams');
        process.exit(1);
      }
    });

  // team:get
  teamCmd
    .command('get <id>')
    .description('Get team details with members')
    .action(async (id) => {
      try {
        const { name: profileName } = await requireProfile();
        const teamsPath = getTeamsPath(profileName);
        const membersPath = getTeamMembersPath(profileName);
        const ownersPath = getOwnersPath(profileName);

        const team = await findById<Team>(teamsPath, id);

        if (!team) {
          error(`Team with ID "${id}" not found`);
          process.exit(1);
        }

        // Get team members
        const allMembers = await readArray<TeamMember>(membersPath);
        const teamMembers = allMembers.filter(m => m.teamId === id);

        // Get owner details
        const owners = await readArray<Owner>(ownersPath);
        const ownerMap = new Map(owners.map(o => [o.id, o]));

        console.log(`\nTeam: ${team.name}`);
        console.log(`ID: ${team.id}`);
        console.log(`Description: ${team.description || '-'}`);
        if (team.metadata) {
          console.log(`Metadata: ${JSON.stringify(team.metadata, null, 2)}`);
        }
        console.log(`Created: ${formatDate(team.createdAt)}`);
        console.log(`Updated: ${formatDate(team.updatedAt)}`);

        console.log(`\nMembers (${teamMembers.length}):`);
        if (teamMembers.length === 0) {
          console.log('  No members');
        } else {
          teamMembers.forEach(m => {
            const owner = ownerMap.get(m.ownerId);
            console.log(`  - ${owner?.name || 'Unknown'} (${owner?.ownerType || '?'})${m.role ? ` - ${m.role}` : ''}`);
          });
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get team');
        process.exit(1);
      }
    });

  // team:add-member
  teamCmd
    .command('add-member')
    .description('Add an owner to a team')
    .requiredOption('-t, --team <teamId>', 'Team ID')
    .requiredOption('-o, --owner <ownerId>', 'Owner ID')
    .option('-r, --role <role>', 'Role in the team')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const teamsPath = getTeamsPath(profileName);
        const membersPath = getTeamMembersPath(profileName);
        const ownersPath = getOwnersPath(profileName);

        // Verify team exists
        const team = await findById<Team>(teamsPath, options.team);
        if (!team) {
          error(`Team with ID "${options.team}" not found`);
          process.exit(1);
        }

        // Verify owner exists
        const owner = await findById<Owner>(ownersPath, options.owner);
        if (!owner) {
          error(`Owner with ID "${options.owner}" not found`);
          process.exit(1);
        }

        // Check if already a member
        const allMembers = await readArray<TeamMember>(membersPath);
        const existing = allMembers.find(m => m.teamId === options.team && m.ownerId === options.owner);
        if (existing) {
          error('Owner is already a member of this team');
          process.exit(1);
        }

        const member: TeamMember = {
          teamId: options.team,
          ownerId: options.owner,
          role: options.role,
          createdAt: timestamp(),
        };

        allMembers.push(member);
        await writeJson(membersPath, allMembers);

        success(`Added "${owner.name}" to team "${team.name}"`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to add member');
        process.exit(1);
      }
    });

  // team:remove-member
  teamCmd
    .command('remove-member')
    .description('Remove an owner from a team')
    .requiredOption('-t, --team <teamId>', 'Team ID')
    .requiredOption('-o, --owner <ownerId>', 'Owner ID')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const membersPath = getTeamMembersPath(profileName);

        const allMembers = await readArray<TeamMember>(membersPath);
        const index = allMembers.findIndex(m => m.teamId === options.team && m.ownerId === options.owner);

        if (index === -1) {
          error('Member not found in team');
          process.exit(1);
        }

        allMembers.splice(index, 1);
        await writeJson(membersPath, allMembers);

        success('Member removed from team');
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to remove member');
        process.exit(1);
      }
    });

  // team:delete
  teamCmd
    .command('delete <id>')
    .description('Delete a team')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const teamsPath = getTeamsPath(profileName);
        const membersPath = getTeamMembersPath(profileName);

        const team = await findById<Team>(teamsPath, id);

        if (!team) {
          error(`Team with ID "${id}" not found`);
          process.exit(1);
        }

        if (!options.force) {
          info(`This will delete team "${team.name}" and remove all member associations.`);
          info('Use --force to confirm deletion.');
          return;
        }

        // Remove team members
        const allMembers = await readArray<TeamMember>(membersPath);
        const filtered = allMembers.filter(m => m.teamId !== id);
        await writeJson(membersPath, filtered);

        // Remove team
        await removeFromArray<Team>(teamsPath, id);

        success(`Team "${team.name}" deleted`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to delete team');
        process.exit(1);
      }
    });
}
