import type { CustomFieldDef } from "@/lib/tasks/types";

/** Colonnes de la vue Liste. `name` est toujours affichée, en premier. */
export interface ColumnDef {
  id: string;
  label: string;
  width: number;
  min: number;
}

export const BASE_COLUMNS: ColumnDef[] = [
  { id: "assignee", label: "Responsable", width: 150, min: 90 },
  { id: "due", label: "Échéance", width: 130, min: 90 },
  { id: "start", label: "Début", width: 100, min: 80 },
  { id: "status", label: "Statut", width: 110, min: 90 },
  { id: "priority", label: "Priorité", width: 100, min: 80 },
  { id: "tags", label: "Tags", width: 150, min: 80 },
  { id: "projects", label: "Projets", width: 160, min: 90 },
  { id: "estimate", label: "Estimé", width: 80, min: 64 },
  { id: "spent", label: "Passé", width: 80, min: 64 },
  { id: "created", label: "Créée le", width: 100, min: 80 },
];

export const DEFAULT_PROJECT_COLUMNS = ["assignee", "due", "status", "priority", "tags"];
export const DEFAULT_MY_COLUMNS = ["due", "projects", "status", "priority"];

export function allColumns(fields: CustomFieldDef[]): ColumnDef[] {
  return [
    ...BASE_COLUMNS,
    ...fields.map((f) => ({ id: `field:${f.id}`, label: f.name, width: 130, min: 80 })),
  ];
}

export const NAME_MIN = 220;

/** Préférences locales d'affichage (largeurs, colonnes) : confort par appareil. */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée) : sans conséquence
  }
}
