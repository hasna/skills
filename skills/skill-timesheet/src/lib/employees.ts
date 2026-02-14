import { getEmployeesPath } from './paths';
import { readArray, appendToArray, updateInArray, removeFromArray, findById, generateId } from './storage';
import type { Employee, EmployeeStatus } from '../types';

// List all employees for a profile
export async function listEmployees(profileName: string): Promise<Employee[]> {
  return readArray<Employee>(getEmployeesPath(profileName));
}

// Get employee by ID
export async function getEmployee(profileName: string, employeeId: string): Promise<Employee | null> {
  return findById<Employee>(getEmployeesPath(profileName), employeeId);
}

// Add a new employee
export async function addEmployee(
  profileName: string,
  data: {
    name: string;
    email?: string;
    status?: EmployeeStatus;
    dailyHours?: number;
  }
): Promise<Employee> {
  const employee: Employee = {
    id: generateId('emp'),
    name: data.name,
    email: data.email,
    status: data.status || 'active',
    dailyHours: data.dailyHours ?? 8,
    createdAt: new Date().toISOString(),
  };

  return appendToArray(getEmployeesPath(profileName), employee);
}

// Update an employee
export async function updateEmployee(
  profileName: string,
  employeeId: string,
  data: Partial<Omit<Employee, 'id' | 'createdAt'>>
): Promise<Employee | null> {
  return updateInArray<Employee>(getEmployeesPath(profileName), employeeId, data);
}

// Remove an employee
export async function removeEmployee(profileName: string, employeeId: string): Promise<boolean> {
  return removeFromArray<Employee>(getEmployeesPath(profileName), employeeId);
}

// Find employee by name (case-insensitive partial match)
export async function findEmployeeByName(profileName: string, name: string): Promise<Employee | null> {
  const employees = await listEmployees(profileName);
  const lowerName = name.toLowerCase();
  return employees.find((e) => e.name.toLowerCase().includes(lowerName)) || null;
}
