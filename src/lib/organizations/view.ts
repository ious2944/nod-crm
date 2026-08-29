/**
 * Mise en forme d'une organisation pour l'affichage.
 *
 * Même découpage que `src/lib/contacts/view.ts` : les composants React
 * reçoivent des objets sérialisables et sans logique restante, et toute la
 * logique d'affichage est ici, en fonctions pures testables.
 */

/** Ce qu'une ligne de la liste Organisations affiche. */
export interface OrganizationListItem {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  /** Nombre de contacts actifs (non archivés) rattachés. */
  contactCount: number;
  archived: boolean;
  /** De quoi pré-remplir le dialogue d'édition depuis la liste. */
  form: OrganizationFormValues;
}

/** Ce qu'une fiche organisation affiche. */
export interface OrganizationDetail {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  contacts: OrganizationContact[];
  openFollowUps: OrganizationFollowUp[];
  openTasks: OrganizationTask[];
  openOpportunities: OrganizationOpportunity[];
}

/** Une opportunité vue depuis la fiche organisation (résumé). */
export interface OrganizationOpportunity {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  estimatedAmount: string | null;
}

/** Un contact vu depuis la fiche organisation. */
export interface OrganizationContact {
  id: string;
  displayName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  archived: boolean;
}

/** Un suivi vu depuis la fiche organisation (résumé, pas la fiche complète). */
export interface OrganizationFollowUp {
  id: string;
  title: string;
  contactId: string | null;
  contactName: string | null;
  dueAt: string;
  ballOwner: "ME" | "THEM";
  /** Libellé d'urgence : "Aujourd'hui", "En retard"… */
  ageLabel: string;
  ageTier: "calm" | "soon" | "today" | "late" | "critical";
}

/** Une tâche vue depuis la fiche organisation (résumé). */
export interface OrganizationTask {
  id: string;
  title: string;
  contactId: string | null;
  contactName: string | null;
  dueAt: string;
  ageLabel: string;
  ageTier: "calm" | "soon" | "today" | "late" | "critical";
}

/**
 * Valeurs pré-remplies du formulaire d'édition.
 *
 * Le même dialogue sert à créer et à modifier.
 */
export interface OrganizationFormValues {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

/** « Aucun contact » / « 1 contact » / « 3 contacts ». */
export function organizationContactLabel(count: number): string {
  if (count === 0) return "Aucun contact";
  if (count === 1) return "1 contact";
  return `${count} contacts`;
}

/** Domaine propre depuis une URL (ex. « acme.com » depuis « https://www.acme.com »). */
export function websiteDisplayLabel(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

/** Option du sélecteur d'organisation (formulaire Contact). */
export interface OrganizationPickerOption {
  id: string;
  name: string;
  subtitle: string | null;
}
