// Profile represents a company configuration
export interface Profile {
  name: string;
  country: string;
  timezone: string;
  weekendDays: number[]; // 0 = Sunday, 6 = Saturday
  createdAt: string;
}

// Global config stored at ~/.service/service-timesheetgenerate/config.json
export interface GlobalConfig {
  defaultProfile?: string;
  version: string;
}

export interface Employee {
  id: string;
  name: string;
  email?: string;
  status: EmployeeStatus;
  dailyHours: number;
  createdAt: string;
}

export type EmployeeStatus =
  | 'active'
  | 'inactive'
  | 'on_leave_maternity'
  | 'on_leave_paternity'
  | 'on_leave_sick'
  | 'terminated';

export interface Holiday {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  recurring: boolean;
}

export interface Vacation {
  id: string;
  employeeId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  type: VacationType;
  notes?: string;
}

export type VacationType =
  | 'vacation'
  | 'sick_leave'
  | 'personal_leave'
  | 'maternity_leave'
  | 'paternity_leave';

export type EntryType =
  | 'work'
  | 'holiday'
  | 'vacation'
  | 'weekend'
  | 'sick_leave'
  | 'maternity_leave'
  | 'paternity_leave'
  | 'personal_leave';

export interface TimesheetRow {
  employee: string;
  employeeStatus: string;
  dailyHours: number;
  totalHours: number;
  entries: Record<string, string | number>;
}

export interface TimesheetData {
  profile: string;
  startDate: string;
  endDate: string;
  rows: TimesheetRow[];
  generatedAt: string;
}

export interface GenerateOptions {
  profileName: string;
  startDate: Date;
  endDate: Date;
  employeeIds?: string[];
}

export interface ExportRecord {
  id: string;
  startDate: string;
  endDate: string;
  format: 'csv' | 'json';
  filePath: string;
  createdAt: string;
}
