import { describe, expect, it } from "vitest";

import {
  buildPhotoKey,
  detectImageFormat,
  inspectPhoto,
  MAX_PHOTO_BYTES,
} from "./photo";

/** En-têtes réels, suivis d'un remplissage quelconque. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = new Uint8Array([...Buffer.from("GIF89a"), 0, 0]);
const WEBP = new Uint8Array([
  ...Buffer.from("RIFF"),
  0x1a,
  0,
  0,
  0,
  ...Buffer.from("WEBP"),
]);

describe("detectImageFormat", () => {
  it("reconnaît les quatre formats acceptés", () => {
    expect(detectImageFormat(PNG)?.mimeType).toBe("image/png");
    expect(detectImageFormat(JPEG)?.mimeType).toBe("image/jpeg");
    expect(detectImageFormat(GIF)?.mimeType).toBe("image/gif");
    expect(detectImageFormat(WEBP)?.mimeType).toBe("image/webp");
  });

  it("refuse un SVG, qui est un document exécutable déguisé en image", () => {
    expect(detectImageFormat(new Uint8Array(Buffer.from("<svg xmlns=...>")))).toBeNull();
  });

  it("refuse un fichier qui ment sur son type", () => {
    // Un script renommé en « photo.png » : l'extension et le type MIME annoncé
    // n'entrent jamais dans la décision, seuls les octets comptent.
    expect(detectImageFormat(new Uint8Array(Buffer.from("#!/bin/sh")))).toBeNull();
  });

  it("ne se fait pas piéger par un fichier plus court que la signature", () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(detectImageFormat(new Uint8Array(Buffer.from("RIFF")))).toBeNull();
  });
});

describe("inspectPhoto", () => {
  it("accepte une vraie image", () => {
    expect(inspectPhoto(PNG).ok).toBe(true);
  });

  it("refuse un fichier vide", () => {
    expect(inspectPhoto(new Uint8Array(0))).toMatchObject({ ok: false, reason: "empty" });
  });

  it("refuse au-delà de la taille maximale", () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(PNG.slice(0, 8));
    expect(inspectPhoto(big)).toMatchObject({ ok: false, reason: "too-large" });
  });

  it("refuse un format inconnu", () => {
    expect(inspectPhoto(new Uint8Array(Buffer.from("hello")))).toMatchObject({
      ok: false,
      reason: "unsupported-type",
    });
  });
});

describe("buildPhotoKey", () => {
  it("n'utilise que des valeurs choisies par le serveur", () => {
    const key = buildPhotoKey(
      { mimeType: "image/png", extension: "png" },
      "11111111-2222-4333-8444-555555555555",
    );
    expect(key).toBe("contacts/11111111-2222-4333-8444-555555555555.png");
  });
});
