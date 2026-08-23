import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (ex-`middleware`, renommé dans Next 16).
 *
 * Deux rôles, et deux seulement :
 *
 * 1. **Filtre optimiste d'authentification.** Il ne regarde que la présence du
 *    cookie, sans interroger la base : le proxy s'exécute sur chaque requête,
 *    y compris les préchargements. La vérification qui fait autorité est dans
 *    la couche d'accès aux données (`src/lib/auth/dal.ts`), au plus près des
 *    données. Un cookie forgé passe ici et échoue là-bas.
 *
 * 2. **En-têtes de sécurité**, dont la CSP avec nonce par requête.
 *
 * HSTS n'est volontairement pas posé ici : il est géré par Nginx, qui est le
 * seul à savoir si la requête est réellement arrivée en HTTPS.
 */

const SESSION_COOKIES = ["__Host-nod_session", "nod_session"];

/**
 * Chemins accessibles sans session.
 *
 * `/api/health` en fait partie par nécessité : la sonde du conteneur n'a pas de
 * cookie. Sans cette entrée, elle serait redirigée vers `/login`, obtiendrait
 * un 200 et déclarerait l'application saine quelle que soit son état réel —
 * une sonde qui ment est pire que pas de sonde. Le contrat est verrouillé par
 * `tests/unit/dockerfile-context.test.ts`. L'exposition publique du chemin est
 * refusée côté Nginx, pas ici.
 */
const PUBLIC_PATHS = ["/login", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value));
}

function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // `strict-dynamic` : seuls les scripts portant le nonce peuvent charger
    // d'autres scripts. En développement, React utilise `eval` pour les traces.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next et `next/font` injectent des styles en ligne sans nonce ; les
    // restreindre casserait le rendu. `style-src-attr` reste bloqué par défaut.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Protection anti-framing : remplace X-Frame-Options, et le surpasse.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!isPublic(pathname) && !hasSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Pas de paramètre de retour : un `?next=` est la porte ouverte aux
    // redirections ouvertes, pour un confort marginal sur une application
    // qui n'a qu'une page.
    url.search = "";
    return NextResponse.redirect(url);
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");

  return response;
}

export const config = {
  // On exclut les fichiers statiques : sans cela le filtre d'authentification
  // bloquerait le CSS et le JS de la page de connexion elle-même.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
