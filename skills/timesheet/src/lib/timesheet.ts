import { getProfile } from './profiles';
import { listEmployees } from './employees';
import { getHolidaysInRange, isHoliday } from './holidays';
import { getVacationsInRange, isOnVacation } from './vacations';
import type {
  TimesheetRow,
  TimesheetData,
  GenerateOptions,
} from '../types';

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function getDayOfWeek(date: Date): number {
  return date.getUTCDay();
}

function getDatesBetween(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  let current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current = addDays(current, 1);
  }
  return dates;
}

function isWeekend(date: Date, weekendDays: number[]): boolean {
  return weekendDays.includes(getDayOfWeek(date));
}

export async function generateTimesheetData(options: GenerateOptions): Promise<TimesheetData> {
  const profile = await getProfile(options.profileName);
  if (!profile) {
    throw new Error(`Profile "${options.profileName}" not found`);
  }

  const startDateStr = formatDate(options.startDate);
  const endDateStr = formatDate(options.endDate);

  // Get all employees
  let employees = await listEmployees(options.profileName);

  // Filter by specific employee IDs if provided
  if (options.employeeIds?.length) {
    employees = employees.filter((e) => options.employeeIds!.includes(e.id));
  }

  // Get holidays in range
  const holidays = await getHolidaysInRange(options.profileName, startDateStr, endDateStr);

  // Get all dates in range
  const dates = getDatesBetween(options.startDate, options.endDate);

  const rows: TimesheetRow[] = [];

  for (const employee of employees) {
    // Get vacations for this employee in range
    const vacations = await getVacationsInRange(options.profileName, startDateStr, endDateStr, employee.id);

    const row: TimesheetRow = {
      employee: employee.name,
      employeeStatus: employee.status,
      dailyHours: employee.dailyHours,
      totalHours: 0,
      entries: {},
    };

    for (const date of dates) {
      const dateStr = formatDate(date);
      let hours = 0;
      let entryValue: string | number;

      // Check if weekend
      if (isWeekend(date, profile.weekendDays)) {
        entryValue = 'weekend';
      }
      // Check if holiday
      else if (isHoliday(dateStr, holidays)) {
        const holiday = isHoliday(dateStr, holidays)!;
        entryValue = `holiday: ${holiday.name}`;
      }
      // Check if on vacation
      else if (isOnVacation(dateStr, vacations, employee.id)) {
        const vacation = isOnVacation(dateStr, vacations, employee.id)!;
        entryValue = vacation.type;
      }
      // Check employee status (maternity, etc.)
      else if (employee.status !== 'active') {
        entryValue = employee.status;
      }
      // Regular work day
      else {
        hours = employee.dailyHours;
        entryValue = hours;
        row.totalHours += hours;
      }

      row.entries[dateStr] = entryValue;
    }

    rows.push(row);
  }

  return {
    profile: profile.name,
    startDate: startDateStr,
    endDate: endDateStr,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateMonthlyTimesheet(profileName: string, year: number, month: number): Promise<TimesheetData> {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0)); // Last day of month

  return generateTimesheetData({
    profileName,
    startDate,
    endDate,
  });
}
