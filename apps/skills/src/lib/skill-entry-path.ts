/** Internal shared path policy for ordinary in-memory regular-file entries. */
export class SkillEntryPaths {
  private readonly files = new Set<string>();
  private readonly directories = new Set<string>();

  add(path: string, maxBytes: number, invalid: (message: string) => never, limit: () => never): void {
    if (path.length > maxBytes) limit();
    const encoded = new TextEncoder().encode(path);
    if (encoded.byteLength > maxBytes) limit();
    if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(encoded) !== path) invalid("Invalid UTF-8 entry path");
    if (!path || /[\\:\x00-\x1f\x7f]/u.test(path)) invalid("Unsafe entry path");
    if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) invalid("Unsafe entry path segment");
    const key = path.normalize("NFC").toLowerCase().normalize("NFC");
    if (this.files.has(key) || this.directories.has(key)) invalid("Duplicate or conflicting entry path");
    const parents = key.split("/");
    parents.pop();
    while (parents.length) {
      const parent = parents.join("/");
      if (this.files.has(parent)) invalid("Conflicting entry file ancestor");
      this.directories.add(parent);
      parents.pop();
    }
    this.files.add(key);
  }
}
