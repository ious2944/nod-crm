/**
 * Navigation du CRM.
 *
 * Les entrées `available: false` sont affichées désactivées : elles annoncent la
 * suite (Organisations, Dashboard) sans faire croire qu'un module existe déjà.
 * En V0.2, Contacts rejoint Follow-up parmi les modules réellement développés ;
 * en V0.3, le cockpit « Aujourd'hui » prend la tête de la navigation — c'est
 * l'écran par lequel on entre dans l'application.
 */
export interface NavItem {
  label: string;
  href?: string;
  available: boolean;
  icon: string;
}

export interface NavSection {
  title: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: null,
    items: [
      { label: "Aujourd'hui", href: "/today", available: true, icon: "◉" },
      { label: "Dashboard", available: false, icon: "◎" },
    ],
  },
  {
    title: "CRM",
    items: [
      { label: "Contacts", href: "/contacts", available: true, icon: "◍" },
      { label: "Organisations", available: false, icon: "▤" },
    ],
  },
  {
    title: "Pilotage",
    // « Suivis » plutôt que « Follow-up » : à côté d'« Aujourd'hui », ce qui
    // doit se comprendre d'un coup d'œil c'est la relation entre les deux
    // entrées — la journée d'un côté, la liste complète de l'autre. Le nom du
    // module reste affiché sous la marque, en tête de barre latérale.
    items: [{ label: "Suivis", href: "/follow-ups", available: true, icon: "🏓" }],
  },
];
