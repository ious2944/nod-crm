/**
 * Règles du cockpit « Aujourd'hui ».
 *
 * Le module Follow-up sait déjà dire, suivi par suivi, où en est une échéance
 * (`src/lib/follow-ups/domain.ts`). Le cockpit répond à une autre question :
 * **dans tout ce qui est ouvert, qu'est-ce que je regarde en premier ?**
 *
 * Tout est ici en fonctions pures — aucune requête, aucun JSX — pour que la
 * priorisation soit testable seule (`domain.test.ts`) et qu'un futur
 * automatisme (rappel, digest e-mail, Mirai) puisse la réutiliser telle quelle
 * sans passer par la page.
 */

import { daysBetween } from "@/lib/date";
import type { BallOwner, FollowUpStatus } from "@/lib/follow-ups/domain";

/** Fenêtre de la section « Prochainement » — et du compteur « À venir ». */
export const UPCOMING_WINDOW_DAYS = 7;

/**
 * Au-delà de ce délai sans le moindre mouvement, un suivi confié à quelqu'un
 * d'autre « refroidit ». Aligné sur `CRITICAL_OVERDUE_DAYS` : une semaine est
 * déjà le seuil à partir duquel le module considère qu'un sujet dérape.
 */
export const STAGNATION_DAYS = 7;

/**
 * Espace insécable entre le nombre et son unité — la règle typographique
 * française, et accessoirement ce qui empêche « 26 » et « j » d'atterrir sur
 * deux lignes différentes dans une colonne étroite.
 */
const NON_BREAKING_SPACE = " ";

/** Le feed reste lisible : au-delà, on renvoie vers la liste complète. */
export const FEED_LIMIT = 12;

/** Les sections secondaires donnent le pouls, pas l'inventaire. */
export const SECTION_LIMIT = 5;

/**
 * Pourquoi ce suivi apparaît dans le feed. C'est aussi son rang de priorité :
 * l'ordre de ce type est l'ordre d'affichage.
 */
export type FeedReason = "late" | "today" | "stagnant" | "upcoming" | "later";

const REASON_RANK: Record<FeedReason, number> = {
  late: 0,
  today: 1,
  stagnant: 2,
  upcoming: 3,
  // « later » n'entre jamais dans le feed par défaut : il n'existe que pour
  // qu'un suivi ouvert lointain reste classable lorsqu'un filtre le rappelle.
  later: 4,
};

/**
 * Les motifs qui appellent une action *aujourd'hui*, et eux seuls, composent le
 * feed par défaut.
 *
 * `upcoming` en est sorti après revue : la section « Prochainement » affiche
 * exactement la même fenêtre de sept jours, sur le même écran, dans le même
 * ordre. Sur un jeu réaliste, un quart du feed était donc une relecture de la
 * colonne d'à côté — et cette relecture occupait le bas du feed, là où l'œil
 * arrive en dernier, pour des suivis qui ne demandent justement rien
 * maintenant. Ils restent atteignables d'un clic par l'indicateur « À venir ».
 */
const ACTIONABLE_NOW: readonly FeedReason[] = ["late", "today", "stagnant"];

export function isActionableNow(reason: FeedReason): boolean {
  return ACTIONABLE_NOW.includes(reason);
}

const REASON_LABEL: Record<FeedReason, string> = {
  late: "En retard",
  today: "Aujourd'hui",
  stagnant: "Sans mouvement",
  upcoming: "À venir",
  later: "Plus tard",
};

export function reasonLabel(reason: FeedReason): string {
  return REASON_LABEL[reason];
}

/**
 * Les seuls signaux dont dépend la priorisation.
 *
 * Volontairement réduit : ni titre, ni contact, ni identifiant. Ce qui décide
 * de l'ordre tient en quatre nombres, et se teste en quatre nombres.
 */
export interface CockpitSignals {
  status: FollowUpStatus;
  ballOwner: BallOwner;
  /** > 0 : en retard. 0 : dû aujourd'hui. < 0 : encore du temps. */
  overdueDays: number;
  /** Jours écoulés depuis le dernier mouvement enregistré. */
  idleDays: number;
}

