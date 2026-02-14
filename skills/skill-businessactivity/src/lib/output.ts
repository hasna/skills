export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => {
    const maxRowWidth = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.max(h.length, maxRowWidth);
  });

  const separator = widths.map(w => '-'.repeat(w + 2)).join('+');
  const formatRow = (row: string[]) =>
    row.map((cell, i) => ` ${(cell || '').padEnd(widths[i])} `).join('|');

  console.log(separator);
  console.log(formatRow(headers));
  console.log(separator);
  rows.forEach(row => console.log(formatRow(row)));
  console.log(separator);
}

export function printTree(
  items: { id: string; name: string; parentId?: string | null; children?: any[] }[],
  indent = 0
): void {
  const prefix = indent === 0 ? '' : '  '.repeat(indent - 1) + (indent > 0 ? '├─ ' : '');

  for (const item of items) {
    console.log(`${prefix}${item.name} (${item.id.slice(0, 8)}...)`);
    if (item.children && item.children.length > 0) {
      printTree(item.children, indent + 1);
    }
  }
}

export function buildTree<T extends { id: string; parentId?: string | null }>(
  items: T[]
): (T & { children: T[] })[] {
  const map = new Map<string, T & { children: T[] }>();
  const roots: (T & { children: T[] })[] = [];

  // First pass: create all nodes with empty children arrays
  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  // Second pass: build the tree structure
  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function success(message: string): void {
  console.log(`✓ ${message}`);
}

export function error(message: string): void {
  console.error(`✗ ${message}`);
}

export function info(message: string): void {
  console.log(`ℹ ${message}`);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length - 3) + '...';
}
