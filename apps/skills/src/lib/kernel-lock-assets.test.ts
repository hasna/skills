import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { stageKernelLockAssets } from "./kernel-lock-assets.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const owningModule = fileURLToPath(import.meta.resolve("@hasna/contracts/kernel-lock"));
const owningRoot = dirname(dirname(owningModule));
const name = "kernel-lock-acl-darwin";
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-kernel-assets-"));
  const contracts = join(root, "contracts"), skills = join(root, "skills");
  mkdirSync(join(contracts, "dist"), { recursive: true });
  mkdirSync(join(contracts, "native"));
  mkdirSync(join(skills, "dist"), { recursive: true });
  for (const path of ["package.json", "dist/kernel-lock.js", `native/${name}`, `native/${name}.json`]) {
    copyFileSync(join(owningRoot, path), join(contracts, path));
  }
  const module = join(contracts, "dist/kernel-lock.js");
  const version = JSON.parse(readFileSync(join(contracts, "package.json"), "utf8")).version;
  return { root, contracts, skills, module, version };
}

test("bundled lock helpers preserve exact owning bytes at both literal module-relative locations", () => {
  const f = fixture();
  try {
    const original = readFileSync(join(f.contracts, "native", name));
    const pin = stageKernelLockAssets(f.module, f.skills, f.version);
    expect(pin).toBe(hash(original));
    for (const directory of ["native", "dist/native"]) {
      const path = join(f.skills, directory, name);
      expect(readFileSync(path)).toEqual(original);
      expect(lstatSync(path).nlink).toBe(1);
      expect(lstatSync(path).mode & 0o777).toBe(0o755);
    }
    expect(stageKernelLockAssets(f.module, f.skills, f.version)).toBe(pin);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("tampered owning bytes and a different package pin refuse before staging", () => {
  const f = fixture();
  try {
    expect(() => stageKernelLockAssets(f.module, f.skills, "0.0.0")).toThrow("pinned Contracts");
    const path = join(f.contracts, "native", name), bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(path, bytes);
    expect(() => stageKernelLockAssets(f.module, f.skills, f.version)).toThrow("runtime pin is invalid");
    expect(() => lstatSync(join(f.skills, "native"))).toThrow();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("an altered or writable destination is retained and refused rather than overwritten", () => {
  const f = fixture();
  try {
    stageKernelLockAssets(f.module, f.skills, f.version);
    const path = join(f.skills, "native", name), bytes = readFileSync(path);
    chmodSync(path, 0o777);
    expect(() => stageKernelLockAssets(f.module, f.skills, f.version)).toThrow("Unsafe kernel lock asset");
    expect(readFileSync(path)).toEqual(bytes);
    chmodSync(path, 0o755);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(path, bytes);
    expect(() => stageKernelLockAssets(f.module, f.skills, f.version)).toThrow("readback failed");
    expect(readFileSync(path)).toEqual(bytes);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("symlinked output ancestors refuse without writing through them", () => {
  const f = fixture();
  try {
    const other = join(f.root, "other");
    mkdirSync(other);
    // Both paths are this test's synthetic fixtures.
    rmSync(join(f.skills, "dist"), { recursive: true });
    symlinkSync(other, join(f.skills, "dist"), "dir");
    expect(() => stageKernelLockAssets(f.module, f.skills, f.version)).toThrow("parent must be physical");
    expect(() => lstatSync(join(other, "native"))).toThrow();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
