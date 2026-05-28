import type { EmojiPrompt, OpenAIChatResponse, GeminiChatResponse } from './types';

const EMOJI_SYSTEM_PROMPT = `Generate emoji image prompts. Each emoji should be:
- Square format, single centered subject
- Simple, clean design suitable for small sizes
- No text, no words, no letters
- Solid or transparent background
- Vibrant colors, clear silhouette

Return a JSON array with objects containing:
- "name": short filename (lowercase, no spaces, use hyphens)
- "description": what the emoji represents
- "prompt": detailed image generation prompt

Example output:
[
  {"name": "santa-hat", "description": "Red Santa hat with white trim", "prompt": "A red Santa Claus hat with white fluffy trim, centered on solid background, emoji style, simple clean design, vibrant colors"},
  {"name": "gift-box", "description": "Wrapped present with bow", "prompt": "A wrapped gift box with red ribbon bow, centered on solid background, emoji style, simple clean design, festive colors"}
]

Only output valid JSON array, no other text.`;

export class PromptGenerator {
  private provider: 'openai' | 'gemini';
  private apiKey: string;
  private style: string;

  constructor(provider: 'openai' | 'gemini', style: string = 'flat') {
    this.provider = provider;
    this.style = style;

    if (provider === 'openai') {
      this.apiKey = process.env.OPENAI_API_KEY || '';
      if (!this.apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
      }
    } else {
      this.apiKey = process.env.GEMINI_API_KEY || '';
      if (!this.apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required');
      }
    }
  }

  async generate(theme: string, count: number): Promise<EmojiPrompt[]> {
    const styleDescription = this.getStyleDescription();
    const userPrompt = `Create ${count} unique emoji prompts for the theme: "${theme}"

Style requirements: ${styleDescription}

Generate exactly ${count} emojis. Make them diverse and cover different aspects of the theme.`;

    console.log(`Generating ${count} emoji prompts for theme: "${theme}"...`);

    if (this.provider === 'openai') {
      return this.generateWithOpenAI(userPrompt);
    } else {
      return this.generateWithGemini(userPrompt);
    }
  }

  private getStyleDescription(): string {
    switch (this.style) {
      case 'flat':
        return 'Flat design, solid colors, no shadows, minimal detail';
      case '3d':
        return 'Soft 3D style, subtle shadows and highlights, rounded shapes';
      case 'outline':
        return 'Line art style, clean outlines, minimal fill colors';
      case 'gradient':
        return 'Gradient colors, smooth transitions, modern look';
      default:
        return 'Clean emoji style';
    }
  }

  private async generateWithOpenAI(userPrompt: string): Promise<EmojiPrompt[]> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: EMOJI_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    return this.parsePrompts(content);
  }

  private async generateWithGemini(userPrompt: string): Promise<EmojiPrompt[]> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: EMOJI_SYSTEM_PROMPT + '\n\n' + userPrompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.8,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as GeminiChatResponse;
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error('No content in Gemini response');
    }

    return this.parsePrompts(content);
  }

  private parsePrompts(content: string): EmojiPrompt[] {
    try {
      // Try to parse the content directly
      let parsed = JSON.parse(content);

      // Handle if the response is wrapped in an object
      if (parsed.emojis && Array.isArray(parsed.emojis)) {
        parsed = parsed.emojis;
      }

      if (!Array.isArray(parsed)) {
        throw new Error('Expected array of prompts');
      }

      // Validate and clean up each prompt
      return parsed.map((item: unknown, index: number) => {
        const obj = item as Record<string, unknown>;
        return {
          name: String(obj.name || `emoji-${index + 1}`).toLowerCase().replace(/\s+/g, '-'),
          description: String(obj.description || ''),
          prompt: String(obj.prompt || ''),
        };
      });
    } catch (error) {
      // Try to extract JSON from the content
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return this.parsePrompts(jsonMatch[0]);
      }
      throw new Error(`Failed to parse prompts: ${error}`);
    }
  }
}
