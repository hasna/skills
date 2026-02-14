import { Command } from 'commander';
import { generateTimesheetData } from '../lib/timesheet';
import { exportTimesheet, exportMonthlyTimesheet, timesheetToCSV, timesheetToJSON } from '../lib/export';
import { resolveProfile } from '../lib/profiles';

export const generateCommand = new Command('generate')
  .description('Generate and export timesheet')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('-m, --month <month>', 'Month (YYYY-MM)')
  .option('-f, --format <format>', 'Output format (csv|json)', 'csv')
  .action(async (options) => {
    const profileName = await resolveProfile((generateCommand.parent as Command)?.opts().profile);

    let exportRecord;

    if (options.month) {
      // Parse YYYY-MM format
      const match = options.month.match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        console.error('Invalid month format. Use YYYY-MM.');
        process.exit(1);
      }
      const year = parseInt(match[1]);
      const month = parseInt(match[2]);

      exportRecord = await exportMonthlyTimesheet(profileName, year, month, options.format);
    } else if (options.start && options.end) {
      // Validate date formats
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.start)) {
        console.error('Invalid start date format. Use YYYY-MM-DD.');
        process.exit(1);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.end)) {
        console.error('Invalid end date format. Use YYYY-MM-DD.');
        process.exit(1);
      }

      const startDate = new Date(options.start + 'T00:00:00Z');
      const endDate = new Date(options.end + 'T00:00:00Z');

      exportRecord = await exportTimesheet(profileName, startDate, endDate, options.format);
    } else {
      console.error('Specify either --month YYYY-MM or both --start and --end dates.');
      process.exit(1);
    }

    console.log(`Timesheet generated: ${exportRecord.filePath}`);
    console.log(`  Period: ${exportRecord.startDate} to ${exportRecord.endDate}`);
    console.log(`  Format: ${exportRecord.format}`);
  });

export const previewCommand = new Command('preview')
  .description('Preview timesheet without saving')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('-m, --month <month>', 'Month (YYYY-MM)')
  .option('-f, --format <format>', 'Output format (csv|json)', 'csv')
  .action(async (options) => {
    const profileName = await resolveProfile((previewCommand.parent as Command)?.opts().profile);

    let startDate: Date;
    let endDate: Date;

    if (options.month) {
      const match = options.month.match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        console.error('Invalid month format. Use YYYY-MM.');
        process.exit(1);
      }
      const year = parseInt(match[1]);
      const month = parseInt(match[2]);
      startDate = new Date(Date.UTC(year, month - 1, 1));
      endDate = new Date(Date.UTC(year, month, 0));
    } else if (options.start && options.end) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.start)) {
        console.error('Invalid start date format. Use YYYY-MM-DD.');
        process.exit(1);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.end)) {
        console.error('Invalid end date format. Use YYYY-MM-DD.');
        process.exit(1);
      }
      startDate = new Date(options.start + 'T00:00:00Z');
      endDate = new Date(options.end + 'T00:00:00Z');
    } else {
      console.error('Specify either --month YYYY-MM or both --start and --end dates.');
      process.exit(1);
    }

    const data = await generateTimesheetData({
      profileName,
      startDate,
      endDate,
    });

    if (options.format === 'csv') {
      console.log(timesheetToCSV(data));
    } else {
      console.log(timesheetToJSON(data));
    }
  });
