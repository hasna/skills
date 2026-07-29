export function parseCSV(content: string): any[] {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const data: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row: any = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx];
      });
      data.push(row);
    }
  }

  return data;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values.map(v => v.replace(/^"|"$/g, ''));
}

export function parseJSON(content: string): any[] {
  const parsed = JSON.parse(content);

  if (Array.isArray(parsed)) {
    return parsed;
  } else if (parsed.data && Array.isArray(parsed.data)) {
    return parsed.data;
  } else if (typeof parsed === 'object') {
    // Convert object to array of key-value pairs
    return Object.entries(parsed).map(([key, value]) => ({ key, value }));
  }

  throw new Error('Unsupported JSON structure');
}
