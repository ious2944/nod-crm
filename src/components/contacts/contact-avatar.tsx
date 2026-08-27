/**
 * Avatar d'un contact.
 *
 * Sans photo, on affiche les initiales : une pastille vide serait un trou dans
 * la liste. La photo, quand elle existe, passe par `/api/contacts/[id]/photo`,
 * qui revérifie session et workspace.
 *
 * `<img>` et non `next/image`, volontairement : l'optimiseur d'images de Next
 * met en cache sur disque les images qu'il sert, or celles-ci sont des données
 * privées de workspace derrière un contrôle d'accès. Elles sont par ailleurs
 * affichées à 40 ou 80 px, ce que l'optimiseur n'améliorerait pas.
 */

const SIZES = {
  sm: { box: "h-10 w-10", text: "text-xs", pixels: 40 },
  lg: { box: "h-20 w-20", text: "text-xl", pixels: 80 },
} as const;

export function ContactAvatar({
  initials,
  photoUrl,
  size = "sm",
}: {
  initials: string;
  photoUrl: string | null;
  size?: keyof typeof SIZES;
}) {
  const { box, text, pixels } = SIZES[size];

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- voir l'en-tête du fichier.
      <img
        src={photoUrl}
        alt=""
        width={pixels}
        height={pixels}
        loading="lazy"
        decoding="async"
        className={`${box} shrink-0 rounded-full border border-border-subtle object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${box} ${text} grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent`}
    >
      {initials}
    </span>
  );
}
