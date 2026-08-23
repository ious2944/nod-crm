import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Client Prisma, créé **paresseusement**.
 *
 * L'instanciation n'a lieu qu'au premier accès réel, jamais à l'import du
 * module. Ce détail n'en est pas un : `next build` charge les modules d'une
 * page pour en collecter les métadonnées, sans qu'aucune requête ne parte. Avec
 * une création au chargement, la construction de l'image Docker échouait sur
 * « DATABASE_URL est manquant » — un build de production ne doit pas exiger une
 * base de données, et il n'y en a évidemment pas dans un conteneur de build.
 *
 * Le message d'erreur reste le même, il arrive simplement au moment utile :
 * à la première requête, c'est-à-dire au démarrage effectif du service.
 *
 * En dev, Next recharge les modules à chaud : on mémorise le client sur
 * `globalThis` pour ne pas ouvrir un pool à chaque rechargement.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL est manquant. Copiez .env.example vers .env puis renseignez la connexion PostgreSQL.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Façade transparente : `prisma.user.findMany()` se comporte exactement comme
 * avec un client direct, mais la connexion n'est établie qu'à cet instant.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    // Les méthodes doivent rester liées au client réel, pas au proxy.
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(getPrismaClient(), property);
  },
});
