import { TEMPLATES } from "./templates";
import type { Template } from "./types";

export async function detectTemplate(description: string, verbose: boolean): Promise<{ template: Template; features: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('❌ No API key found for AI detection.');
    console.error('Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or use --template to specify manually.');
    process.exit(1);
  }

  if (verbose) {
    console.log('🤖 Analyzing description with AI...');
  }

  const prompt = `Analyze this project description and select the BEST matching template from the list below.

Project Description: "${description}"

Available Templates:
${Object.entries(TEMPLATES).map(([key, val]) => `- ${key}: ${val.description}`).join('\n')}

Also suggest which of these features to include:
- database: prisma, drizzle, supabase, none
- auth: nextauth, clerk, lucia, supabase, none
- testing: vitest, playwright, both, none
- state: zustand, jotai, redux, none
- shadcn: true, false
- tailwind: true, false

Respond ONLY with valid JSON in this format:
{
  "template": "template-name",
  "features": {
    "database": "prisma or drizzle or supabase or none",
    "auth": "nextauth or clerk or lucia or supabase or none",
    "testing": "vitest or playwright or both or none",
    "state": "zustand or jotai or redux or none",
    "shadcn": true or false,
    "tailwind": true or false
  },
  "reasoning": "Brief explanation of why this template was chosen"
}`;

  try {
    let response: any;

    if (process.env.OPENAI_API_KEY) {
      // Use OpenAI
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that selects appropriate project templates.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API error: ${res.statusText}`);
      }

      const data = await res.json();
      response = JSON.parse(data.choices[0].message.content);
    } else {
      // Use Anthropic
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            { role: 'user', content: prompt }
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`Anthropic API error: ${res.statusText}`);
      }

      const data = await res.json();
      response = JSON.parse(data.content[0].text);
    }

    if (verbose) {
      console.log(`✅ Selected template: ${response.template}`);
      console.log(`💡 Reasoning: ${response.reasoning}`);
    }

    // Convert features object to array of strings
    const featuresArray: string[] = [];
    if (response.features.database && response.features.database !== 'none') {
      featuresArray.push(`database:${response.features.database}`);
    }
    if (response.features.auth && response.features.auth !== 'none') {
      featuresArray.push(`auth:${response.features.auth}`);
    }
    if (response.features.testing && response.features.testing !== 'none') {
      featuresArray.push(`testing:${response.features.testing}`);
    }
    if (response.features.state && response.features.state !== 'none') {
      featuresArray.push(`state:${response.features.state}`);
    }
    if (response.features.shadcn) {
      featuresArray.push('shadcn');
    }
    if (response.features.tailwind) {
      featuresArray.push('tailwind');
    }

    return {
      template: response.template,
      features: featuresArray,
    };
  } catch (error) {
    console.error('❌ AI detection failed:', error);
    console.error('Please specify --template manually.');
    process.exit(1);
  }
}

// ============================================================================
