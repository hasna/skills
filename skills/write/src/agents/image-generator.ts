/**
 * Image Generator Agent
 * Generates article images using various AI providers
 */

import type { ImageGenerationConfig } from '../types';

type ImageProvider = 'openai' | 'google' | 'xai';

interface OpenAIImageResponse {
  data: Array<{ url?: string; b64_json?: string }>;
}

interface GoogleImageResponse {
  predictions: Array<{ bytesBase64Encoded: string }>;
}

interface XAIImageResponse {
  data: Array<{ url?: string; b64_json?: string }>;
}

export async function generateArticleImage(
  title: string,
  topic: string,
  provider: ImageProvider = 'openai',
  outputPath: string
): Promise<string> {
  console.log(`  [ImageGen] Creating image for: ${title}`);
  console.log(`  [ImageGen] Using provider: ${provider}`);

  const prompt = `Create a professional, visually appealing header image for an article titled "${title}" about ${topic}. The image should be modern, clean, and suitable for a blog or publication. Style: professional illustration, vibrant colors, no text in image.`;

  const config: ImageGenerationConfig = {
    provider,
    prompt,
    outputPath
  };

  let imageBuffer: Buffer;

  switch (provider) {
    case 'openai':
      imageBuffer = await generateWithOpenAI(config);
      break;
    case 'google':
      imageBuffer = await generateWithGoogle(config);
      break;
    case 'xai':
      imageBuffer = await generateWithXAI(config);
      break;
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }

  await Bun.write(outputPath, imageBuffer);
  console.log(`  [ImageGen] Image saved to: ${outputPath}`);

  return outputPath;
}

async function generateWithOpenAI(config: ImageGenerationConfig): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for OpenAI image generation');
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: config.prompt,
      n: 1,
      size: '1792x1024',
      response_format: 'url'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI image generation failed: ${error}`);
  }

  const data = await response.json() as OpenAIImageResponse;
  const imageUrl = data.data[0]?.url;

  if (!imageUrl) {
    throw new Error('No image URL returned from OpenAI');
  }

  // Download the image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error('Failed to download generated image');
  }

  return Buffer.from(await imageResponse.arrayBuffer());
}

async function generateWithGoogle(config: ImageGenerationConfig): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const projectId = process.env.GOOGLE_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

  if (!apiKey || !projectId) {
    throw new Error('GOOGLE_API_KEY and GOOGLE_PROJECT_ID environment variables are required');
  }

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      instances: [{ prompt: config.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '16:9'
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google image generation failed: ${error}`);
  }

  const data = await response.json() as GoogleImageResponse;
  const base64Image = data.predictions[0]?.bytesBase64Encoded;

  if (!base64Image) {
    throw new Error('No image data returned from Google');
  }

  return Buffer.from(base64Image, 'base64');
}

async function generateWithXAI(config: ImageGenerationConfig): Promise<Buffer> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error('XAI_API_KEY environment variable is required for xAI image generation');
  }

  const response = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'aurora',
      prompt: config.prompt,
      n: 1,
      response_format: 'url'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`xAI image generation failed: ${error}`);
  }

  const data = await response.json() as XAIImageResponse;
  const imageUrl = data.data[0]?.url;
  const base64Image = data.data[0]?.b64_json;

  if (base64Image) {
    return Buffer.from(base64Image, 'base64');
  }

  if (imageUrl) {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error('Failed to download generated image');
    }
    return Buffer.from(await imageResponse.arrayBuffer());
  }

  throw new Error('No image data returned from xAI');
}
