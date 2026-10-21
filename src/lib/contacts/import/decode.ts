/**
 * Décodage des octets d'un export CSV — fonction pure.
 *
 * Ordre de détection, du plus sûr au plus probable :
 *
 * 1. une marque d'ordre (BOM) UTF-8, UTF-16LE ou UTF-16BE fait foi ;
 * 2. sans BOM, des octets nuls une position sur deux trahissent de l'UTF-16
 *    (le texte d'un export est presque entièrement ASCII) ;
 * 3. sinon on tente l'UTF-8 strict — un fichier Windows-1252 accentué n'est
 *    jamais de l'UTF-8 valide ;
 * 4. à défaut, Windows-1252 : l'encodage de l'export de l'Outlook classique.
 */

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
  hadBom: boolean;
}

/**
 * Plage 0x80–0x9F de Windows-1252 (le reste coïncide avec Latin-1). Écrite à
 * la main : selon la version et la compilation de Node, `TextDecoder` décode
 * l'étiquette `windows-1252` comme du Latin-1 et rend `€` en U+0080.
 */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

function decodeWindows1252(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    const codes = Array.from(bytes.subarray(i, i + 4096), (b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b));
    out += String.fromCharCode(...codes);
  }
  return out;
}

function decode(bytes: Uint8Array, encoding: CsvEncoding, fatal = false): string {
  if (encoding === "windows-1252") return decodeWindows1252(bytes);
  // `ignoreBOM: false` (défaut) : le décodeur retire lui-même la BOM.
  return new TextDecoder(encoding, { fatal }).decode(bytes);
}

function looksLikeUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (sample.length < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) {
      if (i % 2 === 0) evenZeros += 1;
      else oddZeros += 1;
    }
  }
  const half = sample.length / 2;
  if (oddZeros > half * 0.3 && evenZeros < half * 0.05) return "utf-16le";
  if (evenZeros > half * 0.3 && oddZeros < half * 0.05) return "utf-16be";
  return null;
}

export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decode(bytes, "utf-8"), encoding: "utf-8", hadBom: true };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decode(bytes, "utf-16le"), encoding: "utf-16le", hadBom: true };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decode(bytes, "utf-16be"), encoding: "utf-16be", hadBom: true };
  }

  const utf16 = looksLikeUtf16(bytes);
  if (utf16) return { text: decode(bytes, utf16), encoding: utf16, hadBom: false };

  try {
    return { text: decode(bytes, "utf-8", true), encoding: "utf-8", hadBom: false };
  } catch {
    return { text: decode(bytes, "windows-1252"), encoding: "windows-1252", hadBom: false };
  }
}
