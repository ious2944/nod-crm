import type { CockpitSection as CockpitSectionData } from "@/lib/cockpit/queries";
import { CockpitSection } from "./cockpit-section";
import { CompactFollowUpRow } from "./compact-row";
import { FollowUpActionRow } from "./follow-up-action-row";

/**
 * « En attente chez eux » — la balle n'est pas dans mon camp.
 *
 * Triée par attente la plus longue en premier : c'est là que se trouvent les
 * demandes qui refroidissent, celles dont l'échéance ne dit encore rien mais
 * qui n'ont pas bougé depuis trop longtemps. Une seule action est proposée,
 * la seule qui ait du sens ici : relancer.
 */
export function WaitingFollowUps({ section }: { section: CockpitSectionData }) {
  return (
    <CockpitSection
      title="En attente chez eux"
      count={section.total}
      moreHref="/follow-ups?f=them"
      moreLabel="Tout voir"
      empty="Aucune réponse en attente."
    >
      {section.items.length > 0 ? (
        <ul className="space-y-1.5">
          {section.items.map((item) => (
            <li key={item.id}>
              <CompactFollowUpRow
                item={item}
                note={item.stagnationLabel ? `⚠ ${item.stagnationLabel}` : item.idleLabel}
                trailing={<FollowUpActionRow item={item} compact />}
              />
            </li>
          ))}
        </ul>
      ) : undefined}
    </CockpitSection>
  );
}
