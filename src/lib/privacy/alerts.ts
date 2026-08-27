export type PrivacyAlertSeverity = "urgent" | "warning" | "info";

export interface PrivacyAlert {
  key: string;
  severity: PrivacyAlertSeverity;
  title: string;
  detail: string;
  href: string;
}

interface TreatmentLike {
  id: string;
  name: string;
  legalBasis: string;
  retentionPeriod: string | null;
  nextReviewAt: Date | null;
  archivedAt: Date | null;
}

interface ProcessorLike {
  id: string;
  name: string;
  dpaStatus: string;
  eeaStatus: string;
  nextReviewAt: Date | null;
  archivedAt: Date | null;
}

interface RequestLike {
  id: string;
  requestType: string;
  requesterName: string | null;
  requesterEmail: string | null;
  dueAt: Date;
  status: string;
}

interface IncidentLike {
  id: string;
  title: string;
  status: string;
  riskLevel: string;
  authorityNotification: string;
}

const DAY = 86_400_000;

export function buildPrivacyAlerts(input: {
  treatments: TreatmentLike[];
  processors: ProcessorLike[];
  requests: RequestLike[];
  incidents: IncidentLike[];
  now?: Date;
}): PrivacyAlert[] {
  const now = input.now ?? new Date();
  const soon = new Date(now.getTime() + 7 * DAY);
  const alerts: PrivacyAlert[] = [];

  for (const treatment of input.treatments) {
    if (treatment.archivedAt) continue;
    if (treatment.legalBasis === "TO_DETERMINE") {
      alerts.push({
        key: `treatment-legal-${treatment.id}`,
        severity: "warning",
        title: `Base légale à renseigner — ${treatment.name}`,
        detail: "Le registre doit documenter le fondement juridique retenu.",
        href: "/rgpd/treatments",
      });
    }
    if (!treatment.retentionPeriod?.trim()) {
      alerts.push({
        key: `treatment-retention-${treatment.id}`,
        severity: "warning",
        title: `Conservation à définir — ${treatment.name}`,
        detail: "Aucune durée ou règle de conservation n'est documentée.",
        href: "/rgpd/treatments",
      });
    }
    if (treatment.nextReviewAt && treatment.nextReviewAt < now) {
      alerts.push({
        key: `treatment-review-${treatment.id}`,
        severity: "warning",
        title: `Revue dépassée — ${treatment.name}`,
        detail: "La date de prochaine revue du traitement est passée.",
        href: "/rgpd/treatments",
      });
    }
  }

  for (const processor of input.processors) {
    if (processor.archivedAt) continue;
    if (processor.dpaStatus === "MISSING") {
      alerts.push({
        key: `processor-dpa-${processor.id}`,
        severity: "warning",
        title: `DPA manquant — ${processor.name}`,
        detail: "Le cadre contractuel du sous-traitant doit être vérifié.",
        href: "/rgpd/processors",
      });
    } else if (processor.dpaStatus === "TO_REVIEW") {
      alerts.push({
        key: `processor-dpa-review-${processor.id}`,
        severity: "info",
        title: `DPA à vérifier — ${processor.name}`,
        detail: "Le statut du contrat de sous-traitance reste à confirmer.",
        href: "/rgpd/processors",
      });
    }
    if (processor.eeaStatus === "UNKNOWN" || processor.eeaStatus === "NO") {
      alerts.push({
        key: `processor-eea-${processor.id}`,
        severity: "warning",
        title: `Localisation / transfert à vérifier — ${processor.name}`,
        detail:
          processor.eeaStatus === "UNKNOWN"
            ? "La localisation du traitement n'est pas documentée."
            : "Le traitement est indiqué hors EEE : documente les garanties applicables.",
        href: "/rgpd/processors",
      });
    }
    if (processor.nextReviewAt && processor.nextReviewAt < now) {
      alerts.push({
        key: `processor-review-${processor.id}`,
        severity: "warning",
        title: `Revue prestataire dépassée — ${processor.name}`,
        detail: "La date de prochaine vérification est passée.",
        href: "/rgpd/processors",
      });
    }
  }

  for (const request of input.requests) {
    if (request.status === "COMPLETED" || request.status === "REFUSED") continue;
    const identity = request.requesterName || request.requesterEmail || "Demande RGPD";
    if (request.dueAt < now) {
      const lateDays = Math.max(1, Math.ceil((now.getTime() - request.dueAt.getTime()) / DAY));
      alerts.push({
        key: `request-late-${request.id}`,
        severity: "urgent",
        title: `Demande en retard — ${identity}`,
        detail: `Échéance dépassée de ${lateDays} jour${lateDays > 1 ? "s" : ""}.`,
        href: "/rgpd/requests",
      });
    } else if (request.dueAt <= soon) {
      const remaining = Math.max(0, Math.ceil((request.dueAt.getTime() - now.getTime()) / DAY));
      alerts.push({
        key: `request-soon-${request.id}`,
        severity: "warning",
        title: `Demande proche de l'échéance — ${identity}`,
        detail: `Échéance dans ${remaining} jour${remaining > 1 ? "s" : ""}.`,
        href: "/rgpd/requests",
      });
    }
  }

  for (const incident of input.incidents) {
    if (incident.status === "CLOSED") continue;
    if (incident.riskLevel === "TO_ASSESS" || incident.authorityNotification === "TO_ASSESS") {
      alerts.push({
        key: `incident-assess-${incident.id}`,
        severity: "urgent",
        title: `Incident à évaluer — ${incident.title}`,
        detail: "Le niveau de risque ou la décision de notification reste à documenter.",
        href: "/rgpd/incidents",
      });
    } else {
      alerts.push({
        key: `incident-open-${incident.id}`,
        severity: "warning",
        title: `Incident ouvert — ${incident.title}`,
        detail: "L'incident n'est pas encore clôturé.",
        href: "/rgpd/incidents",
      });
    }
  }

  const rank: Record<PrivacyAlertSeverity, number> = { urgent: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
}
