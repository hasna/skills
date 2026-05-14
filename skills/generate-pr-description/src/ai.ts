import type { CommitInfo, GitDiffResult, Options, PRDescription } from "./types";

export async function analyzeWithAI(
  diff: string,
  commits: CommitInfo[],
  files: GitDiffResult['files'],
  options: Options
): Promise<PRDescription> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    if (options.verbose) {
      console.log('⚠️  ANTHROPIC_API_KEY not set, using basic template');
    }
    return generateBasicDescription(diff, commits, files);
  }

  try {
    const prompt = buildAnalysisPrompt(diff, commits, files);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    return parseAIResponse(content, files);
  } catch (error) {
    if (options.verbose) {
      console.error('AI analysis failed:', error);
      console.log('Falling back to basic template');
    }
    return generateBasicDescription(diff, commits, files);
  }
}

function buildAnalysisPrompt(
  diff: string,
  commits: CommitInfo[],
  files: GitDiffResult['files']
): string {
  // Truncate diff if too large
  const maxDiffLength = 50000;
  const truncatedDiff = diff.length > maxDiffLength
    ? diff.substring(0, maxDiffLength) + '\n\n[... diff truncated ...]'
    : diff;

  const commitMessages = commits.map(c => `- ${c.message} (${c.hash})`).join('\n');

  return `Analyze the following git changes and generate a comprehensive pull request description.

FILES CHANGED:
Added: ${files.added.join(', ') || 'none'}
Modified: ${files.modified.join(', ') || 'none'}
Deleted: ${files.deleted.join(', ') || 'none'}

COMMIT HISTORY:
${commitMessages || 'No commits'}

GIT DIFF:
${truncatedDiff}

Please provide a PR description in the following JSON format:
{
  "summary": "Brief 1-2 sentence overview of what this PR does",
  "changes": ["List of key changes made (3-7 items)"],
  "whyChanged": "Detailed explanation of why these changes were needed and the approach taken",
  "breakingChanges": ["List any breaking changes, or empty array if none"],
  "testPlan": ["Suggested testing steps"],
  "additionalNotes": ["Any other relevant notes"]
}

Focus on:
1. What problem is being solved
2. Key technical changes
3. Any breaking changes or migration notes
4. Testing recommendations

Return only the JSON, no additional text.`;
}

function parseAIResponse(content: string, files: GitDiffResult['files']): PRDescription {
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/\`\`\`(?:json)?\s*(\{[\s\S]*\})\s*\`\`\`/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    const parsed = JSON.parse(jsonStr);

    return {
      summary: parsed.summary || 'Changes made to the codebase',
      changes: parsed.changes || [],
      whatChanged: files,
      whyChanged: parsed.whyChanged || 'No detailed explanation provided',
      breakingChanges: parsed.breakingChanges || [],
      testPlan: parsed.testPlan || [],
      additionalNotes: parsed.additionalNotes || [],
    };
  } catch (error) {
    throw new Error(`Failed to parse AI response: ${error}`);
  }
}

export function generateBasicDescription(
  diff: string,
  commits: CommitInfo[],
  files: GitDiffResult['files']
): PRDescription {
  const summary = commits.length > 0
    ? commits[0].message
    : 'Changes to the codebase';

  const changes = commits.map(c => c.message);

  return {
    summary,
    changes: changes.length > 0 ? changes : ['Various code changes'],
    whatChanged: files,
    whyChanged: 'Please add context about why these changes were made.',
    breakingChanges: [],
    testPlan: ['Run existing test suite', 'Manual testing as needed'],
    additionalNotes: [],
  };
}
