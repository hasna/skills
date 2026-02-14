import { Command } from 'commander';
import { listVacations, getVacationsForEmployee, addVacation, removeVacation } from '../lib/vacations';
import { getEmployee } from '../lib/employees';
import { resolveProfile } from '../lib/profiles';
import type { VacationType } from '../types';

export const vacationCommand = new Command('vacation')
  .description('Manage vacations');

vacationCommand
  .command('list')
  .description('List all vacations')
  .option('-e, --employee <id>', 'Filter by employee ID')
  .action(async (options) => {
    const profileName = await resolveProfile((vacationCommand.parent as Command)?.opts().profile);

    let vacations;
    if (options.employee) {
      vacations = await getVacationsForEmployee(profileName, options.employee);
    } else {
      vacations = await listVacations(profileName);
    }

    if (vacations.length === 0) {
      console.log(`No vacations in profile "${profileName}".`);
      console.log('\nAdd one with:');
      console.log('  service-timesheetgenerate vacation add -e <employee-id> -s YYYY-MM-DD -n YYYY-MM-DD');
      return;
    }

    console.log(`Vacations in "${profileName}":\n`);
    for (const vacation of vacations) {
      console.log(`  [${vacation.id}] Employee: ${vacation.employeeId}`);
      console.log(`      ${vacation.startDate} to ${vacation.endDate} (${vacation.type})`);
      if (vacation.notes) {
        console.log(`      Notes: ${vacation.notes}`);
      }
    }
  });

vacationCommand
  .command('add')
  .description('Add a new vacation')
  .requiredOption('-e, --employee <id>', 'Employee ID')
  .requiredOption('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('-n, --end <date>', 'End date (YYYY-MM-DD)')
  .option('-t, --type <type>', 'Vacation type (vacation, sick_leave, personal_leave, maternity_leave, paternity_leave)', 'vacation')
  .option('--notes <notes>', 'Notes')
  .action(async (options) => {
    const profileName = await resolveProfile((vacationCommand.parent as Command)?.opts().profile);

    // Validate date formats
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.start)) {
      console.error('Invalid start date format. Use YYYY-MM-DD.');
      process.exit(1);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.end)) {
      console.error('Invalid end date format. Use YYYY-MM-DD.');
      process.exit(1);
    }

    // Verify employee exists
    const employee = await getEmployee(profileName, options.employee);
    if (!employee) {
      console.error(`Employee "${options.employee}" not found.`);
      process.exit(1);
    }

    const vacation = await addVacation(profileName, {
      employeeId: options.employee,
      startDate: options.start,
      endDate: options.end,
      type: options.type as VacationType,
      notes: options.notes,
    });

    console.log(`Vacation added for ${employee.name}: ${vacation.startDate} to ${vacation.endDate}`);
  });

vacationCommand
  .command('remove <id>')
  .description('Remove a vacation')
  .action(async (id) => {
    const profileName = await resolveProfile((vacationCommand.parent as Command)?.opts().profile);

    const removed = await removeVacation(profileName, id);
    if (!removed) {
      console.error(`Vacation "${id}" not found.`);
      process.exit(1);
    }

    console.log(`Vacation "${id}" removed.`);
  });
