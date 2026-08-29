/** Navigation principale de NOD CRM. */
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
      { label: "Organisations", href: "/organizations", available: true, icon: "▤" },
      { label: "Commerce", href: "/commerce", available: true, icon: "◇" },
    ],
  },
  {
    title: "Conformité",
    items: [{ label: "RGPD", href: "/rgpd", available: true, icon: "◈" }],
  },
];
