import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, openSync, readFileSync, writeSync } from "node:fs";

const INVALID_LAYOUT = "Cannot safely update .env with multiline or unsupported assignments. Use single-line KEY=VALUE entries or edit the file manually.";
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
export class EnvAssignmentError extends Error {}

/** Serialize literal values for Bun dotenv, without evaluating user input. */
function serializeValue(value: string): string {
  if (controls.test(value)) throw new EnvAssignmentError("Environment values cannot contain control characters or newlines.");
  // Preserve the familiar KEY=value form for values needing no dotenv escaping.
  if (/^[A-Za-z0-9_./:@+=,-]*$/.test(value)) return value;
  // Single quotes/backticks preserve literal backslashes. Bun decodes some
  // backslash sequences inside double quotes, so use those only without any.
  const quote = ["'", "`", '"'].find(delimiter => !value.includes(delimiter) && (delimiter !== '"' || !value.includes("\\")));
  const trailingSlashes = value.match(/\\+$/)?.[0].length ?? 0;
  // Bun 1.3.14/1.4.0 disagree on retaining a slash immediately before a final dollar.
  if (!quote || trailingSlashes % 2 !== 0 || value.endsWith("\\$")) {
    throw new EnvAssignmentError("Cannot safely encode this environment value; incompatible quote/backslash combinations require manual editing.");
  }
  // A final dollar cannot expand; escaping it makes Bun retain an extra slash.
  // Other dollars need escaping, including inside single quotes and backticks.
  return `${quote}${value.replace(/\$(?=.)/g, "\\$")}${quote}`;
}

function commentSuffix(value: string): string {
  if (["'", '"', "`"].includes(value[0] ?? "")) {
    const quote = value[0];
    for (let index = 1; index < value.length; index++) {
      if (value[index] !== quote) continue;
      let slashes = 0;
      for (let previous = index - 1; previous >= 0 && value[previous] === "\\"; previous--) slashes++;
      if (slashes % 2 !== 0) continue;
      const suffix = value.slice(index + 1);
      if (!/^[ \t]*(?:#.*)?$/.test(suffix)) throw new EnvAssignmentError(INVALID_LAYOUT);
      return suffix;
    }
    throw new EnvAssignmentError(INVALID_LAYOUT);
  }
  const comment = value.indexOf("#");
  if (comment < 0) return value.match(/[ \t]*$/)?.[0] ?? "";
  return (value.slice(0, comment).match(/[ \t]*$/)?.[0] ?? "") + value.slice(comment);
}

/** Change only exact assignments to one valid key; reject ambiguous layouts before any write. */
export function prepareEnvAssignment(assignment: string, existing: string): { key: string; content: string } {
  const separator = assignment.indexOf("=");
  if (separator < 0) throw new EnvAssignmentError("Invalid format for --set. Expected KEY=VALUE.");
  const key = assignment.slice(0, separator);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new EnvAssignmentError("Environment key must match [A-Za-z_][A-Za-z0-9_]*.");
  }
  const encoded = serializeValue(assignment.slice(separator + 1));
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]|\r(?!\n)/.test(existing)) throw new EnvAssignmentError(INVALID_LAYOUT);
  let found = false;
  const content = existing.split(/(?<=\n)/).map(line => {
    const eol = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
    const body = eol ? line.slice(0, -eol.length) : line;
    if (/^[ \t]*(?:#.*)?$/.test(body)) return line;
    const match = /^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*)([ \t]*=[ \t]*)(.*)$/.exec(body);
    if (!match) throw new EnvAssignmentError(INVALID_LAYOUT);
    const suffix = commentSuffix(match[4]!);
    if (match[2] !== key) return line;
    found = true;
    return `${match[1]}${key}${match[3]}${encoded}${suffix}${eol}`;
  }).join("");
  if (found) return { key, content };
  const eol = existing.match(/\r?\n/)?.[0] ?? "\n";
  return { key, content: content + (content && !content.endsWith("\n") ? eol : "") + `${key}=${encoded}${eol}` };
}

/** Use one regular-file descriptor; never follow a link or create a file for invalid input. */
export function setEnvAssignment(path: string, assignment: string): string {
  const initial = prepareEnvAssignment(assignment, "");
  let descriptor: number | undefined;
  try {
    const previous = (() => {
      try { return lstatSync(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    })();
    if (previous && !previous.isFile()) throw new EnvAssignmentError("The project .env must be a regular file, not a symlink or special file.");
    descriptor = openSync(path, previous ? constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK
      : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || previous && (opened.ino !== previous.ino || opened.dev !== previous.dev)) {
      throw new EnvAssignmentError("The project .env changed while opening it; retry with a regular file.");
    }
    let prepared = initial;
    if (previous) {
      const original = readFileSync(descriptor), text = original.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(original)) throw new EnvAssignmentError(INVALID_LAYOUT);
      prepared = prepareEnvAssignment(assignment, text);
    }
    const bytes = Buffer.from(prepared.content, "utf8");
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(descriptor, bytes, written, bytes.length - written, written);
      if (count === 0) throw new Error("Incomplete file write");
      written += count;
    }
    ftruncateSync(descriptor, bytes.length);
    return prepared.key;
  } catch (error) {
    if (error instanceof EnvAssignmentError) throw error;
    throw new EnvAssignmentError("Cannot safely read or write the project .env file.");
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
