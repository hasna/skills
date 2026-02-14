import { Command } from 'commander';
import { listHolidays, getHolidaysForYear, addHoliday, removeHoliday } from '../lib/holidays';
import { resolveProfile } from '../lib/profiles';

export const holidayCommand = new Command('holiday')
  .description('Manage holidays');

holidayCommand
  .command('list')
  .description('List all holidays')
  .option('-y, --year <year>', 'Filter by year')
  .action(async (options) => {
    const profileName = await resolveProfile((holidayCommand.parent as Command)?.opts().profile);

    let holidays;
    if (options.year) {
      holidays = await getHolidaysForYear(profileName, parseInt(options.year));
    } else {
      holidays = await listHolidays(profileName);
    }

    if (holidays.length === 0) {
      console.log(`No holidays in profile "${profileName}".`);
      console.log('\nAdd one with:');
      console.log('  service-timesheetgenerate holiday add -n "Holiday Name" -d YYYY-MM-DD');
      return;
    }

    console.log(`Holidays in "${profileName}":\n`);
    for (const holiday of holidays) {
      const recurring = holiday.recurring ? ' (recurring)' : '';
      console.log(`  [${holiday.id}] ${holiday.name} - ${holiday.date}${recurring}`);
    }
  });

holidayCommand
  .command('add')
  .description('Add a new holiday')
  .requiredOption('-n, --name <name>', 'Holiday name')
  .requiredOption('-d, --date <date>', 'Date (YYYY-MM-DD)')
  .option('-r, --recurring', 'Is recurring yearly')
  .action(async (options) => {
    const profileName = await resolveProfile((holidayCommand.parent as Command)?.opts().profile);

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
      console.error('Invalid date format. Use YYYY-MM-DD.');
      process.exit(1);
    }

    const holiday = await addHoliday(profileName, {
      name: options.name,
      date: options.date,
      recurring: options.recurring || false,
    });

    const recurring = holiday.recurring ? ' (recurring)' : '';
    console.log(`Holiday added: ${holiday.name} on ${holiday.date}${recurring}`);
  });

holidayCommand
  .command('remove <id>')
  .description('Remove a holiday')
  .action(async (id) => {
    const profileName = await resolveProfile((holidayCommand.parent as Command)?.opts().profile);

    const removed = await removeHoliday(profileName, id);
    if (!removed) {
      console.error(`Holiday "${id}" not found.`);
      process.exit(1);
    }

    console.log(`Holiday "${id}" removed.`);
  });
