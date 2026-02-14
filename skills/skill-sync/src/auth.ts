/**
 * Skill Authentication Check
 * Add this to the top of any skill's main function
 */

export function checkSkillAuth(): void {
  const SKILL_API_KEY = process.env.SKILL_API_KEY;
  
  // Check if SKILL_API_KEY is set
  if (!SKILL_API_KEY) {
    console.error('❌ Error: SKILL_API_KEY environment variable not set');
    console.error('');
    console.error('To use this skill, you must set your SKILL_API_KEY:');
    console.error('');
    console.error('  export SKILL_API_KEY=your-api-key-here');
    console.error('');
    console.error('Contact your administrator to get your API key.');
    process.exit(1);
  }

  // Validate key format
  if (!SKILL_API_KEY.startsWith('sk-skill-')) {
    console.error('❌ Error: Invalid SKILL_API_KEY format');
    console.error('Expected format: sk-skill-xxxxxxxxxxxx');
    process.exit(1);
  }

  // Key is valid - skill can proceed
}

/**
 * Check if running remotely (via SSH or network)
 */
export function isRemoteExecution(): boolean {
  return !!(
    process.env.SSH_CONNECTION ||
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY
  );
}

/**
 * Require auth only if remote execution
 */
export function requireAuthIfRemote(): void {
  if (isRemoteExecution()) {
    checkSkillAuth();
  }
}
