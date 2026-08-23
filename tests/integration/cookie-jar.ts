/**
 * Faux magasin de cookies et faux en-têtes, partagés par les tests
 * d'intégration. Ils remplacent `next/headers`, qui exige un contexte de
 * requête Next inexistant sous Vitest.
 *
 * Le module est volontairement à état global : c'est ce qui permet à un test
 * d'observer le cookie posé par `login()` puis de le rejouer dans l'appel
 * suivant, exactement comme le ferait un navigateur.
 */
export interface StoredCookie {
  name: string;
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
}

const cookies = new Map<string, StoredCookie>();
let requestHeaders = new Map<string, string>();

export const cookieJar = {
  get(name: string) {
    const cookie = cookies.get(name);
    return cookie ? { name, value: cookie.value } : undefined;
  },
  set(nameOrCookie: string | StoredCookie, value?: string, options?: Partial<StoredCookie>) {
    const cookie: StoredCookie =
      typeof nameOrCookie === "string"
        ? { name: nameOrCookie, value: value ?? "", ...options }
        : nameOrCookie;

    // maxAge: 0 est la manière dont l'application supprime un cookie.
    if (cookie.maxAge === 0 || cookie.value === "") {
      cookies.delete(cookie.name);
      return;
    }
    cookies.set(cookie.name, cookie);
  },
  delete(nameOrOptions: string | { name: string }) {
    const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
    cookies.delete(name);
  },
  /** Dernier cookie posé pour ce nom, attributs compris. Réservé aux tests. */
  inspect(name: string): StoredCookie | undefined {
    return cookies.get(name);
  },
  names(): string[] {
    return [...cookies.keys()];
  },
  reset(): void {
    cookies.clear();
  },
};

export const headerJar = {
  get(name: string): string | null {
    return requestHeaders.get(name.toLowerCase()) ?? null;
  },
  setAll(values: Record<string, string>): void {
    requestHeaders = new Map(
      Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
    );
  },
  reset(): void {
    requestHeaders = new Map();
  },
};

/** Erreur levée par le faux `redirect()`, pour pouvoir l'assertion. */
export class TestRedirect extends Error {
  constructor(readonly location: string) {
    super(`REDIRECT:${location}`);
    this.name = "TestRedirect";
  }
}
