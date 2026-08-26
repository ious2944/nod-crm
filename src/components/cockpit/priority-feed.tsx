import Link from "next/link";

import type { CockpitSection as CockpitSectionData } from "@/lib/cockpit/queries";
import { FEED_LIMIT } from "@/lib/cockpit/domain";
import { COCKPIT_FILTERS, type CockpitFilter } from "@/lib/cockpit/filters";
import { CockpitSection } from "./cockpit-section";
import { FollowUpRow } from "./follow-up-row";

/**
 * Le feed « À traiter ».
 *
 * C'est le cœur du cockpit, et le principe retenu de Pipedrive Pulse : au lieu
 * de faire parcourir plusieurs écrans, on mélange dans une même liste ce qui est
 * réellement prioritaire — retards, journée, sujets qui refroidissent, échéances
 * proches — dans cet ordre. L'utilisateur descend la liste, il ne la trie pas.
 */
const EMPTY: Record<CockpitFilter, string> = {
  all: "Rien à traiter pour l'instant. Tout est à jour.",
  late: "Rien en retard.",
  today: "Aucune action prévue aujourd'hui.",
  upcoming: "Aucun suivi prévu cette semaine.",
  waiting: "Aucune réponse en attente.",
};

export function PriorityFeed({
  section,
  filter,
}: {
  section: CockpitSectionData;
  filter: CockpitFilter;
}) {
  const label = COCKPIT_FILTERS.find((entry) => entry.key === filter)?.label;
  const title = filter === "all" ? "À traiter" : `À traiter — ${label}`;
  const hidden = section.total - section.items.length;

  return (
    <CockpitSection title={title} count={section.total} empty={EMPTY[filter]}>
      {section.items.length > 0 ? (
        <>
          <ul className="space-y-2">
            {section.items.map((item) => (
              <li key={item.id}>
                <FollowUpRow item={item} />
              </li>
            ))}
          </ul>

          {hidden > 0 && (
            <p className="mt-2.5 text-center text-xs text-muted">
              {hidden} autre{hidden > 1 ? "s" : ""} suivi{hidden > 1 ? "s" : ""} au-delà des{" "}
              {FEED_LIMIT} premiers —{" "}
              <Link
                href="/follow-ups"
                className="underline-offset-2 hover:text-ink hover:underline"
              >
                voir la liste complète
              </Link>
            </p>
          )}
        </>
      ) : undefined}
    </CockpitSection>
  );
}
