/**
 * Image conversion utilities using Sharp
 */

import sharp from 'sharp';
import { readFile, stat } from 'fs/promises';
import { extname, basename, dirname, join } from 'path';
import type { ImageFormat, ImageQuality, ConvertOptions, ConvertResult } from '../types';
import { QUALITY_SETTINGS } from '../types';

/**
 * Convert image to another format
 */
export async function convertImage(options: ConvertOptions): Promise<ConvertResult> {
  const startTime = Date.now();
  const inputStat = await stat(options.input);
  const inputFormat = extname(options.input).slice(1).toLowerCase() as ImageFormat;
  const outputFormat = options.format as ImageFormat;

  // Determine output path
  const outputPath = options.output || join(
    dirname(options.input),
    `${basename(options.input, extname(options.input))}.${outputFormat}`
  );

  try {
    let pipeline = sharp(options.input);

    // Apply resize if specified
    if (options.resize) {
      pipeline = pipeline.resize({
        width: options.resize.width,
        height: options.resize.height,
        fit: options.resize.fit || 'contain',
        withoutEnlargement: true,
      });
    }

    // Get quality settings
    const qualityPreset = options.quality || 'high';
    const qualitySetting = options.qualityValue ?? QUALITY_SETTINGS[qualityPreset].quality;

    // Convert to target format with appropriate options
    switch (outputFormat) {
      case 'png':
        pipeline = pipeline.png({
          quality: qualitySetting,
          compressionLevel: qualityPreset === 'lossless' ? 0 : 9,
        });
        break;

      case 'jpg':
      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality: qualitySetting,
          mozjpeg: qualityPreset !== 'lossless',
        });
        break;

      case 'webp':
        pipeline = pipeline.webp({
          quality: qualitySetting,
          lossless: qualityPreset === 'lossless',
          effort: QUALITY_SETTINGS[qualityPreset].effort || 4,
        });
        break;

      case 'avif':
        pipeline = pipeline.avif({
          quality: qualitySetting,
          lossless: qualityPreset === 'lossless',
          effort: QUALITY_SETTINGS[qualityPreset].effort || 4,
        });
        break;

      case 'gif':
        pipeline = pipeline.gif();
        break;

      case 'tiff':
        pipeline = pipeline.tiff({
          quality: qualitySetting,
          compression: qualityPreset === 'lossless' ? 'none' : 'lzw',
        });
        break;

      case 'bmp':
        // Sharp doesn't support BMP output directly, convert via raw buffer
        pipeline = pipeline.raw();
        break;

      default:
        throw new Error(`Unsupported output format: ${outputFormat}`);
    }

    // Write output
    await pipeline.toFile(outputPath);

    // Get output file size
    const outputStat = await stat(outputPath);

    return {
      success: true,
      input: options.input,
      output: outputPath,
      inputFormat,
      outputFormat,
      inputSize: inputStat.size,
      outputSize: outputStat.size,
      compressionRatio: inputStat.size / outputStat.size,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      input: options.input,
      output: outputPath,
      inputFormat,
      outputFormat,
      inputSize: inputStat.size,
      outputSize: 0,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get image metadata
 */
export async function getImageMetadata(filePath: string): Promise<{
  width: number;
  height: number;
  format: string;
  channels: number;
  size: number;
}> {
  const metadata = await sharp(filePath).metadata();
  const fileStat = await stat(filePath);

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || 'unknown',
    channels: metadata.channels || 0,
    size: fileStat.size,
  };
}

/**
 * Create image from buffer (for PDF to image conversion)
 */
export async function imageFromBuffer(
  buffer: Buffer,
  outputPath: string,
  format: ImageFormat,
  quality: ImageQuality = 'high'
): Promise<void> {
  const qualitySetting = QUALITY_SETTINGS[quality].quality;

  let pipeline = sharp(buffer);

  switch (format) {
    case 'png':
      pipeline = pipeline.png({ quality: qualitySetting });
      break;
    case 'jpg':
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality: qualitySetting });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: qualitySetting });
      break;
    default:
      pipeline = pipeline.png({ quality: qualitySetting });
  }

  await pipeline.toFile(outputPath);
}

/**
 * Extract first frame from GIF (for GIF to PNG/JPG)
 */
export async function extractGifFrame(
  inputPath: string,
  outputPath: string,
  format: ImageFormat = 'png',
  quality: ImageQuality = 'high'
): Promise<void> {
  const qualitySetting = QUALITY_SETTINGS[quality].quality;

  let pipeline = sharp(inputPath, { pages: 1 }); // Extract first page/frame

  switch (format) {
    case 'png':
      pipeline = pipeline.png({ quality: qualitySetting });
      break;
    case 'jpg':
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality: qualitySetting });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: qualitySetting });
      break;
    default:
      pipeline = pipeline.png({ quality: qualitySetting });
  }

  await pipeline.toFile(outputPath);
}

/**
 * Optimize image without changing format
 */
export async function optimizeImage(
  inputPath: string,
  outputPath: string,
  quality: ImageQuality = 'web'
): Promise<ConvertResult> {
  const format = extname(inputPath).slice(1).toLowerCase() as ImageFormat;
  return convertImage({
    input: inputPath,
    output: outputPath,
    format,
    quality,
  });
}
