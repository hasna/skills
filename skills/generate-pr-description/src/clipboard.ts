import { spawnSync } from "child_process";

export function copyToClipboard(text: string): boolean {
  try {
    // Try pbcopy (macOS)
    const pbcopy = spawnSync('pbcopy', [], {
      input: text,
      encoding: 'utf-8',
    });
    if (pbcopy.status === 0) return true;

    // Try xclip (Linux)
    const xclip = spawnSync('xclip', ['-selection', 'clipboard'], {
      input: text,
      encoding: 'utf-8',
    });
    if (xclip.status === 0) return true;

    // Try wl-copy (Wayland)
    const wlcopy = spawnSync('wl-copy', [], {
      input: text,
      encoding: 'utf-8',
    });
    if (wlcopy.status === 0) return true;

    return false;
  } catch {
    return false;
  }
}
