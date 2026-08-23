// `server-only` lève une erreur hors du contexte serveur de Next. Sous Vitest,
// on l'aliase vers ce module vide : les tests exécutent bien du code serveur,
// simplement pas dans le runtime de Next.
export {};
