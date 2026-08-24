/**
 * Validation des photos de contact.
 *
 * Rien ici ne fait confiance au navigateur. Ni le nom du fichier, ni le type
 * MIME annoncé dans le `FormData` : les deux sont choisis par le client et un
 * `image/png` peut parfaitement contenir un script. Seuls les premiers octets
 * du fichier décident, et l'extension stockée en découle.
 *
 * Fonctions pures : testées dans `photo.test.ts`, sans système de fichiers.
 */

/** 2 Mo : largement au-dessus d'un avatar, très en dessous d'un abus. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Préfixe de clé dans le magasin d'objets. */
export const PHOTO_KEY_PREFIX = "contacts";

export interface ImageFormat {
  mimeType: string;
  extension: string;
}

/**
 * Formats acceptés, avec leur signature.
 *
 * SVG en est délibérément absent : c'est un document XML, il peut porter du
 * script, et un navigateur qui l'affiche depuis notre origine l'exécuterait.
 */
const SIGNATURES: Array<{
  format: ImageFormat;
  matches: (bytes: Uint8Array) => boolean;
}> = [
  {
    format: { mimeType: "image/png", extension: "png" },
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    format: { mimeType: "image/jpeg", extension: "jpg" },
    matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    format: { mimeType: "image/gif", extension: "gif" },
    matches: (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a",
  },
  {
    format: { mimeType: "image/webp", extension: "webp" },
    // RIFF <taille sur 4 octets> WEBP
    matches: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
];

/** Libellé des formats acceptés, réutilisé par les messages d'erreur et l'UI. */
export const ACCEPTED_PHOTO_MIME_TYPES = SIGNATURES.map(
  (signature) => signature.format.mimeType,
);

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return "";
  let out = "";
  for (let index = start; index < end; index += 1) {
    out += String.fromCharCode(bytes[index]!);
  }
  return out;
}

/** Format réel du fichier, d'après ses octets d'en-tête. `null` si inconnu. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  return SIGNATURES.find((signature) => signature.matches(bytes))?.format ?? null;
}

export type PhotoRejection = "too-large" | "unsupported-type" | "empty";

export interface PhotoAccepted {
  ok: true;
  format: ImageFormat;
}

export interface PhotoRejected {
  ok: false;
  reason: PhotoRejection;
  message: string;
}

const MESSAGES: Record<PhotoRejection, string> = {
  "too-large": "La photo dépasse 2 Mo.",
  "unsupported-type": "Formats acceptés : JPEG, PNG, GIF ou WebP.",
  empty: "Le fichier est vide.",
};

/** Décide si ces octets peuvent être stockés comme photo de contact. */
export function inspectPhoto(bytes: Uint8Array): PhotoAccepted | PhotoRejected {
  if (bytes.length === 0) {
    return { ok: false, reason: "empty", message: MESSAGES.empty };
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    return { ok: false, reason: "too-large", message: MESSAGES["too-large"] };
  }

  const format = detectImageFormat(bytes);
  if (!format) {
    return {
      ok: false,
      reason: "unsupported-type",
      message: MESSAGES["unsupported-type"],
    };
  }

  return { ok: true, format };
}

/**
 * Clé de stockage : un UUID aléatoire et l'extension **déduite des octets**.
 * Le nom d'origine du fichier n'est jamais réutilisé, ni même conservé.
 */
export function buildPhotoKey(format: ImageFormat, uuid: string): string {
  return `${PHOTO_KEY_PREFIX}/${uuid}.${format.extension}`;
}