/**
 * Ancienneté du dernier mouvement, en jours calendaires.
 *
 * **Ce que mesure exactement ce nombre.** `updated_at` est réécrit par
 * PostgreSQL à chaque `UPDATE` de la ligne : relance, balle rendue, report,
 * clôture. Il date donc le dernier geste enregistré sur le suivi — ni plus, ni
 * moins. C'est une borne *basse* de l'attente réelle : un suivi confié il y a
 * trente jours puis reporté hier affiche « sans mouvement depuis 1 jour ».
 *
 * On sous-estime donc parfois, on ne surestime jamais. C'est le compromis
 * assumé pour ne pas ajouter de colonne (voir `docs/cockpit.md`).
 */
export function computeIdleDays(updatedAt: Date, now: Date, timeZone: string): number {
  return Math.max(0, daysBetween(updatedAt, now, timeZone));
}

/**
 * « Rotting » de Pipedrive, version NOD CRM : la balle est chez eux et rien
 * n'a bougé depuis assez longtemps pour que ça devienne préoccupant.
 *
 * Un suivi peut être parfaitement dans les temps et malgré tout stagner —
 * c'est précisément le cas que le tableau Follow-up ne montrait pas.
 */
export function isStagnant(signals: CockpitSignals): boolean {
  return (
    signals.status === "OPEN" &&
    signals.ballOwner === "THEM" &&
    signals.idleDays >= STAGNATION_DAYS
  );
}

/**
 * Ancienneté du dernier mouvement, en clair. Toujours affichable.
 *
 * Même abréviation que `stagnationLabel` : les deux se côtoient dans la même
 * liste, et « 4 jours » à côté de « 26 j » se lisait comme deux unités
 * différentes — en plus de faire passer la ligne sur deux lignes.
 */
export function idleLabel(idleDays: number): string {
  if (idleDays <= 0) return "Mouvement aujourd'hui";
  return `Sans mouvement depuis ${idleDays}${NON_BREAKING_SPACE}j`;
}

/** Étiquette d'alerte, affichée seulement quand le seuil est franchi. */
export function stagnationLabel(idleDays: number): string | null {
  if (idleDays < STAGNATION_DAYS) return null;
  return `Sans mouvement depuis ${idleDays}${NON_BREAKING_SPACE}j`;
}

/**
 * Classement d'un suivi dans le feed.
 *
 * L'ordre des tests EST l'ordre de priorité voulu : les retards d'abord, puis
 * la journée, puis ce qui refroidit, puis ce qui arrive. Un suivi clos ne
 * revient jamais (`null`).
 */
export function feedReason(signals: CockpitSignals): FeedReason | null {
  if (signals.status !== "OPEN") return null;
  if (signals.overdueDays >= 1) return "late";
  if (signals.overdueDays === 0) return "today";
  if (isStagnant(signals)) return "stagnant";
  if (signals.overdueDays >= -UPCOMING_WINDOW_DAYS) return "upcoming";
  return "later";
}

/** Ce qui départage deux suivis d'un même groupe. Toujours « le pire d'abord ». */
export interface FeedOrderKey extends CockpitSignals {
  reason: FeedReason;
  /** Départage final, pour que l'ordre ne dépende pas de celui de la base. */
  id: string;
}

function severity(item: FeedOrderKey): number {
  switch (item.reason) {
    case "late":
      // Le plus en retard en premier.
      return item.overdueDays;
    case "today":
    case "stagnant":
      // À échéance égale, le sujet le plus figé passe devant.
      return item.idleDays;
    case "upcoming":
    case "later":
      // `overdueDays` est négatif ici : -1 (demain) passe avant -6.
      return item.overdueDays;
  }
}

export function compareFeed(a: FeedOrderKey, b: FeedOrderKey): number {
  return (
    REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
    severity(b) - severity(a) ||
    a.id.localeCompare(b.id)
  );
}

/** Tri de la section « En attente chez eux » : la plus longue attente d'abord. */
export function compareWaiting(a: FeedOrderKey, b: FeedOrderKey): number {
  return b.idleDays - a.idleDays || b.overdueDays - a.overdueDays || a.id.localeCompare(b.id);
}

/** Tri de la section « Prochainement » : l'échéance la plus proche d'abord. */
export function compareUpcoming(a: FeedOrderKey, b: FeedOrderKey): number {
  return b.overdueDays - a.overdueDays || a.id.localeCompare(b.id);
}

/**
 * Prénom d'accueil.
 *
 * `displayName` est facultatif en base : sans lui on retombe sur la partie
 * locale de l'e-mail, ce qui reste plus personnel que « Bonjour ».
 */
export function greetingName(displayName: string | null, email: string): string {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return email.split("@")[0] || email;
}
