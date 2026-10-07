import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { directAliasTarget, need, safeParents, snapshot, trustedAncestorOwner, unchanged } from "./codex-hook-trust-files.js";
import { isDeepStrictEqual } from "node:util";
import { assertPinnedLauncherRuntimeSafe, resolveLauncherCommand } from "../cli/commands/runtime-launcher.js";
import { canonicalSystemPath } from "./agent-integration.js";

// Refusal texts: the code before the colon is what journals record; the rest
// is a fix hint and names no path.
const COMMAND_NOT_CANONICAL = "SKILLS_COMMAND_NOT_CANONICAL: record the skills command as an absolute path with no . or .. components and no repeated or trailing slash, and keep every PATH entry absolute";
const COMMAND_ALIAS_UNSAFE = "SKILLS_COMMAND_ALIAS_UNSAFE: point the skills command link directly at the physical Skills entry, or reinstall it with skills self-update, then rerun skills hook install";

/**
 * The physical file a command reaches. The command must be an exact absolute,
 * normalized path: path.resolve and Bun's realpath both drop `..` as text,
 * while the kernel follows a link before the `..` that comes after it, so any
 * other spelling could be walked at one place and run from another. Its
 * directory chain (after the verified macOS /tmp, /var and /etc root alias)
 * must be trusted, like every other trust input. Only that leaf may be an
 * alias: a symlink owned by root or the current user that names its physical
 * target directly. A chain of links is refused, since a link in it could be
 * re-pointed through a directory that no walk here sees.
 */
function commandPhysical(command: string): string {
  need(typeof command === "string" && isAbsolute(command) && !command.includes("\0") && resolve(command) === command, COMMAND_NOT_CANONICAL);
  // A missing command fails exactly as before.
  const physical = realpathSync(command);
  let spelled: string;
  try { spelled = canonicalSystemPath(command); } catch { need(false, "UNSAFE_PARENT"); }
  safeParents(spelled);
  let direct = false;
  try {
    const leaf = lstatSync(spelled);
    direct = leaf.isSymbolicLink() ? trustedAncestorOwner(leaf.uid) && directAliasTarget(spelled) === physical : spelled === physical;
  } catch { /* a leaf that changed while it was read is not direct */ }
  need(direct, COMMAND_ALIAS_UNSAFE);
  return physical;
}

/** A pinned Bun runs the command, so it and every directory above it are
 * trust inputs: a safe regular file at an exact path in a trusted chain. */
function assertPinnedRuntime(runtime: string): void {
  try { assertPinnedLauncherRuntimeSafe(runtime); } catch { need(false, "SKILLS_LAUNCHER_UNVERIFIED"); }
  need(resolve(runtime) === runtime, "SKILLS_LAUNCHER_UNVERIFIED");
  safeParents(runtime);
}

/**
 * The Skills entry a command runs. A symlink resolves to its physical target,
 * as before; a managed pinned launcher (the exact template the copyfile
 * updater writes) resolves to the exact entry it runs. The launcher file then
 * joins the trust chain: it must be an owned, unshared file whose bytes are
 * rechecked, and its pinned Bun must be a safe regular file in a trusted
 * directory chain, which the recheck walks again.
 */
interface CommandTarget { physical: string; entry: string; launcher?: ReturnType<typeof snapshot>; runtime?: string }

function skillsCommandTarget(command: string): CommandTarget {
  const physical = commandPhysical(command);
  let resolved: ReturnType<typeof resolveLauncherCommand>;
  try { resolved = resolveLauncherCommand(physical); } catch { need(false, "SKILLS_LAUNCHER_UNVERIFIED"); }
  if (!resolved.pinned) return { physical: resolved.physical, entry: resolved.physical };
  const launcher = snapshot(resolved.physical, false);
  need(launcher.sha256 === resolved.pinned.sha256, "SKILLS_LAUNCHER_UNVERIFIED");
  assertPinnedRuntime(resolved.pinned.runtime);
  return { physical: resolved.physical, entry: resolved.entry, launcher, runtime: resolved.pinned.runtime };
}

/** Repeat the whole command check and require the same physical command file,
 * entry and pinned Bun, not only the same entry: a command re-pointed to
 * another launcher for the same entry, pinned to another Bun, must not pass.
 * Any command-side refusal reads as SKILLS_COMMAND_CHANGED here; the launcher
 * bytes and the pinned Bun keep their own codes. */
