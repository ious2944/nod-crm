/**
 * Navigation du CRM.
 *
 * Les entrées `available: false` sont affichées désactivées : elles annoncent la
 * suite (Organisations, Dashboard) sans faire croire qu'un module existe déjà.
 *
 * L'ordre de « Pilotage » répond aux deux questions du produit, dans cet ordre :
 * *qu'est-ce qui demande une action maintenant ?* (Aujourd'hui), *qu'est-ce que
 * je dois faire avancer avec quelqu'un ?* (Suivis), *qu'est-ce que je dois
 * faire ?* (Tâches).
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
    items: [{ label: "Dashboard", available: false, icon: "◎" }],
  },
  {
    title: "Pilotage",
    items: [
      { label: "Aujourd'hui", href: "/today", available: true, icon: "☀" },
      { label: "Suivis", href: "/follow-ups", available: true, icon: "🏓" },
      { label: "Tâches", href: "/tasks", available: true, icon: "✓" },
    ],
  },
  {
    title: "CRM",
    items: [
      { label: "Contacts", href: "/contacts", available: true, icon: "◍" },
      { label: "Organisations", available: false, icon: "▤" },
    ],
  },
];
