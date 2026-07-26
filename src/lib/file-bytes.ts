/**
 * file-bytes.ts — turning bytes into text that a content guard can actually scan.
 *
 * Every guard in this repo that reads files used to decide "is this text?" with
 * some form of `buffer.includes(0)` and skip the file when the answer was no.
 * That is not a heuristic, it is an opt-out: appending or prepending one NUL
 * byte removed a file from the scan entirely, silently, and the guard still
 * exited 0. It was live in three places at once — the R4 infrastructure scan,
 * `content-scan.ts`'s secret/PII scanner, and `release-guard.ts`'s own marker
 * scan, which is the actual publish gate.
 *
 * The rule here is: decode everything, skip almost nothing, and let the caller
 * treat a skip as a finding.
 */

/** Magic numbers for formats that are genuinely compiled/compressed bytes. */
const BINARY_MAGICS: readonly (readonly number[])[] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x25, 0x50, 0x44, 0x46], // PDF
  [0x50, 0x4b, 0x03, 0x04], // ZIP (also docx/xlsx/jar)
  [0x1f, 0x8b], // gzip
  [0x00, 0x61, 0x73, 0x6d], // wasm
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x42, 0x5a, 0x68], // bzip2
  [0xfd, 0x37, 0x7a, 0x58, 0x5a], // xz
];

/**
 * Whether the bytes are a compiled/compressed binary.
 *
 * Decided by CONTENT, never by filename. A filename-based version of this check
 * was itself a bypass: a plain-text file named `leak.gz` was skipped without
 * ever being opened. An extension is attacker-chosen; the leading bytes are not.
 *
 * Note what this deliberately does NOT do: it does not treat "contains a NUL"
 * as binary. Plenty of legitimate text files contain NUL — fixtures, test
 * corpora, anything storing a NUL-separated key — and treating that byte as a
 * skip signal is exactly the hole being closed.
 */
export function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  return BINARY_MAGICS.some((magic) => magic.every((byte, index) => buffer[index] === byte));
}

/**
 * Decode file bytes to scannable text.
 *
 *  - UTF-16 (BOM-marked, or detected from the alternating-NUL pattern of
 *    BOM-less ASCII) is decoded properly, so an identifier stored as UTF-16 is
 *    ordinary text by the time any rule sees it.
 *  - NUL bytes are stripped AFTER decoding, which defeats NUL-interleaved
 *    payloads (`1\0"2\0"3456789012`) and, as a bonus, renders BOM-less UTF-16
 *    ASCII readable even when the heuristic misses it.
 *  - Line structure is preserved: NUL is not a newline, so reported line
 *    numbers stay correct.
 *
 * Stripping NULs cannot cause a false negative — no rule in this repo matches a
 * NUL — and it removes the single byte that most reliably blinded these guards.
 */
export function decodeForScanning(buffer: Buffer): string {
  let text: string;

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(buffer);
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(buffer);
  } else {
    // BOM-less UTF-16 of ASCII content: EVERY byte of one parity is NUL. The
    // threshold is deliberately near-total (>=90%) rather than "lots of NULs".
    // A loose version of this test misfires on ordinary UTF-8 that merely
    // contains NULs — e.g. digits interleaved with NUL as an evasion attempt —
    // and mis-decoding turns readable text into mojibake, which HIDES the very
    // thing being looked for. Guessing wrong here fails open, so guess rarely.
    const sample = buffer.subarray(0, Math.min(buffer.length, 512));
    let evenNuls = 0;
    let oddNuls = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] !== 0) continue;
      if (i % 2 === 0) evenNuls++;
      else oddNuls++;
    }
    const half = Math.floor(sample.length / 2);
    const evenLength = buffer.length % 2 === 0;

    if (evenLength && half > 0 && oddNuls >= half * 0.9 && evenNuls === 0) {
      text = new TextDecoder("utf-16le").decode(buffer);
    } else if (evenLength && half > 0 && evenNuls >= half * 0.9 && oddNuls === 0) {
      text = new TextDecoder("utf-16be").decode(buffer);
    } else {
      text = buffer.toString("utf8");
    }
  }

  // NUL-stripping is the workhorse and it runs unconditionally: it defeats
  // NUL-interleaved payloads, and it also rescues BOM-less UTF-16 ASCII in the
  // cases the conservative heuristic above declines to guess at.
  return text.replace(/\0/g, "");
}
