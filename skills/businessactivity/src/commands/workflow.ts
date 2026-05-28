import { Command } from 'commander';
import { requireProfile } from '../lib/config';
import { getWorkflowsPath, getWorkflowStepsPath, getOwnersPath, getTeamsPath } from '../lib/paths';
import { readArray, appendToArray, updateInArray, removeFromArray, findById, generateId, timestamp, writeJson } from '../lib/storage';
import { printTable, success, error, info, formatDate } from '../lib/output';
import type { Workflow, WorkflowStep, Owner, Team, WorkflowStatus, TriggerType } from '../types';
import { WORKFLOW_STATUSES, TRIGGER_TYPES } from '../types';

export function registerWorkflowCommands(program: Command): void {
  const workflowCmd = program
    .command('workflow')
    .description('Manage workflows');

  // workflow:create
  workflowCmd
    .command('create')
    .description('Create a new workflow')
    .requiredOption('-n, --name <name>', 'Workflow name')
    .option('-d, --description <description>', 'Workflow description')
    .option('-t, --trigger <type>', 'Trigger type (manual, scheduled, event, condition)', 'manual')
    .option('-s, --status <status>', 'Initial status (draft, active, paused, archived)', 'draft')
    .option('-m, --metadata <json>', 'Metadata as JSON')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getWorkflowsPath(profileName);

        if (!TRIGGER_TYPES.includes(options.trigger)) {
          error(`Invalid trigger type. Must be one of: ${TRIGGER_TYPES.join(', ')}`);
          process.exit(1);
        }

        if (!WORKFLOW_STATUSES.includes(options.status)) {
          error(`Invalid status. Must be one of: ${WORKFLOW_STATUSES.join(', ')}`);
          process.exit(1);
        }

        const metadata = options.metadata ? JSON.parse(options.metadata) : undefined;

        const workflow: Workflow = {
          id: generateId('wf'),
          name: options.name,
          description: options.description,
          triggerType: options.trigger as TriggerType,
          status: options.status as WorkflowStatus,
          metadata,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        };

        await appendToArray(path, workflow);
        success(`Workflow "${workflow.name}" created with ID: ${workflow.id}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create workflow');
        process.exit(1);
      }
    });

  // workflow:list
  workflowCmd
    .command('list')
    .description('List all workflows')
    .option('-s, --status <status>', 'Filter by status')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getWorkflowsPath(profileName);

        let workflows = await readArray<Workflow>(path);

        if (options.status) {
          workflows = workflows.filter(w => w.status === options.status);
        }

        if (workflows.length === 0) {
          info('No workflows found');
          return;
        }

        const rows = workflows.map(w => [
          w.id.slice(0, 12) + '...',
          w.name,
          w.triggerType,
          w.status,
          w.description || '-',
        ]);

        printTable(['ID', 'Name', 'Trigger', 'Status', 'Description'], rows);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to list workflows');
        process.exit(1);
      }
    });

  // workflow:show
  workflowCmd
    .command('show <id>')
    .description('Show workflow details with all steps')
    .action(async (id) => {
      try {
        const { name: profileName } = await requireProfile();
        const workflowsPath = getWorkflowsPath(profileName);
        const stepsPath = getWorkflowStepsPath(profileName);
        const ownersPath = getOwnersPath(profileName);
        const teamsPath = getTeamsPath(profileName);

        const workflow = await findById<Workflow>(workflowsPath, id);

        if (!workflow) {
          error(`Workflow with ID "${id}" not found`);
          process.exit(1);
        }

        // Get steps ordered by sequence
        const allSteps = await readArray<WorkflowStep>(stepsPath);
        const steps = allSteps
          .filter(s => s.workflowId === id)
          .sort((a, b) => a.sequence - b.sequence);

        // Get owner and team names
        const owners = await readArray<Owner>(ownersPath);
        const teams = await readArray<Team>(teamsPath);
        const ownerMap = new Map(owners.map(o => [o.id, o.name]));
        const teamMap = new Map(teams.map(t => [t.id, t.name]));

        console.log(`\nWorkflow: ${workflow.name}`);
        console.log(`ID: ${workflow.id}`);
        console.log(`Description: ${workflow.description || '-'}`);
        console.log(`Trigger: ${workflow.triggerType}`);
        console.log(`Status: ${workflow.status}`);
        if (workflow.metadata) {
          console.log(`Metadata: ${JSON.stringify(workflow.metadata, null, 2)}`);
        }
        console.log(`Created: ${formatDate(workflow.createdAt)}`);
        console.log(`Updated: ${formatDate(workflow.updatedAt)}`);

        console.log(`\nSteps (${steps.length}):`);
        if (steps.length === 0) {
          console.log('  No steps defined');
        } else {
          steps.forEach(step => {
            const assignee = step.ownerId
              ? ownerMap.get(step.ownerId) || 'Unknown Owner'
              : step.teamId
                ? teamMap.get(step.teamId) || 'Unknown Team'
                : 'Unassigned';

            console.log(`  ${step.sequence}. ${step.name}`);
            console.log(`     Action: ${step.action || '-'}`);
            console.log(`     Assigned to: ${assignee}`);
            if (step.description) {
              console.log(`     Description: ${step.description}`);
            }
          });
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to show workflow');
        process.exit(1);
      }
    });

  // workflow:add-step
  workflowCmd
    .command('add-step')
    .description('Add a step to a workflow')
    .requiredOption('-w, --workflow <workflowId>', 'Workflow ID')
    .requiredOption('-n, --name <name>', 'Step name')
    .option('-a, --action <action>', 'Action to perform')
    .option('-d, --description <description>', 'Step description')
    .option('-o, --owner <ownerId>', 'Assign to owner')
    .option('-t, --team <teamId>', 'Assign to team')
    .option('-s, --sequence <number>', 'Position in workflow (default: end)')
    .option('-c, --conditions <json>', 'Conditions as JSON')
    .option('-m, --metadata <json>', 'Metadata as JSON')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const workflowsPath = getWorkflowsPath(profileName);
        const stepsPath = getWorkflowStepsPath(profileName);

        // Verify workflow exists
        const workflow = await findById<Workflow>(workflowsPath, options.workflow);
        if (!workflow) {
          error(`Workflow with ID "${options.workflow}" not found`);
          process.exit(1);
        }

        // Determine sequence
        const allSteps = await readArray<WorkflowStep>(stepsPath);
        const workflowSteps = allSteps.filter(s => s.workflowId === options.workflow);
        const sequence = options.sequence ? parseInt(options.sequence) : workflowSteps.length + 1;

        const conditions = options.conditions ? JSON.parse(options.conditions) : undefined;
        const metadata = options.metadata ? JSON.parse(options.metadata) : undefined;

        const step: WorkflowStep = {
          id: generateId('step'),
          workflowId: options.workflow,
          sequence,
          name: options.name,
          description: options.description,
          action: options.action,
          ownerId: options.owner,
          teamId: options.team,
          conditions,
          metadata,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        };

        await appendToArray(stepsPath, step);
        success(`Step "${step.name}" added to workflow at position ${sequence}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to add step');
        process.exit(1);
      }
    });

  // workflow:reorder
  workflowCmd
    .command('reorder')
    .description('Reorder workflow steps')
    .requiredOption('-w, --workflow <workflowId>', 'Workflow ID')
    .requiredOption('-s, --step <stepId>', 'Step ID to move')
    .requiredOption('-p, --position <number>', 'New position')
    .action(async (options) => {
      try {
        const { name: profileName } = await requireProfile();
        const stepsPath = getWorkflowStepsPath(profileName);

        // Get all steps for this workflow
        const allSteps = await readArray<WorkflowStep>(stepsPath);
        const otherSteps = allSteps.filter(s => s.workflowId !== options.workflow);
        const workflowSteps = allSteps
          .filter(s => s.workflowId === options.workflow)
          .sort((a, b) => a.sequence - b.sequence);

        const stepIndex = workflowSteps.findIndex(s => s.id === options.step);
        if (stepIndex === -1) {
          error(`Step with ID "${options.step}" not found`);
          process.exit(1);
        }

        const newPosition = parseInt(options.position);
        if (newPosition < 1 || newPosition > workflowSteps.length) {
          error(`Position must be between 1 and ${workflowSteps.length}`);
          process.exit(1);
        }

        // Remove step from current position and insert at new position
        const [movedStep] = workflowSteps.splice(stepIndex, 1);
        workflowSteps.splice(newPosition - 1, 0, movedStep);

        // Update all sequences
        workflowSteps.forEach((step, i) => {
          step.sequence = i + 1;
          step.updatedAt = timestamp();
        });

        // Save all steps
        await writeJson(stepsPath, [...otherSteps, ...workflowSteps]);

        success(`Step moved to position ${newPosition}`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to reorder steps');
        process.exit(1);
      }
    });

  // workflow:update
  workflowCmd
    .command('update <id>')
    .description('Update a workflow')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <description>', 'New description')
    .option('-t, --trigger <type>', 'New trigger type')
    .option('-s, --status <status>', 'New status')
    .option('-m, --metadata <json>', 'New metadata as JSON')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const path = getWorkflowsPath(profileName);

        const updates: Partial<Workflow> = {};
        if (options.name) updates.name = options.name;
        if (options.description) updates.description = options.description;
        if (options.trigger) {
          if (!TRIGGER_TYPES.includes(options.trigger)) {
            error(`Invalid trigger type. Must be one of: ${TRIGGER_TYPES.join(', ')}`);
            process.exit(1);
          }
          updates.triggerType = options.trigger;
        }
        if (options.status) {
          if (!WORKFLOW_STATUSES.includes(options.status)) {
            error(`Invalid status. Must be one of: ${WORKFLOW_STATUSES.join(', ')}`);
            process.exit(1);
          }
          updates.status = options.status;
        }
        if (options.metadata) {
          updates.metadata = JSON.parse(options.metadata);
        }

        const workflow = await updateInArray<Workflow>(path, id, updates);

        if (!workflow) {
          error(`Workflow with ID "${id}" not found`);
          process.exit(1);
        }

        success(`Workflow "${workflow.name}" updated`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to update workflow');
        process.exit(1);
      }
    });

  // workflow:delete
  workflowCmd
    .command('delete <id>')
    .description('Delete a workflow')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        const { name: profileName } = await requireProfile();
        const workflowsPath = getWorkflowsPath(profileName);
        const stepsPath = getWorkflowStepsPath(profileName);

        const workflow = await findById<Workflow>(workflowsPath, id);

        if (!workflow) {
          error(`Workflow with ID "${id}" not found`);
          process.exit(1);
        }

        const allSteps = await readArray<WorkflowStep>(stepsPath);
        const workflowSteps = allSteps.filter(s => s.workflowId === id);

        if (!options.force) {
          info(`This will delete workflow "${workflow.name}" and its ${workflowSteps.length} step(s).`);
          info('Use --force to confirm deletion.');
          return;
        }

        // Remove workflow steps
        const remainingSteps = allSteps.filter(s => s.workflowId !== id);
        await writeJson(stepsPath, remainingSteps);

        // Remove workflow
        await removeFromArray<Workflow>(workflowsPath, id);

        success(`Workflow "${workflow.name}" deleted`);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to delete workflow');
        process.exit(1);
      }
    });
}
