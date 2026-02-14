/**
 * Format Detector
 * Auto-detect input content format
 */

import type { InputFormat } from '../types';

export function detectFormat(content: string, filename?: string): InputFormat {
  // Check by file extension first
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    const extMap: Record<string, InputFormat> = {
      'md': 'markdown',
      'markdown': 'markdown',
      'html': 'html',
      'htm': 'html',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'csv': 'csv',
      'xml': 'xml',
      'txt': 'text',
      'js': 'code',
      'ts': 'code',
      'py': 'code',
      'rb': 'code',
      'go': 'code',
      'rs': 'code',
      'java': 'code',
      'c': 'code',
      'cpp': 'code',
      'h': 'code',
      'hpp': 'code',
      'cs': 'code',
      'php': 'code',
      'swift': 'code',
      'kt': 'code',
      'sh': 'code',
      'bash': 'code',
      'zsh': 'code',
      'sql': 'code',
      'css': 'code',
      'scss': 'code',
      'less': 'code'
    };

    if (ext && extMap[ext]) {
      return extMap[ext];
    }
  }

  // Content-based detection
  const trimmed = content.trim();

  // JSON detection
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON
    }
  }

  // XML detection
  if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && trimmed.includes('</'))) {
    return 'xml';
  }

  // HTML detection
  if (
    trimmed.toLowerCase().includes('<!doctype html') ||
    trimmed.toLowerCase().includes('<html') ||
    (trimmed.includes('<div') && trimmed.includes('</div>')) ||
    (trimmed.includes('<p>') && trimmed.includes('</p>'))
  ) {
    return 'html';
  }

  // YAML detection
  if (
    trimmed.includes(':') &&
    !trimmed.includes('{') &&
    (trimmed.match(/^\s*[\w-]+:\s/m) || trimmed.startsWith('---'))
  ) {
    return 'yaml';
  }

  // CSV detection (simple heuristic)
  const lines = trimmed.split('\n');
  if (lines.length > 1) {
    const firstLineCommas = (lines[0].match(/,/g) || []).length;
    const secondLineCommas = (lines[1].match(/,/g) || []).length;
    if (firstLineCommas > 0 && firstLineCommas === secondLineCommas) {
      return 'csv';
    }
  }

  // Markdown detection
  if (
    trimmed.match(/^#{1,6}\s+/m) ||       // Headers
    trimmed.includes('**') ||              // Bold
    trimmed.includes('```') ||             // Code blocks
    trimmed.match(/^\s*[-*+]\s+/m) ||      // Lists
    trimmed.match(/^\s*\d+\.\s+/m) ||      // Numbered lists
    trimmed.includes('](')                 // Links
  ) {
    return 'markdown';
  }

  // Code detection (by patterns)
  if (
    trimmed.includes('function ') ||
    trimmed.includes('const ') ||
    trimmed.includes('let ') ||
    trimmed.includes('var ') ||
    trimmed.includes('class ') ||
    trimmed.includes('import ') ||
    trimmed.includes('def ') ||
    trimmed.includes('fn ') ||
    trimmed.includes('pub ') ||
    trimmed.match(/^\s*(if|for|while|switch)\s*\(/m)
  ) {
    return 'code';
  }

  // Default to text
  return 'text';
}

export function getFormatDescription(format: InputFormat): string {
  const descriptions: Record<InputFormat, string> = {
    text: 'Plain text',
    markdown: 'Markdown',
    html: 'HTML',
    json: 'JSON',
    yaml: 'YAML',
    csv: 'CSV (Comma-Separated Values)',
    xml: 'XML',
    code: 'Source code',
    auto: 'Auto-detect'
  };
  return descriptions[format] || format;
}
