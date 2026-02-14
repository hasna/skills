import { getVacationsPath } from './paths';
import { readArray, appendToArray, removeFromArray, generateId } from './storage';
import type { Vacation, VacationType } from '../types';

// List all vacations for a profile
export async function listVacations(profileName: string): Promise<Vacation[]> {
  return readArray<Vacation>(getVacationsPath(profileName));
}

// Get vacations for a specific employee
export async function getVacationsForEmployee(profileName: string, employeeId: string): Promise<Vacation[]> {
  const vacations = await listVacations(profileName);
  return vacations.filter((v) => v.employeeId === employeeId);
}

// Get vacations within a date range
export async function getVacationsInRange(
  profileName: string,
  startDate: string,
  endDate: string,
  employeeId?: string
): Promise<Vacation[]> {
  const vacations = await listVacations(profileName);

  return vacations.filter((v) => {
    // Check if vacation overlaps with range
    const overlaps = v.startDate <= endDate && v.endDate >= startDate;
    if (!overlaps) return false;

    // Filter by employee if specified
    if (employeeId && v.employeeId !== employeeId) return false;

    return true;
  });
}

// Add a new vacation
export async function addVacation(
  profileName: string,
  data: {
    employeeId: string;
    startDate: string;
    endDate: string;
    type?: VacationType;
    notes?: string;
  }
): Promise<Vacation> {
  const vacation: Vacation = {
    id: generateId('vac'),
    employeeId: data.employeeId,
    startDate: data.startDate,
    endDate: data.endDate,
    type: data.type || 'vacation',
    notes: data.notes,
  };

  return appendToArray(getVacationsPath(profileName), vacation);
}

// Remove a vacation
export async function removeVacation(profileName: string, vacationId: string): Promise<boolean> {
  return removeFromArray<Vacation>(getVacationsPath(profileName), vacationId);
}

// Check if an employee is on vacation on a specific date
export function isOnVacation(date: string, vacations: Vacation[], employeeId: string): Vacation | undefined {
  return vacations.find((v) => {
    return v.employeeId === employeeId && date >= v.startDate && date <= v.endDate;
  });
}
