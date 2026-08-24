/**
 * Navigation du CRM.
 *
 * Les entrées `available: false` sont affichées désactivées : elles annoncent la
 * suite (Organisations, Dashboard) sans faire croire qu'un module existe déjà.
 * En V0.2, Contacts rejoint Follow-up parmi les modules réellement développés.
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
    title: "CRM",
    items: [
      { label: "Contacts", href: "/contacts", available: true, icon: "◍" },
      { label: "Organisations", available: false, icon: "▤" },
    ],
  },
  {
    title: "Pilotage",
    items: [{ label: "Follow-up", href: "/follow-ups", available: true, icon: "🏓" }],
  },
];
