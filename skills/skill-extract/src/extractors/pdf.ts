import { OpenAIProvider } from '../providers/openai';
import type { ExtractOptions, ExtractionResult, PDFMetadata } from '../types';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname } from 'path';

// Dynamic import for pdf-parse to handle ESM
async function getPdfParse() {
  const pdfParse = await import('pdf-parse');
  return pdfParse.default;
}

export function isPDFFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === '.pdf';
}

export async function extractFromPDF(options: ExtractOptions): Promise<ExtractionResult> {
  const { input, prompt, model, format = 'text' } = options;

  // Validate file exists
  if (!existsSync(input)) {
    throw new Error(`PDF file not found: ${input}`);
  }

  // Validate file extension
  if (!isPDFFile(input)) {
    throw new Error('File must be a PDF (.pdf)');
  }

  console.log(`Reading PDF: ${input}`);

  // Read PDF file
  const pdfBuffer = await readFile(input);

  // Parse PDF
  const pdfParse = await getPdfParse();
  const pdfData = await pdfParse(pdfBuffer);

  const metadata: PDFMetadata = {
    pages: pdfData.numpages,
    info: pdfData.info,
  };

  console.log(`Pages: ${metadata.pages}`);

  // If the extracted text is reasonable, use it
  const rawText = pdfData.text?.trim() || '';

  if (!rawText) {
    throw new Error('Could not extract text from PDF. The PDF might be image-based or encrypted.');
  }

  console.log(`Extracted ${rawText.length} characters from PDF`);

  // Use OpenAI to clean up and structure the text if requested
  let finalText = rawText;

  if (format === 'markdown' || format === 'json' || prompt) {
    console.log('Processing with OpenAI for structured output...');

    const provider = new OpenAIProvider();
    finalText = await provider.extractFromPDFText(rawText, {
      prompt,
      model,
      format,
      pages: metadata.pages,
    });
  }

  return {
    text: finalText,
    format,
    inputType: 'pdf',
    inputFile: input,
    metadata: {
      pages: metadata.pages,
      model: format !== 'text' || prompt ? model || 'gpt-4o' : undefined,
    },
  };
}

export async function getPDFMetadata(filePath: string): Promise<PDFMetadata> {
  if (!existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const pdfBuffer = await readFile(filePath);
  const pdfParse = await getPdfParse();
  const pdfData = await pdfParse(pdfBuffer);

  return {
    pages: pdfData.numpages,
    info: pdfData.info,
  };
}
