import type { ExtractOptions, ExtractionResult, OpenAIVisionResponse, OutputFormat } from '../types';
import { readFile } from 'fs/promises';
import { extname } from 'path';

export class OpenAIProvider {
  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
  }

  async extractFromImage(
    imagePath: string,
    options?: {
      prompt?: string;
      model?: string;
      format?: OutputFormat;
      detail?: 'low' | 'high' | 'auto';
    }
  ): Promise<ExtractionResult> {
    const model = options?.model || 'gpt-4o';
    const format = options?.format || 'text';
    const detail = options?.detail || 'auto';

    console.log(`Extracting from image with OpenAI ${model}...`);
    console.log(`Image: ${imagePath}`);
    console.log(`Detail: ${detail}`);

    // Read and encode the image
    const imageBuffer = await readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = this.getMimeType(imagePath);

    // Build the prompt based on format
    const systemPrompt = this.buildSystemPrompt(format, options?.prompt);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail,
                },
              },
              {
                type: 'text',
                text: options?.prompt || 'Extract all text and content from this image.',
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data: OpenAIVisionResponse = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenAI API');
    }

    const extractedText = data.choices[0].message.content;
    console.log('Extraction complete!');

    return {
      text: extractedText,
      format,
      inputType: 'image',
      inputFile: imagePath,
      metadata: {
        model,
        tokens: data.usage?.total_tokens,
      },
    };
  }

  async extractFromPDFText(
    pdfText: string,
    options?: {
      prompt?: string;
      model?: string;
      format?: OutputFormat;
      pages?: number;
    }
  ): Promise<string> {
    const model = options?.model || 'gpt-4o';
    const format = options?.format || 'text';

    console.log(`Processing PDF text with OpenAI ${model}...`);

    const systemPrompt = this.buildSystemPrompt(format, options?.prompt);

    const userPrompt = options?.prompt
      ? `${options.prompt}\n\nDocument content:\n${pdfText}`
      : `Clean up and structure the following extracted PDF text. Fix any OCR errors, formatting issues, and organize the content clearly.\n\nDocument content:\n${pdfText}`;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data: OpenAIVisionResponse = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenAI API');
    }

    return data.choices[0].message.content;
  }

  private buildSystemPrompt(format: OutputFormat, customPrompt?: string): string {
    const basePrompt = customPrompt
      ? `You are a document extraction assistant. Follow the user's specific instructions.`
      : `You are a document extraction assistant. Extract all text, data, and content from the provided document or image accurately.`;

    switch (format) {
      case 'markdown':
        return `${basePrompt}

Output the extracted content in clean, well-structured Markdown format:
- Use proper headings (# ## ###) for sections
- Use lists (- or 1.) for enumerated items
- Use tables for tabular data
- Use code blocks for code or formatted text
- Preserve the logical structure of the document`;

      case 'json':
        return `${basePrompt}

Output the extracted content as a valid JSON object with the following structure:
{
  "title": "document title if found",
  "sections": [
    {
      "heading": "section heading",
      "content": "section content"
    }
  ],
  "tables": [
    {
      "caption": "table caption if any",
      "headers": ["col1", "col2"],
      "rows": [["data1", "data2"]]
    }
  ],
  "metadata": {
    "any": "relevant metadata"
  }
}`;

      case 'text':
      default:
        return `${basePrompt}

Output the extracted content as clean, readable plain text:
- Preserve paragraphs and logical structure
- Use blank lines to separate sections
- Maintain the reading order of the document`;
    }
  }

  private getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
    };
    return mimeTypes[ext] || 'image/png';
  }
}
