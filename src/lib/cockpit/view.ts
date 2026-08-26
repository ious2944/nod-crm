/**
 * Modèle d'affichage du cockpit.
 *
 * Les composants ne reçoivent que des objets sérialisables, déjà mis en forme :
 * aucune `Date`, aucun calcul restant. Le découpage suit celui des modules
 * existants (`follow-ups/view.ts`, `contacts/view.ts`).
 *
 * **Extensibilité.** Le contact n'est pas une chaîne mais une `ContactRef` :
 * un objet qui porte déjà son identifiant, son lien de fiche et son
 * organisation. Rendre une entreprise cliquable ou accrocher une note à une
 * ligne ne demandera donc pas de retoucher les composants qui affichent un
 * contact — seulement d'enrichir cette structure.
 */

import { contactDisplayName, contactInitials } from "@/lib/contacts/view";
import type { BallOwner, FollowUpStatus, UrgencyLevel } from "@/lib/follow-ups/domain";
import { toFollowUpView } from "@/lib/follow-ups/view";
import {
  computeIdleDays,
  feedReason,
  idleLabel,
  stagnationLabel,
  type FeedReason,
} from "./domain";

/**
 * Date du jour, en toutes lettres, **dans le fuseau de l'application**.
 *
 * Le serveur peut tourner en UTC : sans `timeZone` explicite, un utilisateur
 * parisien verrait encore la veille jusqu'à 2 h du matin.
 */
export function todayLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

/** Le contact tel que le cockpit le lit. `email` sert de nom de repli. */
export interface CockpitContactRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  organizationName: string | null;
  archivedAt: Date | null;
}

/** Les colonnes de `follow_ups` réellement utilisées ici. */
export interface CockpitRecord {
  id: string;
  title: string;
  description: string | null;
  status: FollowUpStatus;
  ballOwner: BallOwner;
  dueAt: Date;
  nudgeCount: number;
  lastNudgedAt: Date | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  contact: CockpitContactRecord | null;
}

/**
 * Référence à un interlocuteur.
 *
 * `href` est déjà renseigné : la fiche contact existe depuis la V0.2, donc le
 * nom est cliquable dès maintenant. `organizationHref` reste `null` tant que
 * les organisations ne sont pas des entités — la place est prise, pas remplie.
 */
export interface ContactRef {
  id: string | null;
  name: string;
  initials: string;
  href: string | null;
  organizationName: string | null;
  organizationHref: string | null;
  archived: boolean;
}

/** Une ligne du cockpit, quelle que soit la section qui l'affiche. */
export interface CockpitItem {
  id: string;
  title: string;
  status: FollowUpStatus;
  ballOwner: BallOwner;
  ballLabel: string;
  /** `J+11`, `Aujourd'hui`, `Demain`, `Dans 4 j`. */
  dueLabel: string;
  level: UrgencyLevel;
  overdueDays: number;
  idleDays: number;
  /** Ancienneté du dernier mouvement, en clair. Toujours renseigné. */
  idleLabel: string;
  /** Alerte de stagnation : `null` tant que le seuil n'est pas franchi. */
  stagnationLabel: string | null;
  ageLabel: string;
  nudgeLabel: string | null;
  reason: FeedReason;
  contact: ContactRef;
  isDemo: boolean;
}

const NO_CONTACT: ContactRef = {
  id: null,
  name: "Sans contact",
  initials: "—",
  href: null,
  organizationName: null,
  organizationHref: null,
  archived: false,
};

export function toContactRef(contact: CockpitContactRecord | null): ContactRef {
  if (!contact) return NO_CONTACT;

  return {
    id: contact.id,
    name: contactDisplayName(contact),
    initials: contactInitials(contact),
    href: `/contacts/${contact.id}`,
    organizationName: contact.organizationName,
    organizationHref: null,
    archived: contact.archivedAt != null,
  };
}

/**
 * Un enregistrement devient une ligne de cockpit.
 *
 * Le calendrier (retard, étiquette d'échéance, ancienneté) est délégué au
 * module Follow-up : le cockpit n'a pas sa propre notion du temps, il ajoute
 * seulement la stagnation et le motif de présence.
 */
export function toCockpitItem(
  record: CockpitRecord,
  now: Date,
  timeZone: string,
): CockpitItem {
  const view = toFollowUpView(record, now, timeZone);
  const idleDays = computeIdleDays(record.updatedAt, now, timeZone);

  const signals = {
    status: record.status,
    ballOwner: record.ballOwner,
    overdueDays: view.overdueDays,
    idleDays,
  };

  return {
    id: record.id,
    title: record.title,
    status: record.status,
    ballOwner: record.ballOwner,
    ballLabel: view.ballLabel,
    dueLabel: view.dueLabel,
    level: view.level,
    overdueDays: view.overdueDays,
    idleDays,
    idleLabel: idleLabel(idleDays),
    stagnationLabel: record.ballOwner === "THEM" ? stagnationLabel(idleDays) : null,
    ageLabel: view.ageLabel,
    nudgeLabel: view.nudgeLabel,
    // Un suivi clos n'a pas de motif ; la requête du cockpit ne lit que les
    // suivis ouverts, ce repli n'est donc qu'une sécurité de typage.
    reason: feedReason(signals) ?? "later",
    contact: toContactRef(record.contact),
    isDemo: record.isDemo,
  };
}
