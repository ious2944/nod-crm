/** Navigation principale de NOD CRM. */
import type { ComponentType } from "react";
import {
  Briefcase,
  Building2,
  CheckSquare,
  Clock,
  ShieldCheck,
  Sun,
  Users,
} from "lucide-react";

export interface NavItem {
  label: string;
  href?: string;
  available: boolean;
  icon: ComponentType<{ className?: string }>;
}

export interface NavSection {
  title: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Pilotage",
    items: [
      { label: "Aujourd'hui", href: "/today", available: true, icon: Sun },
      { label: "Suivis", href: "/follow-ups", available: true, icon: Clock },
      { label: "Tâches", href: "/tasks", available: true, icon: CheckSquare },
    ],
  },
  {
    title: "CRM",
    items: [
      { label: "Contacts", href: "/contacts", available: true, icon: Users },
      { label: "Organisations", href: "/organizations", available: true, icon: Building2 },
      { label: "Commerce", href: "/commerce", available: true, icon: Briefcase },
    ],
  },
  {
    title: "Conformité",
    items: [{ label: "RGPD", href: "/rgpd", available: true, icon: ShieldCheck }],
  },
];
