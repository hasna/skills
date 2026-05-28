import { Command } from 'commander';
import { listEmployees, addEmployee, updateEmployee, removeEmployee } from '../lib/employees';
import { resolveProfile } from '../lib/profiles';
import type { EmployeeStatus } from '../types';

export const employeeCommand = new Command('employee')
  .description('Manage employees');

employeeCommand
  .command('list')
  .description('List all employees')
  .action(async () => {
    const profileName = await resolveProfile((employeeCommand.parent as Command)?.opts().profile);
    const employees = await listEmployees(profileName);

    if (employees.length === 0) {
      console.log(`No employees in profile "${profileName}".`);
      console.log('\nAdd one with:');
      console.log('  service-timesheetgenerate employee add -n "Name"');
      return;
    }

    console.log(`Employees in "${profileName}":\n`);
    for (const emp of employees) {
      console.log(`  [${emp.id}] ${emp.name}`);
      console.log(`      Status: ${emp.status}, Daily hours: ${emp.dailyHours}`);
      if (emp.email) {
        console.log(`      Email: ${emp.email}`);
      }
    }
  });

employeeCommand
  .command('add')
  .description('Add a new employee')
  .requiredOption('-n, --name <name>', 'Employee name')
  .option('-e, --email <email>', 'Email address')
  .option('-h, --hours <hours>', 'Daily hours', '8')
  .option('-s, --status <status>', 'Status (active, inactive, on_leave_maternity, etc.)', 'active')
  .action(async (options) => {
    const profileName = await resolveProfile((employeeCommand.parent as Command)?.opts().profile);

    const employee = await addEmployee(profileName, {
      name: options.name,
      email: options.email,
      dailyHours: parseFloat(options.hours),
      status: options.status as EmployeeStatus,
    });

    console.log(`Employee added: ${employee.name} (ID: ${employee.id})`);
  });

employeeCommand
  .command('update <id>')
  .description('Update an employee')
  .option('-n, --name <name>', 'New name')
  .option('-e, --email <email>', 'New email')
  .option('-h, --hours <hours>', 'New daily hours')
  .option('-s, --status <status>', 'New status')
  .action(async (id, options) => {
    const profileName = await resolveProfile((employeeCommand.parent as Command)?.opts().profile);

    const data: any = {};
    if (options.name) data.name = options.name;
    if (options.email) data.email = options.email;
    if (options.hours) data.dailyHours = parseFloat(options.hours);
    if (options.status) data.status = options.status;

    if (Object.keys(data).length === 0) {
      console.error('No updates specified. Use --name, --email, --hours, or --status.');
      process.exit(1);
    }

    const employee = await updateEmployee(profileName, id, data);
    if (!employee) {
      console.error(`Employee "${id}" not found.`);
      process.exit(1);
    }

    console.log(`Employee updated: ${employee.name}`);
  });

employeeCommand
  .command('remove <id>')
  .description('Remove an employee')
  .action(async (id) => {
    const profileName = await resolveProfile((employeeCommand.parent as Command)?.opts().profile);

    const removed = await removeEmployee(profileName, id);
    if (!removed) {
      console.error(`Employee "${id}" not found.`);
      process.exit(1);
    }

    console.log(`Employee "${id}" removed.`);
  });
