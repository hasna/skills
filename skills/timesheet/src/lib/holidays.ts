import { getHolidaysPath } from './paths';
import { readArray, appendToArray, removeFromArray, generateId } from './storage';
import type { Holiday } from '../types';

// List all holidays for a profile
export async function listHolidays(profileName: string): Promise<Holiday[]> {
  return readArray<Holiday>(getHolidaysPath(profileName));
}

// Get holidays for a specific year (including recurring)
export async function getHolidaysForYear(profileName: string, year: number): Promise<Holiday[]> {
  const holidays = await listHolidays(profileName);
  return holidays.filter((h) => {
    const holidayYear = parseInt(h.date.split('-')[0]);
    return h.recurring || holidayYear === year;
  });
}

// Get holidays within a date range
export async function getHolidaysInRange(
  profileName: string,
  startDate: string,
  endDate: string
): Promise<Holiday[]> {
  const holidays = await listHolidays(profileName);
  const startYear = parseInt(startDate.split('-')[0]);
  const endYear = parseInt(endDate.split('-')[0]);

  const result: Holiday[] = [];

  for (const holiday of holidays) {
    if (holiday.recurring) {
      // For recurring holidays, check each year in range
      for (let year = startYear; year <= endYear; year++) {
        const monthDay = holiday.date.slice(5); // MM-DD
        const dateInYear = `${year}-${monthDay}`;
        if (dateInYear >= startDate && dateInYear <= endDate) {
          result.push({ ...holiday, date: dateInYear });
        }
      }
    } else {
      // Non-recurring: check if within range
      if (holiday.date >= startDate && holiday.date <= endDate) {
        result.push(holiday);
      }
    }
  }

  return result;
}

// Add a new holiday
export async function addHoliday(
  profileName: string,
  data: {
    name: string;
    date: string;
    recurring?: boolean;
  }
): Promise<Holiday> {
  const holiday: Holiday = {
    id: generateId('hol'),
    name: data.name,
    date: data.date,
    recurring: data.recurring ?? false,
  };

  return appendToArray(getHolidaysPath(profileName), holiday);
}

// Remove a holiday
export async function removeHoliday(profileName: string, holidayId: string): Promise<boolean> {
  return removeFromArray<Holiday>(getHolidaysPath(profileName), holidayId);
}

// Check if a date is a holiday
export function isHoliday(date: string, holidays: Holiday[]): Holiday | undefined {
  return holidays.find((h) => h.date === date);
}
