#
# Image de production NOD CRM.
#
# Base Debian complète (`node:22-bookworm`), et non Alpine ni la variante slim.
#
# Deux raisons, toutes deux vérifiées :
#
#  1. `@node-rs/argon2` distribue des binaires précompilés pour la glibc : Alpine
#     imposerait la variante musl ou une chaîne de compilation.
#  2. Le moteur de schéma Prisma (`migrate deploy`) a besoin d'OpenSSL. La
#     variante `slim` n'embarque NI `openssl` NI `libssl.so.3` : Prisma retombe
#     alors sur la cible « debian-openssl-1.1.x », fausse pour bookworm, et
#     tente de télécharger le moteur correspondant à l'exécution. Constaté :
#     `prisma migrate deploy` échoue et la base n'est pas migrée. Ce n'était
#     donc pas un simple avertissement.
#
# On aurait pu rester sur `slim` et ajouter `apt-get install openssl`. L'image
# complète est préférée : elle évite une étape réseau au moment du build, qui
# est un point de rupture et nuit à la reproductibilité. Le prix est la taille.
#
# `npm ci` n'est jamais exécuté au démarrage : tout est figé à la construction.

# ---------------------------------------------------------------- dépendances
FROM node:22-bookworm AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# Une seule installation pour toute la construction : un second `npm ci` dans un
# stage séparé refaisait le même travail sans rien apporter. Les dépendances de
# développement sont retirées après le build, par `npm prune` (voir plus bas).
#
# Note de diagnostic, pour la prochaine fois : `npm error Exit handler never
# called!` n'indique PAS la cause. C'est le message générique de npm quand la
# récupération des paquets échoue — il a été observé ici pour un échec TLS
# (`SELF_SIGNED_CERT_IN_CHAIN` derrière un proxy d'interception). En cas
# d'échec à cette étape, relancer avec `--loglevel verbose` : la vraie erreur
# apparaît dans les lignes `npm http fetch`, pas dans le message final.
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------- build
FROM deps AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .

# Le client Prisma est généré avant le build : Next l'inclut dans le bundle.
RUN npx prisma generate
# `AUTH_SECRET` factice : le build n'a besoin d'aucun vrai secret, mais certains
# modules le lisent à l'import. Il n'atteint jamais l'image finale, qui ne
# reprend que `.next`, `node_modules` et les fichiers listés plus bas.
RUN AUTH_SECRET="build-time-placeholder-value-not-used-at-runtime" \
    NODE_ENV=production npm run build

# Les dépendances de développement sont retirées ici, après le build : l'image
# finale n'embarque ni ESLint, ni Vitest, ni Playwright, ni TypeScript.
RUN npm prune --omit=dev

# -------------------------------------------------------------------- runtime
FROM node:22-bookworm AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home /app nextjs

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
# Pas de `COPY public` : l'application n'a aucun actif statique servi depuis
# `public/`. Le favicon suit la convention App Router (`src/app/favicon.ico`),
# compilé dans `.next` au moment du build. Le répertoire existait bien en
# développement — vide, créé par `create-next-app` — mais Git ne versionne pas
# les répertoires vides : il n'a donc jamais été dans le dépôt, et cette ligne
# faisait échouer toute construction depuis un clone propre. Voir
# `tests/unit/dockerfile-context.test.ts`, qui verrouille ce contrat.
COPY --chown=nextjs:nodejs package.json next.config.ts prisma.config.ts ./
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs scripts ./scripts

# Le processus ne tourne pas en root.
USER nextjs

EXPOSE 3000

# Le healthcheck utilise `node`, disponible par construction. La version
# initiale appelait `wget`, absent de l'image : le conteneur aurait été signalé
# `unhealthy` en permanence, ce qui est pire que pas de healthcheck.
#
# Il sonde `/api/health`, qui vérifie la liaison à la base — et non `/login`,
# qui s'affiche parfaitement pendant que PostgreSQL est injoignable.
#
# `redirect: "manual"` puis un contrôle strict du code 200 : sans cela, `fetch`
# suivrait une éventuelle redirection vers `/login` et rapporterait un 200
# rassurant. Une sonde ne doit pas pouvoir réussir par accident.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health',{redirect:'manual'}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

# Forme exec sur le binaire, pas `npx` : le processus Next devient PID 1 et
# reçoit SIGTERM directement. Avec `npx`, le signal s'arrête à l'intermédiaire
# et le conteneur est tué au bout du délai de grâce, connexions coupées net.
CMD ["node_modules/.bin/next", "start"]
