/**
 * Skill HTTP Client
 *
 * Generic HTTP client for calling the remote skill API server
 * Usage: import and call executeSkill() from your skill CLI
 */

const SKILL_API_URL = process.env.SKILL_API_URL || "http://44.195.55.5:3000";

export interface SkillRequest {
  skill: string;
  command?: string;
  provider?: string;
  prompt?: string;
  text?: string;
  output?: string;
  [key: string]: unknown;
}

export interface SkillResponse {
  success: boolean;
  output?: string;
  error?: string;
  details?: string;
}

/**
 * Execute a skill on the remote server
 */
export async function executeSkill(request: SkillRequest): Promise<SkillResponse | Blob> {
  const { skill, ...params } = request;

  const url = `${SKILL_API_URL}/${skill}/`;

  // Get API key from environment
  const apiKey = process.env.SKILL_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "Missing SKILL_API_KEY",
      details: "Set SKILL_API_KEY environment variable"
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `skill-${skill}-cli/1.0`,
        "X-API-Key": apiKey
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error || `HTTP ${response.status}`,
        details: error.details || error.message
      };
    }

    // Check if response is a file (binary)
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("image/") ||
        contentType.includes("audio/") ||
        contentType.includes("video/") ||
        contentType.includes("application/")) {
      return await response.blob();
    }

    // Otherwise JSON
    return await response.json();

  } catch (error) {
    return {
      success: false,
      error: "Network error",
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Save a blob to a file
 */
export async function saveBlob(blob: Blob, outputPath: string): Promise<void> {
  const buffer = await blob.arrayBuffer();
  await Bun.write(outputPath, buffer);
}

/**
 * Helper to execute a skill and save file if needed
 */
export async function executeAndSave(request: SkillRequest): Promise<boolean> {
  console.log(`🔗 Connecting to ${SKILL_API_URL}...`);

  const result = await executeSkill(request);

  if (result instanceof Blob) {
    // File response
    if (!request.output) {
      console.error("❌ Error: No output path specified");
      return false;
    }

    await saveBlob(result, request.output);
    console.log(`✅ Saved to: ${request.output}`);
    return true;
  }

  // JSON response
  if (!result.success) {
    console.error(`❌ Error: ${result.error}`);
    if (result.details) {
      console.error(`   ${result.details}`);
    }
    return false;
  }

  if (result.output) {
    console.log(result.output);
  }

  return true;
}
