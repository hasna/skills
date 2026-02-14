import { spawn } from 'child_process';
import { writeFile, mkdir, readFile, unlink, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { EmojiResult } from './types';

export class ImageProcessor {
  private targetSize: number;

  constructor(targetSize: number = 128) {
    this.targetSize = targetSize;
  }

  /**
   * Resize an image buffer to the target size using sips (macOS built-in)
   */
  async resize(buffer: Buffer, name: string): Promise<Buffer> {
    // Create temp files for processing
    const tempDir = '/tmp/skill-emoji';
    await mkdir(tempDir, { recursive: true });

    const inputPath = join(tempDir, `${name}-input.png`);
    const outputPath = join(tempDir, `${name}-output.png`);

    try {
      // Write input buffer to temp file
      await writeFile(inputPath, buffer);

      // Use sips (macOS) to resize the image
      await this.runCommand('sips', [
        '-z', String(this.targetSize), String(this.targetSize),
        inputPath,
        '--out', outputPath,
      ]);

      // Read the resized image
      const resizedBuffer = await readFile(outputPath);

      return resizedBuffer;
    } finally {
      // Cleanup temp files
      try {
        await unlink(inputPath);
        await unlink(outputPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Save emoji results to a directory
   */
  async saveToDirectory(results: EmojiResult[], outputDir: string): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });

    const savedPaths: string[] = [];

    for (const result of results) {
      const filename = `${result.name}.png`;
      const filepath = join(outputDir, filename);
      await writeFile(filepath, result.buffer);
      result.path = filepath;
      savedPaths.push(filepath);
    }

    return savedPaths;
  }

  /**
   * Create a zip file from emoji results
   */
  async createZip(results: EmojiResult[], outputPath: string): Promise<string> {
    const tempDir = '/tmp/skill-emoji-zip';
    await mkdir(tempDir, { recursive: true });

    // Save all images to temp directory
    const savedPaths = await this.saveToDirectory(results, tempDir);

    // Ensure output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    // Create zip using built-in zip command
    const filenames = results.map(r => `${r.name}.png`);
    await this.runCommand('zip', ['-j', outputPath, ...savedPaths], tempDir);

    // Cleanup temp directory
    for (const path of savedPaths) {
      try {
        await unlink(path);
      } catch {
        // Ignore cleanup errors
      }
    }

    return outputPath;
  }

  /**
   * Create a manifest JSON file with metadata
   */
  async createManifest(
    results: EmojiResult[],
    theme: string,
    outputPath: string
  ): Promise<void> {
    const manifest = {
      theme,
      count: results.length,
      size: this.targetSize,
      generated: new Date().toISOString(),
      emojis: results.map(r => ({
        name: r.name,
        filename: `${r.name}.png`,
        prompt: r.prompt,
      })),
    };

    await writeFile(outputPath, JSON.stringify(manifest, null, 2));
  }

  private runCommand(command: string, args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
}
