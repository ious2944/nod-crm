/**
 * Limites de l'import CSV, partagées par le serveur et le formulaire (qui
 * refuse un fichier trop gros avant même de l'envoyer).
 */

/** 2,5 Mo : sous la limite des Server Actions (`bodySizeLimit`, 3 Mo). */
export const IMPORT_MAX_BYTES = 2.5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

export function tooLargeMessage(bytes: number): string {
  return `Le fichier fait ${formatBytes(bytes)} : ${formatBytes(IMPORT_MAX_BYTES)} maximum par import. Découpe l'export en plusieurs fichiers.`;
}
