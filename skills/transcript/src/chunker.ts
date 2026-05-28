/**
 * Audio Chunker
 * Splits large audio files into smaller chunks for transcription
 */

import { spawn } from 'child_process';
import { mkdir, rm, stat, readdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import type { ChunkInfo } from './types';

// Default chunk duration in seconds (10 minutes)
const DEFAULT_CHUNK_DURATION = 600;
// Overlap in seconds to prevent word cutoff
const CHUNK_OVERLAP = 10;

export async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    let output = '';
    let error = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      error += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${error}`));
        return;
      }
      const duration = parseFloat(output.trim());
      if (isNaN(duration)) {
        reject(new Error('Could not parse audio duration'));
        return;
      }
      resolve(duration);
    });
  });
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return stats.size;
}

export async function needsChunking(filePath: string, maxSize: number): Promise<boolean> {
  const size = await getFileSize(filePath);
  return size > maxSize;
}

export async function splitAudioFile(
  inputPath: string,
  outputDir: string,
  chunkDuration: number = DEFAULT_CHUNK_DURATION
): Promise<ChunkInfo[]> {
  console.log(`[Chunker] Splitting audio file: ${inputPath}`);

  // Create output directory
  const chunkDir = join(outputDir, '.chunks');
  await mkdir(chunkDir, { recursive: true });

  const duration = await getAudioDuration(inputPath);
  const baseName = basename(inputPath, extname(inputPath));
  const ext = extname(inputPath) || '.mp3';

  console.log(`[Chunker] Total duration: ${Math.round(duration)}s`);
  console.log(`[Chunker] Chunk duration: ${chunkDuration}s with ${CHUNK_OVERLAP}s overlap`);

  const chunks: ChunkInfo[] = [];
  let startTime = 0;
  let chunkIndex = 0;

  while (startTime < duration) {
    const chunkPath = join(chunkDir, `${baseName}_chunk_${String(chunkIndex).padStart(3, '0')}${ext}`);
    const endTime = Math.min(startTime + chunkDuration, duration);

    await createChunk(inputPath, chunkPath, startTime, chunkDuration + CHUNK_OVERLAP);

    const chunkSize = await getFileSize(chunkPath);

    chunks.push({
      index: chunkIndex,
      startTime,
      endTime,
      path: chunkPath,
      size: chunkSize
    });

    console.log(`[Chunker] Created chunk ${chunkIndex + 1}: ${Math.round(startTime)}s - ${Math.round(endTime)}s (${(chunkSize / 1024 / 1024).toFixed(2)}MB)`);

    startTime += chunkDuration;
    chunkIndex++;
  }

  console.log(`[Chunker] Created ${chunks.length} chunks`);
  return chunks;
}

async function createChunk(
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-ss', startTime.toString(),
      '-t', duration.toString(),
      '-acodec', 'copy',
      outputPath
    ]);

    let error = '';

    ffmpeg.stderr.on('data', (data) => {
      error += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg chunk creation failed: ${error}`));
        return;
      }
      resolve();
    });
  });
}

export async function compressAudio(
  inputPath: string,
  outputPath: string,
  targetBitrate: string = '32k'
): Promise<string> {
  console.log(`[Chunker] Compressing audio: ${inputPath}`);
  console.log(`[Chunker] Target bitrate: ${targetBitrate}`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vn',                     // No video
      '-map_metadata', '-1',     // Remove metadata
      '-ac', '1',                // Mono
      '-c:a', 'libopus',         // Opus codec (best compression for voice)
      '-b:a', targetBitrate,     // Target bitrate
      '-application', 'voip',   // Optimized for voice
      outputPath
    ]);

    let error = '';

    ffmpeg.stderr.on('data', (data) => {
      error += data.toString();
    });

    ffmpeg.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg compression failed: ${error}`));
        return;
      }
      const newSize = await getFileSize(outputPath);
      console.log(`[Chunker] Compressed size: ${(newSize / 1024 / 1024).toFixed(2)}MB`);
      resolve(outputPath);
    });
  });
}

export async function cleanupChunks(chunkDir: string): Promise<void> {
  try {
    await rm(chunkDir, { recursive: true, force: true });
    console.log('[Chunker] Cleaned up temporary chunks');
  } catch {
    // Ignore cleanup errors
  }
}

export function mergeTranscriptions(
  transcriptions: string[],
  chunkDuration: number = DEFAULT_CHUNK_DURATION,
  overlap: number = CHUNK_OVERLAP
): string {
  if (transcriptions.length === 0) return '';
  if (transcriptions.length === 1) return transcriptions[0];

  // Simple merge strategy: trim overlap from the beginning of each chunk except the first
  // This is a basic approach; more sophisticated overlap detection could be added
  const merged: string[] = [transcriptions[0]];

  for (let i = 1; i < transcriptions.length; i++) {
    const text = transcriptions[i];
    // Remove potential duplicate sentences at the beginning
    // This is a heuristic approach
    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length > 1) {
      // Skip first sentence as it likely overlaps with previous chunk
      merged.push(sentences.slice(1).join(' '));
    } else {
      merged.push(text);
    }
  }

  return merged.join('\n\n');
}
