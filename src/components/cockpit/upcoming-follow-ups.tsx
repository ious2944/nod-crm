import { UPCOMING_WINDOW_DAYS } from "@/lib/cockpit/domain";
import type { CockpitSection as CockpitSectionData } from "@/lib/cockpit/queries";
import { CockpitSection } from "./cockpit-section";
import { CompactFollowUpRow } from "./compact-row";

/**
 * « Prochainement » — la semaine qui vient, rien de plus.
 *
 * Volontairement sans boutons : ces suivis n'appellent aucune action
 * aujourd'hui. Leur rôle est d'éviter la surprise, pas d'ajouter du travail.
 */
export function UpcomingFollowUps({ section }: { section: CockpitSectionData }) {
  return (
    <CockpitSection
      title={`Prochainement (${UPCOMING_WINDOW_DAYS} j)`}
      count={section.total}
      moreHref="/follow-ups"
      moreLabel="Tous les suivis"
      empty="Aucun suivi prévu cette semaine."
    >
      {section.items.length > 0 ? (
        <ul className="space-y-1.5">
          {section.items.map((item) => (
            <li key={item.id}>
              <CompactFollowUpRow item={item} />
            </li>
          ))}
        </ul>
      ) : undefined}
    </CockpitSection>
  );
}
