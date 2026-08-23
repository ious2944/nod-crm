import "server-only";

import { isIP } from "node:net";
import { headers } from "next/headers";

/**
 * IP du client, telle que posée par le reverse proxy.
 *
 * **Seul `X-Real-IP` est accepté.** Nginx le réécrit systématiquement avec
 * `$remote_addr` : sa valeur ne peut donc pas venir du client.
 *
 * `X-Forwarded-For` est délibérément ignoré. Avec la directive habituelle
 * `$proxy_add_x_forwarded_for`, Nginx *ajoute* l'adresse réelle à la fin de ce
 * que le client a envoyé : le premier élément de la liste — celui qu'on serait
 * tenté de lire comme « l'adresse d'origine » — est entièrement contrôlé par
 * l'attaquant. Il suffirait alors d'envoyer un `X-Forwarded-For` différent à
 * chaque essai pour se donner une identité réseau neuve et contourner la
 * limitation de débit par IP.
 *
 * Si `X-Real-IP` est absent ou n'est pas une adresse valide, on renvoie `null` :
 * mieux vaut perdre la limitation par IP — le compteur par compte reste actif —
 * que compter sur une valeur que le client choisit.
 *
 * Sert uniquement à la limitation de débit et à la journalisation, jamais à une
 * décision d'autorisation.
 */
export async function getClientIp(): Promise<string | null> {
  const realIp = (await headers()).get("x-real-ip")?.trim();

  if (!realIp || isIP(realIp) === 0) {
    return null;
  }

  return normalizeIp(realIp);
}

/**
 * Normalise une adresse pour en faire une clé de comptage stable.
 *
 * En IPv6, un fournisseur attribue couramment un /64 entier à un abonné : compter
 * par adresse exacte laisserait un attaquant changer d'adresse à volonté à
 * l'intérieur de son propre préfixe. On agrège donc sur les 64 premiers bits.
 * En IPv4, l'adresse est utilisée telle quelle.
 */
export function normalizeIp(ip: string): string {
  if (isIP(ip) !== 6) return ip;

  // Forme compacte (`::`) : on la déplie avant de tronquer.
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip;
}

function expandIpv6(ip: string): string[] | null {
  const withoutZone = ip.split("%")[0];
  const [head, tail] = withoutZone.split("::");

  const left = head ? head.split(":").filter(Boolean) : [];
  const right = tail ? tail.split(":").filter(Boolean) : [];

  if (!withoutZone.includes("::")) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;

  return [...left, ...Array(missing).fill("0"), ...right];
}
