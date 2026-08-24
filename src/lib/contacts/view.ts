/**
 * Mise en forme d'un contact pour l'affichage.
 *
 * Même découpage que `src/lib/follow-ups/view.ts` : les composants React
 * reçoivent des objets sérialisables et sans logique restante, et toute la
 * logique d'affichage est ici, en fonctions pures testables
 * (`view.test.ts`).
 */

export interface ContactIdentity {
  firstName: string;
  lastName: string;
  email: string | null;
  organizationName: string | null;
}

/** Ce qu'une ligne de la liste Contacts a besoin de connaître. */
export interface ContactListItem {
  id: string;
  displayName: string;
  initials: string;
  photoUrl: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  /** Suivis ouverts. Calculé par agrégation, jamais contact par contact. */
  openFollowUps: number;
  /** Suivis terminés ou abandonnés. */
  closedFollowUps: number;
  followUpLabel: string;
  archived: boolean;
  /** De quoi pré-remplir le dialogue d'édition depuis la liste, sans relecture. */
  form: ContactFormValues;
}

/**
 * Nom affiché.
 *
 * Un contact peut n'avoir ni prénom ni nom (la règle de création n'exige qu'un
 * élément d'identification parmi quatre) : on retombe alors sur l'email, puis
 * sur l'organisation, plutôt que d'afficher une ligne vide.
 */
export function contactDisplayName(contact: ContactIdentity): string {
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  if (name) return name;
  if (contact.email) return contact.email;
  if (contact.organizationName) return contact.organizationName;
  return "Contact sans nom";
}

/** Initiales de l'avatar par défaut, quand aucune photo n'a été envoyée. */
export function contactInitials(contact: ContactIdentity): string {
  const first = contact.firstName.trim()[0] ?? "";
  const last = contact.lastName.trim()[0] ?? "";
  const fromName = (first + last).toUpperCase();
  if (fromName) return fromName;

  const fallback = contactDisplayName(contact).trim()[0] ?? "";
  return fallback.toUpperCase() || "?";
}

/**
 * URL de la photo.
 *
 * Elle passe par un gestionnaire de route qui revérifie session et workspace :
 * un fichier de photo n'est jamais servi en statique. La clé de stockage sert
 * de jeton de version (`?v=`) pour que le navigateur ne garde pas l'ancienne
 * image après un changement de photo.
 */
export function contactPhotoUrl(id: string, photoKey: string | null): string | null {
  if (!photoKey) return null;
  const version = photoKey.split("/").at(-1)?.split(".")[0] ?? "";
  return `/api/contacts/${id}/photo?v=${encodeURIComponent(version)}`;
}

/** « Aucun suivi » / « 1 suivi actif » / « 3 suivis actifs ». */
export function followUpLabel(openCount: number, closedCount: number): string {
  if (openCount === 1) return "1 suivi actif";
  if (openCount > 1) return `${openCount} suivis actifs`;
  // Distinguer « jamais eu de suivi » de « tout est clos » évite de faire
  // croire qu'un historique a disparu.
  return closedCount > 0 ? "Aucun suivi actif" : "Aucun suivi";
}

/** Ligne secondaire : « EASYLAB · Responsable commercial ». */
export function contactSubtitle(
  organizationName: string | null,
  jobTitle: string | null,
): string | null {
  return [organizationName, jobTitle].filter(Boolean).join(" · ") || null;
}

/**
 * Valeurs pré-remplies du formulaire d'édition.
 *
 * Le même dialogue sert à créer et à modifier : en création il reçoit
 * `undefined`, en modification cet objet. Un seul formulaire, donc une seule
 * mise en page et une seule liste de champs à maintenir.
 */
export interface ContactFormValues {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  organizationName: string | null;
  notes: string | null;
  photoUrl: string | null;
}
