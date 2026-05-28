import { log } from "./runtime";
import type { SymbolicOperation } from "./types";

// ============================================================================
// Symbolic Math Mode (Using AI)
// ============================================================================
export async function performSymbolicMath(
  expression: string,
  operation: SymbolicOperation,
  variable: string = "x",
  showSteps: boolean = false
): Promise<{ result: string; steps?: string[]; latex?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for symbolic math");
  }

  const prompt = buildSymbolicPrompt(expression, operation, variable, showSteps);

  log(`Performing symbolic ${operation} on: ${expression}`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a mathematics expert. Provide accurate symbolic mathematics solutions. Always show your work clearly and provide LaTeX formatting when requested.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  return parseSymbolicResponse(content, showSteps);
}

function buildSymbolicPrompt(expr: string, operation: SymbolicOperation, variable: string, showSteps: boolean): string {
  const basePrompts: Record<SymbolicOperation, string> = {
    derivative: `Calculate the derivative of the expression "${expr}" with respect to ${variable}.`,
    integral: `Calculate the indefinite integral of the expression "${expr}" with respect to ${variable}.`,
    simplify: `Simplify the expression "${expr}".`,
    factor: `Factor the expression "${expr}".`,
    expand: `Expand the expression "${expr}".`,
    solve: `Solve the equation "${expr}" for ${variable}.`,
  };

  let prompt = basePrompts[operation];

  if (showSteps) {
    prompt += "\n\nPlease show step-by-step solution with explanations.";
  }

  prompt += "\n\nFormat your response as follows:";
  prompt += "\nRESULT: [final answer]";

  if (showSteps) {
    prompt += "\nSTEPS:";
    prompt += "\n1. [step 1]";
    prompt += "\n2. [step 2]";
    prompt += "\n...";
  }

  prompt += "\nLATEX: [result in LaTeX format]";

  return prompt;
}

function parseSymbolicResponse(content: string, showSteps: boolean): { result: string; steps?: string[]; latex?: string } {
  const resultMatch = content.match(/RESULT:\s*(.+?)(?=\n|$)/i);
  const latexMatch = content.match(/LATEX:\s*(.+?)(?=\n|$)/i);

  const result: any = {
    result: resultMatch ? resultMatch[1].trim() : content,
  };

  if (showSteps) {
    const stepsMatch = content.match(/STEPS:([\s\S]+?)(?=LATEX:|$)/i);
    if (stepsMatch) {
      result.steps = stepsMatch[1]
        .split("\n")
        .map(s => s.trim())
        .filter(s => s && /^\d+\./.test(s));
    }
  }

  if (latexMatch) {
    result.latex = latexMatch[1].trim();
  }

  return result;
}
