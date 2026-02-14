/**
 * Shared utility functions
 */

export function normalizeSkillName(name: string): string {
  return name.startsWith("skill-") ? name : `skill-${name}`;
}
