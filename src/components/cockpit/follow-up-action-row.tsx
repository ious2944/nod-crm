import { CardActions, QuickAction } from "@/components/follow-ups/quick-actions";
import type { CockpitItem } from "@/lib/cockpit/view";

/**
 * Agir depuis le cockpit, sans changer d'écran.
 *
 * **Aucune logique métier n'est écrite ici.** Ces boutons sont exactement ceux
 * du tableau Follow-up (`components/follow-ups/quick-actions.tsx`) et
 * aboutissent à la même Server Action, donc à la même machine à états, aux
 * mêmes gardes de transition et au même contrôle de workspace. Le cockpit est
 * une nouvelle *vue* sur le module, pas une seconde implémentation — c'est
 * aussi ce qui permettra à une future automatisation d'appeler la même
 * fonction sans passer par l'interface.
 */
export function FollowUpActionRow({
  item,
  compact = false,
}: {
  item: CockpitItem;
  /** `true` : seule l'action principale est proposée (listes denses). */
  compact?: boolean;
}) {
  // Dans les listes denses, l'action reste discrète : le feed garde le seul
  // appel à l'action franc de la page, sinon plus rien ne ressort.
  const primary = compact ? "default" : "primary";

  const themActions = (
    <>
      <QuickAction
        id={item.id}
        intent="nudge"
        label="Relancer"
        variant={primary}
        title="Noter une relance — l'échéance repart à +3 jours"
      />
      {!compact && (
        <QuickAction
          id={item.id}
          intent="received"
          label="Reçu"
          title="Ils ont répondu — la balle revient chez moi"
        />
      )}
    </>
  );

  const meActions = (
    <QuickAction
      id={item.id}
      intent="handoff"
      label="Balle envoyée"
      variant={primary}
      title="J'ai fait ma part — la balle repart chez eux"
    />
  );

  return (
    <CardActions>
      {item.ballOwner === "THEM" ? themActions : meActions}
      {!compact && <QuickAction id={item.id} intent="complete" label="Terminer" />}
    </CardActions>
  );
}
