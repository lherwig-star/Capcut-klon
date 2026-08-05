import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Windows PowerShell 5.1 - still the default "Windows PowerShell" on every Windows box -
 * reads a .ps1 without a byte-order mark as Windows-1252, not UTF-8. Every German umlaut
 * then arrives as two mojibake characters, and some of those are quote characters that
 * PowerShell honours as string delimiters: a single one opens a string that swallows the
 * rest of the file, and the script dies pointing at lines far from the actual cause.
 *
 * That bit us once already (an "Ä" became 'Ã„', whose second character PowerShell reads
 * as an opening quote), so both defences are pinned down here: the mark itself, and the
 * absence of any character that would be dangerous should an editor ever strip it.
 */
const SCRIPT_PATH = join(__dirname, "..", "..", "install-windows.ps1");

/** Everything PowerShell accepts as a string delimiter, plus its escape character. */
const POWERSHELL_QUOTES = new Set(['"', "'", "`", "‘", "’", "“", "”", "„"]);

/** CP1252 matches ISO-8859-1 apart from 0x80-0x9F - which is where the quotes live. */
const CP1252_HIGH = [
  "€", "", "‚", "ƒ", "„", "…", "†", "‡",
  "ˆ", "‰", "Š", "‹", "Œ", "", "Ž", "",
  "", "‘", "’", "“", "”", "•", "–", "—",
  "˜", "™", "š", "›", "œ", "", "ž", "Ÿ",
];

function decodeAsCp1252(bytes: Uint8Array): string {
  return [...bytes]
    .map((b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b)))
    .join("");
}

describe("install-windows.ps1", () => {
  const bytes = readFileSync(SCRIPT_PATH);

  it("carries a UTF-8 byte-order mark", () => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("holds no character that would turn into a quote if the mark were lost", () => {
    const text = bytes.subarray(3).toString("utf-8");
    const offenders = new Set<string>();

    for (const char of text) {
      if (char.charCodeAt(0) < 128) continue;
      const misread = decodeAsCp1252(new TextEncoder().encode(char));
      if ([...misread].some((c) => POWERSHELL_QUOTES.has(c))) offenders.add(char);
    }

    expect([...offenders]).toEqual([]);
  });

  it("still detects a character that would be dangerous", () => {
    // Guards the guard: an "Ä" must be reported, otherwise the check above proves nothing.
    const misread = decodeAsCp1252(new TextEncoder().encode("Ä"));
    expect([...misread].some((c) => POWERSHELL_QUOTES.has(c))).toBe(true);
  });
});
