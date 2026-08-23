/**
 * Réglages globaux de la V0.1.
 *
 * Tout ce qui est ici est lu côté serveur uniquement. Aucune valeur n'est
 * inlinée dans le bundle client : une image Docker publiée peut donc être
 * reconfigurée sans reconstruction (`APP_NAME`, `APP_TIME_ZONE`).
 */

/**
 * Nom affiché de l'instance. Permet à une organisation qui auto-héberge NOD CRM
 * de mettre son propre nom dans l'interface sans toucher au code.
 */
export const APP_NAME = process.env.APP_NAME?.trim() || "NOD CRM";

/**
 * Nom du module métier de la V0.1. NOD CRM est le socle ; Follow-Up en est la
 * première brique.
 */
export const MODULE_NAME = "Follow-Up";

/**
 * Lien « Source » affiché dans l'interface.
 *
 * NOD CRM est sous AGPL-3.0 : son article 13 impose à qui modifie le programme
 * et le rend accessible par le réseau d'offrir aux utilisateurs de cette
 * instance le code source correspondant. Un lien visible est le moyen le plus
 * simple de tenir cette obligation — d'où cette variable, que tout
 * auto-hébergeur ayant modifié le code doit pointer vers SON dépôt.
 */
export const APP_SOURCE_URL =
  process.env.APP_SOURCE_URL?.trim() || "https://github.com/ious2944/nod-crm";

/**
 * Fuseau utilisé pour raisonner « à la journée » (échéance, J+3, retard).
 * Le serveur peut tourner en UTC : on ne veut pas que « aujourd'hui » dépende de ça.
 */
export const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Europe/Paris";
