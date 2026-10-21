"use server";

// Rappel : ce fichier ne peut exporter QUE des fonctions asynchrones.
// Types et logique vivent dans `src/lib/contacts/import/`.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  previewImport,
  readUpload,
  runImport,
  type ImportOutcome,
  type PreviewResult,
} from "@/lib/contacts/import/service";
import { runCrmAction } from "@/lib/authz/run-crm-action";

/**
 * Import CSV Outlook, en deux temps : aperçu (aucune écriture), puis import.
 *
 * Même ordre que les autres actions du module : session d'abord (le workspace
 * en est dérivé, jamais lu du formulaire), validation ensuite. Le fichier
 * n'est ni stocké ni journalisé ; en cas d'échec inattendu, seul le type
 * d'erreur part dans les logs, jamais son message (il pourrait citer une
 * valeur du fichier).
 */

const modeSchema = z.enum(["skip", "complete"]);
/** Numéros de ligne des doublons probables à importer quand même. */
const includeSchema = z.array(z.coerce.number().int().min(2).max(10_000)).max(5000);

const FAILURE = "L'import a échoué : aucun contact n'a été enregistré. Réessaie dans un instant.";

function logFailure(step: string, error: unknown): void {
  console.error(`[contacts] import CSV en échec (${step})`, {
    errorType: error instanceof Error ? error.constructor.name : typeof error,
  });
}

export async function previewContactImport(formData: FormData): Promise<PreviewResult> {
  return runCrmAction("crm.contact.import", async ({ workspaceId }) => {
    const upload = await readUpload(formData.get("file"));
    if (!upload.ok) return upload;

    try {
      return await previewImport(workspaceId, upload.bytes);
    } catch (error) {
      logFailure("aperçu", error);
      return { ok: false, error: "Le fichier n'a pas pu être analysé. Réessaie dans un instant." };
    }
  });
}

export async function importContacts(formData: FormData): Promise<ImportOutcome> {
  return runCrmAction("crm.contact.import", async (actor) => {
    const mode = modeSchema.safeParse(formData.get("mode"));
    if (!mode.success) return { ok: false, error: "Choisis quoi faire des contacts déjà présents." };

    const include = includeSchema.safeParse(formData.getAll("include"));
    if (!include.success) return { ok: false, error: "Sélection de lignes invalide." };

    const upload = await readUpload(formData.get("file"));
    if (!upload.ok) return upload;

    let outcome: ImportOutcome;
    try {
      outcome = await runImport(actor, upload.bytes, mode.data, new Set(include.data));
    } catch (error) {
      logFailure("écriture", error);
      return { ok: false, error: FAILURE };
    }

    if (outcome.ok) {
      revalidatePath("/contacts");
      revalidatePath("/organizations");
    }
    return outcome;
  });
}
