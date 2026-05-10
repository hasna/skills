import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';

// Read JSON file, return default value if file doesn't exist
export async function readJson<T>(path: string, defaultValue: T): Promise<T> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultValue;
    }
    throw error;
  }
}

// Write JSON file, creating directories if needed
export async function writeJson<T>(path: string, data: T): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

// Read array from JSON file
export async function readArray<T>(path: string): Promise<T[]> {
  return readJson<T[]>(path, []);
}

// Append item to array in JSON file, returns the item
export async function appendToArray<T extends { id: string }>(path: string, item: T): Promise<T> {
  const array = await readArray<T>(path);
  array.push(item);
  await writeJson(path, array);
  return item;
}

// Update item in array by ID
export async function updateInArray<T extends { id: string }>(
  path: string,
  id: string,
  updates: Partial<T>
): Promise<T | null> {
  const array = await readArray<T>(path);
  const index = array.findIndex((item) => item.id === id);

  if (index === -1) {
    return null;
  }

  array[index] = { ...array[index], ...updates, updatedAt: new Date().toISOString() };
  await writeJson(path, array);
  return array[index];
}

// Remove item from array by ID
export async function removeFromArray<T extends { id: string }>(path: string, id: string): Promise<boolean> {
  const array = await readArray<T>(path);
  const index = array.findIndex((item) => item.id === id);

  if (index === -1) {
    return false;
  }

  array.splice(index, 1);
  await writeJson(path, array);
  return true;
}

// Find item in array by ID
export async function findById<T extends { id: string }>(path: string, id: string): Promise<T | null> {
  const array = await readArray<T>(path);
  return array.find((item) => item.id === id) || null;
}

// Find all items matching a predicate
export async function findAll<T>(path: string, predicate?: (item: T) => boolean): Promise<T[]> {
  const array = await readArray<T>(path);
  if (!predicate) return array;
  return array.filter(predicate);
}

// Generate a short unique ID
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}${random}`;
}

// Get current timestamp in ISO format
export function timestamp(): string {
  return new Date().toISOString();
}
