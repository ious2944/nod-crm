import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Magasin d'objets binaires.
 *
 * Une seule implémentation existe en V0.2 (système de fichiers local, monté
 * sur un volume Docker), mais tout le code applicatif ne connaît que cette
 * interface : le jour où un stockage objet (S3, MinIO, Garage…) sera
 * nécessaire, il suffira d'en écrire une seconde implémentation et de changer
 * la ligne d'export en bas de ce fichier. Aucun appelant ne bouge.
 *
 * Les clés sont **opaques et générées par le serveur** (voir
 * `src/lib/contacts/photo.ts`). Aucune valeur venue du client n'atteint jamais
 * un chemin de fichier : `resolveKey` refuse tout ce qui n'est pas exactement
 * `<dossier>/<uuid>.<extension>`.
 */
export interface ObjectStore {
  put(key: string, data: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

/**
 * Forme autorisée d'une clé : deux segments, sans point d'échappement, sans
 * séparateur exotique. C'est la garde anti-« path traversal » : `../`, les
 * chemins absolus, les octets NUL et les noms arbitraires sont hors motif.
 */
const KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export class InvalidObjectKeyError extends Error {
  constructor() {
    super("Clé de fichier invalide.");
    this.name = "InvalidObjectKeyError";
  }
}

export function isSafeObjectKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * Racine du stockage local. Volontairement hors de `public/` : les photos de
 * contacts sont des données de workspace, elles ne doivent jamais être servies
 * en statique par le serveur web. Elles ne sortent que par un gestionnaire de
 * route qui vérifie la session et le workspace.
 */
export const UPLOAD_DIR =
  process.env.NOD_UPLOAD_DIR?.trim() || path.join(process.cwd(), "var", "uploads");

function resolveKey(root: string, key: string): string {
  if (!isSafeObjectKey(key)) {
    throw new InvalidObjectKeyError();
  }

  const base = path.resolve(root);
  const target = path.resolve(base, key);

  // Ceinture et bretelles : même si le motif ci-dessus était un jour relâché,
  // un chemin sortant de la racine est refusé ici.
  if (!target.startsWith(base + path.sep)) {
    throw new InvalidObjectKeyError();
  }

  return target;
}

export function createLocalObjectStore(root: string = UPLOAD_DIR): ObjectStore {
  return {
    async put(key, data) {
      const target = resolveKey(root, key);
      await mkdir(path.dirname(target), { recursive: true });
      // `wx` : on n'écrase jamais un objet existant. Les clés étant des UUID v4,
      // une collision signalerait un problème bien plus grave qu'un doublon.
      await writeFile(target, data, { flag: "wx", mode: 0o640 });
    },

    async read(key) {
      try {
        // `new Uint8Array(...)` et non le `Buffer` renvoyé par Node : les
        // appelants doivent voir la même chose quelle que soit
        // l'implémentation, et un futur magasin objet ne rendra pas de Buffer.
        return new Uint8Array(await readFile(resolveKey(root, key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async remove(key) {
      // `force` : effacer un objet déjà absent n'est pas une erreur — l'appelant
      // veut seulement qu'il ne soit plus là.
      await rm(resolveKey(root, key), { force: true });
    },
  };
}

/** Implémentation utilisée par l'application. Point de bascule unique. */
export const objectStore: ObjectStore = createLocalObjectStore();
