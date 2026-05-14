export function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export function toSnakeCase(name: string): string {
  return name.replace(/-/g, "_");
}

// Generate TypeScript project
