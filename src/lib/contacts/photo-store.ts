import "server-only";

import { randomUUID } from "node:crypto";

import { objectStore } from "@/lib/storage";
import { buildPhotoKey, inspectPhoto, MAX_PHOTO_BYTES } from "./photo";

/**
 * Passerelle entre un fichier reçu d'un formulaire et le magasin d'objets.
 *
 * L'ordre des contrôles compte :
 *
 * 1. la taille **annoncée** écarte le gros fichier avant de le charger en
 *    mémoire — inutile de bufferiser 40 Mo pour les refuser ensuite ;
 * 2. les octets réels décident du format, pas le type MIME du `FormData` ni
 *    l'extension du nom d'origine, tous deux choisis par le client ;
 * 3. la clé de stockage est tirée au sort côté serveur. Le nom du fichier
 *    envoyé n'est ni réutilisé, ni conservé, ni même journalisé.
 */

export interface StoredPhoto {
  key: string;
  mimeType: string;
}

export type PhotoUploadResult =
  | { status: "absent" }
  | { status: "stored"; photo: StoredPhoto }
  | { status: "rejected"; message: string };

/** Lit le champ `photo` d'un `FormData` et le range dans le magasin d'objets. */
export async function storePhotoUpload(value: FormDataEntryValue | null): Promise<PhotoUploadResult> {
  // Un champ `<input type="file">` laissé vide arrive comme un File de 0 octet.
  if (!(value instanceof File) || value.size === 0) {
    return { status: "absent" };
  }

  if (value.size > MAX_PHOTO_BYTES) {
    return { status: "rejected", message: "La photo dépasse 2 Mo." };
  }

  const bytes = new Uint8Array(await value.arrayBuffer());
  const inspection = inspectPhoto(bytes);

  if (!inspection.ok) {
    return { status: "rejected", message: inspection.message };
  }

  const key = buildPhotoKey(inspection.format, randomUUID());
  await objectStore.put(key, bytes);

  return {
    status: "stored",
    photo: { key, mimeType: inspection.format.mimeType },
  };
}

/**
 * Efface un objet devenu orphelin (photo remplacée, ou écriture en base
 * échouée après le stockage du fichier).
 *
 * Volontairement silencieux : l'utilisateur n'a pas à voir échouer son action
 * parce qu'un fichier déjà inutile n'a pas pu être effacé. La trace part dans
 * les journaux du conteneur.
 */
export async function discardPhoto(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await objectStore.remove(key);
  } catch {
    console.error("[contacts] photo orpheline non supprimée");
  }
}
