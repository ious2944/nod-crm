export const LEGAL_BASES = [
  ["CONSENT", "Consentement"],
  ["CONTRACT", "Contrat"],
  ["LEGAL_OBLIGATION", "Obligation légale"],
  ["LEGITIMATE_INTEREST", "Intérêt légitime"],
  ["PUBLIC_TASK", "Mission d’intérêt public"],
  ["VITAL_INTERESTS", "Intérêts vitaux"],
  ["TO_DETERMINE", "À déterminer"],
] as const;

export const TREATMENT_STATUSES = [
  ["ACTIVE", "Actif"],
  ["REVIEW", "À revoir"],
  ["ARCHIVED", "Archivé"],
] as const;

export const DPA_STATUSES = [
  ["SIGNED", "Signé"],
  ["TO_REVIEW", "À vérifier"],
  ["MISSING", "Manquant"],
  ["NOT_APPLICABLE", "Non applicable"],
] as const;

export const EEA_STATUSES = [
  ["YES", "Oui"],
  ["NO", "Non"],
  ["UNKNOWN", "Inconnu"],
] as const;

export const TRI_STATES = [
  ["YES", "Oui"],
  ["NO", "Non"],
  ["UNKNOWN", "Inconnu"],
] as const;

export const REQUEST_TYPES = [
  ["ACCESS", "Accès"],
  ["RECTIFICATION", "Rectification"],
  ["ERASURE", "Effacement"],
  ["OBJECTION", "Opposition"],
  ["RESTRICTION", "Limitation"],
  ["PORTABILITY", "Portabilité"],
  ["OTHER", "Autre"],
] as const;

export const REQUEST_STATUSES = [
  ["RECEIVED", "Reçue"],
  ["IN_PROGRESS", "En cours"],
  ["WAITING", "En attente"],
  ["COMPLETED", "Terminée"],
  ["REFUSED", "Refusée"],
] as const;

export const INCIDENT_RISK_LEVELS = [
  ["TO_ASSESS", "À évaluer"],
  ["LOW", "Faible"],
  ["MODERATE", "Modéré"],
  ["HIGH", "Élevé"],
] as const;

export const INCIDENT_DECISIONS = [
  ["TO_ASSESS", "À évaluer"],
  ["NO", "Non"],
  ["YES", "Oui"],
] as const;

export const INCIDENT_STATUSES = [
  ["OPEN", "Ouvert"],
  ["ANALYSIS", "En analyse"],
  ["CLOSED", "Clos"],
] as const;

export function labelFor(
  entries: readonly (readonly [string, string])[],
  value: string | null | undefined,
) {
  return entries.find(([key]) => key === value)?.[1] ?? value ?? "—";
}
