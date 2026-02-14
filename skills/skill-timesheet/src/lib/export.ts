import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getExportsDir } from './paths';
import { generateTimesheetData } from './timesheet';
import type { TimesheetData, ExportRecord } from '../types';
import { readArray, appendToArray, generateId } from './storage';

function generateFilename(profileName: string, startDate: string, endDate: string, format: string): string {
  const sanitizedName = profileName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const startStr = startDate.replace(/-/g, '');
  const endStr = endDate.replace(/-/g, '');
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];

  return `${sanitizedName}_${startStr}_${endStr}_${timestamp}.${format}`;
}

export function timesheetToCSV(data: TimesheetData): string {
  const dates = Object.keys(data.rows[0]?.entries || {}).sort();

  // Build header row
  const headers = ['Employee', 'Status', 'Daily Hours', 'Total Hours', ...dates];

  // Build data rows
  const rows = data.rows.map((row) => {
    const values = [
      `"${row.employee}"`,
      row.employeeStatus,
      row.dailyHours.toString(),
      row.totalHours.toString(),
      ...dates.map((date) => {
        const entry = row.entries[date];
        return typeof entry === 'number' ? entry.toString() : `"${entry}"`;
      }),
    ];
    return values.join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function timesheetToJSON(data: TimesheetData): string {
  return JSON.stringify(
    {
      profile: data.profile,
      startDate: data.startDate,
      endDate: data.endDate,
      generatedAt: data.generatedAt,
      employees: data.rows.map((row) => ({
        name: row.employee,
        status: row.employeeStatus,
        dailyHours: row.dailyHours,
        totalHours: row.totalHours,
        entries: row.entries,
      })),
    },
    null,
    2
  );
}

function getExportsIndexPath(profileName: string): string {
  return join(getExportsDir(profileName), 'exports.json');
}

export async function exportTimesheet(
  profileName: string,
  startDate: Date,
  endDate: Date,
  format: 'csv' | 'json' = 'csv'
): Promise<ExportRecord> {
  // Generate timesheet data
  const timesheetData = await generateTimesheetData({
    profileName,
    startDate,
    endDate,
  });

  // Convert to desired format
  const content = format === 'csv' ? timesheetToCSV(timesheetData) : timesheetToJSON(timesheetData);

  // Ensure exports directory exists
  const exportsDir = getExportsDir(profileName);
  if (!existsSync(exportsDir)) {
    await mkdir(exportsDir, { recursive: true });
  }

  // Generate filename and save
  const filename = generateFilename(profileName, timesheetData.startDate, timesheetData.endDate, format);
  const filePath = join(exportsDir, filename);
  await writeFile(filePath, content, 'utf-8');

  // Record export
  const exportRecord: ExportRecord = {
    id: generateId('exp'),
    startDate: timesheetData.startDate,
    endDate: timesheetData.endDate,
    format,
    filePath,
    createdAt: new Date().toISOString(),
  };

  await appendToArray(getExportsIndexPath(profileName), exportRecord);

  return exportRecord;
}

export async function exportMonthlyTimesheet(
  profileName: string,
  year: number,
  month: number,
  format: 'csv' | 'json' = 'csv'
): Promise<ExportRecord> {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0)); // Last day of month

  return exportTimesheet(profileName, startDate, endDate, format);
}

export async function listExports(profileName: string): Promise<ExportRecord[]> {
  const exports = await readArray<ExportRecord>(getExportsIndexPath(profileName));
  return exports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