function targetUnchanged(command: string, target: CommandTarget): void {
  let again: ReturnType<typeof resolveLauncherCommand>;
  try { again = resolveLauncherCommand(commandPhysical(command)); } catch { need(false, "SKILLS_COMMAND_CHANGED"); }
  need(again.physical === target.physical && again.entry === target.entry && again.pinned?.runtime === target.runtime, "SKILLS_COMMAND_CHANGED");
  if (target.launcher) unchanged(target.launcher);
  if (target.runtime) assertPinnedRuntime(target.runtime);
}

/** A private release adapter supplies a reviewed registry artifact identity;
 * the normal CLI binds to its own installed entrypoint instead. */
export interface ReviewedSkillsCli { path: string; version: string; sha256: string }

/** Read an unchanged journal binding as evidence, never as executable recovery
 * code. The caller separately binds and verifies the running recovery package. */
export function inspectRecordedSkillsCli(command: string, expected: unknown) {
  need(isAbsolute(command) && !command.includes("\0"), "RECONCILE_RECORDED_COMMAND_REQUIRED");
  const target = skillsCommandTarget(command), resolved = target.entry;
  const cli = snapshot(resolved, false, { readOnlyPackage: true });
  const manifest = snapshot(join(dirname(dirname(resolved)), "package.json"), false, { readOnlyPackage: true });
  const pkg = JSON.parse(manifest.text);
  need(pkg.name === "@hasna/skills" && /^\d+\.\d+\.\d+$/.test(pkg.version) && pkg.bin?.skills === "bin/index.js" && resolved === join(dirname(manifest.file), "bin/index.js"), "SKILLS_PACKAGE_MISMATCH");
  need((cli.stat.mode & 0o100n) !== 0n, "SKILLS_COMMAND_NOT_EXECUTABLE");
  const receipt = { path: resolved, version: pkg.version as string, sha256: cli.sha256, manifestSha256: manifest.sha256 };
  need(isDeepStrictEqual(receipt, expected), "RECONCILE_SKILLS_BINDING_CHANGED");
  return { receipt, recheck() { targetUnchanged(command, target); unchanged(cli); unchanged(manifest); } };
}

export function bindSkillsCli(command: string, reviewed?: ReviewedSkillsCli) {
  const normal = Bun.which("skills", { PATH: process.env.PATH });
  need(normal, "SKILLS_COMMAND_UNAVAILABLE");
  const normalTarget = skillsCommandTarget(normal), resolved = normalTarget.entry;
  const bound = isAbsolute(command) ? command : command === "skills" ? normal : undefined;
  need(bound, "SKILLS_COMMAND_MISMATCH");
  const boundTarget = skillsCommandTarget(bound);
  need(boundTarget.entry === resolved, "SKILLS_COMMAND_MISMATCH");
  const entrypoint = reviewed?.path ?? process.argv[1];
  need(entrypoint && realpathSync(entrypoint) === resolved, "SKILLS_ENTRYPOINT_MISMATCH");
  const cli = snapshot(resolved, false, { readOnlyPackage: true });
  const manifest = snapshot(join(dirname(dirname(resolved)), "package.json"), false, { readOnlyPackage: true });
  const pkg = JSON.parse(manifest.text);
  need(pkg.name === "@hasna/skills" && /^\d+\.\d+\.\d+$/.test(pkg.version) && pkg.bin?.skills === "bin/index.js" && resolved === join(dirname(manifest.file), "bin/index.js"), "SKILLS_PACKAGE_MISMATCH");
  if (reviewed) need(/^[a-f0-9]{64}$/.test(reviewed.sha256) && reviewed.sha256 === cli.sha256 && reviewed.version === pkg.version, "SKILLS_RELEASE_MISMATCH");
  need((cli.stat.mode & 0o100n) !== 0n, "SKILLS_COMMAND_NOT_EXECUTABLE");
  return {
    receipt: { path: resolved, version: pkg.version as string, sha256: cli.sha256, manifestSha256: manifest.sha256 },
    recheck() {
      need(Bun.which("skills", { PATH: process.env.PATH }) === normal && realpathSync(entrypoint) === resolved, "SKILLS_COMMAND_CHANGED");
      targetUnchanged(normal, normalTarget); targetUnchanged(bound, boundTarget);
      unchanged(cli); unchanged(manifest);
    },
  };
}
