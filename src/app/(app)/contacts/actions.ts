"use server";

// Rappel : ce fichier ne peut exporter QUE des fonctions asynchrones.
// Types, constantes et schémas vivent dans `src/lib/contacts/`.

import { revalidatePath } from "next/cache";

import type { ContactFormState } from "@/lib/contacts/form-state";
import { discardPhoto, storePhotoUpload } from "@/lib/contacts/photo-store";
import type { ContactPickerOption } from "@/lib/contacts/queries";
import { searchContactOptions } from "@/lib/contacts/queries";
import {
  contactIdSchema,
  contactSearchSchema,
  createContactSchema,
  updateContactSchema,
} from "@/lib/contacts/schemas";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForAction } from "@/lib/workspace";

/**
 * Mutations du module Contacts.
 *
 * Chaque action suit le même ordre, qui est celui du module Follow-up :
 *
 * 1. **authentification d'abord** — une action appelée sans session est
 *    rejetée avant même de regarder le formulaire ;
 * 2. **validation Zod ensuite** — le schéma énumère ses champs, donc un
 *    `FormData` enrichi de `workspaceId`, `isDemo` ou `archivedAt` perd ces
 *    clés au passage (pas d'affectation de masse) ;
 * 3. **portée workspace enfin** — toute écriture porte `workspaceId` dans son
 *    `where`, jamais seulement l'identifiant venu du client.
 */

function collectFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createContact(
  _previous: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = createContactSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire est incomplet.",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const upload = await storePhotoUpload(formData.get("photo"));
  if (upload.status === "rejected") {
    return {
      status: "error",
      message: upload.message,
      fieldErrors: { photo: upload.message },
    };
  }

  const photo = upload.status === "stored" ? upload.photo : null;

  try {
    const contact = await prisma.contact.create({
      data: {
        workspaceId,
        // `firstName`/`lastName` sont non nuls en base depuis la V0.1 : une
        // identité peut reposer sur l'email ou l'organisation seuls, d'où la
        // chaîne vide plutôt qu'un `NULL`.
        firstName: parsed.data.firstName ?? "",
        lastName: parsed.data.lastName ?? "",
        email: parsed.data.email,
        phone: parsed.data.phone,
        jobTitle: parsed.data.jobTitle,
        organizationName: parsed.data.organizationName,
        notes: parsed.data.notes,
        photoKey: photo?.key ?? null,
        photoMimeType: photo?.mimeType ?? null,
      },
      select: { id: true },
    });

    revalidatePath("/contacts");
    revalidatePath("/follow-ups");

    return { status: "success", message: "Contact créé.", contactId: contact.id };
  } catch (error) {
    // Le fichier a été écrit avant la ligne : si l'insertion échoue, il ne doit
    // pas rester dans le magasin d'objets.
    await discardPhoto(photo?.key);
    throw error;
  }
}

export async function updateContact(
  _previous: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = updateContactSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire est incomplet.",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const { id, removePhoto, ...fields } = parsed.data;

  // Lecture bornée au workspace : un identifiant valide appartenant à quelqu'un
  // d'autre est indiscernable d'un identifiant inexistant.
  const existing = await prisma.contact.findFirst({
    where: { id, workspaceId },
    select: { id: true, photoKey: true },
  });

  if (!existing) {
    return { status: "error", message: "Ce contact n'existe pas." };
  }

  const upload = await storePhotoUpload(formData.get("photo"));
  if (upload.status === "rejected") {
    return {
      status: "error",
      message: upload.message,
      fieldErrors: { photo: upload.message },
    };
  }

  const photo = upload.status === "stored" ? upload.photo : null;
  const clearsPhoto = removePhoto && !photo;

  try {
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        firstName: fields.firstName ?? "",
        lastName: fields.lastName ?? "",
        email: fields.email,
        phone: fields.phone,
        jobTitle: fields.jobTitle,
        organizationName: fields.organizationName,
        notes: fields.notes,
        // Trois cas : nouvelle photo, retrait explicite, ou on n'y touche pas.
        ...(photo
          ? { photoKey: photo.key, photoMimeType: photo.mimeType }
          : clearsPhoto
            ? { photoKey: null, photoMimeType: null }
            : {}),
      },
    });
  } catch (error) {
    await discardPhoto(photo?.key);
    throw error;
  }

  // L'ancien fichier ne part qu'une fois la base à jour : dans l'autre ordre,
  // un échec d'écriture laisserait une fiche pointant sur un objet effacé.
  if (photo || clearsPhoto) {
    await discardPhoto(existing.photoKey);
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${existing.id}`);
  revalidatePath("/follow-ups");

  return { status: "success", message: "Contact mis à jour.", contactId: existing.id };
}

/**
 * Archivage — jamais de suppression destructive.
 *
 * Les suivis liés ne sont pas touchés : ni supprimés, ni détachés. La relation
 * historique reste lisible depuis la fiche, le contact disparaît seulement des
 * listes et des sélecteurs.
 */
export async function archiveContact(formData: FormData): Promise<void> {
  await setArchivedAt(formData, new Date());
}

/** Retour en arrière : un archivage doit pouvoir se défaire. */
export async function restoreContact(formData: FormData): Promise<void> {
  await setArchivedAt(formData, null);
}

async function setArchivedAt(formData: FormData, archivedAt: Date | null): Promise<void> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = contactIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("Contact introuvable.");
  }

  // `updateMany` plutôt que `update` : le `where` porte le workspace, donc une
  // ligne d'un autre espace n'est pas trouvée au lieu d'être modifiée.
  const { count } = await prisma.contact.updateMany({
    where: { id: parsed.data.id, workspaceId },
    data: { archivedAt },
  });

  if (count !== 1) {
    throw new Error("Contact introuvable.");
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${parsed.data.id}`);
  // Archiver un contact change ce que montrent les suivis, les tâches et le
  // cockpit — sans en supprimer aucun.
  revalidatePath("/follow-ups");
  revalidatePath("/tasks");
  revalidatePath("/today");
}

/**
 * Recherche du sélecteur de contact, appelée depuis le formulaire Follow-Up.
 *
 * C'est une lecture, pas une mutation : elle passe par une action uniquement
 * parce que c'est le canal serveur déjà en place. Le filtrage est fait par
 * PostgreSQL et le résultat est plafonné — le navigateur ne reçoit jamais
 * l'ensemble des contacts.
 */
export async function findContacts(search: string): Promise<ContactPickerOption[]> {
  await getWorkspaceIdForAction();

  const parsed = contactSearchSchema.safeParse(search);
  if (!parsed.success) return [];

  return searchContactOptions(parsed.data);
}
