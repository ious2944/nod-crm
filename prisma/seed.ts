/**
 * Jeu de démonstration.
 *
 * Toutes les lignes créées ici portent `isDemo: true` et s'affichent avec un
 * badge « démo » dans l'interface : impossible de les confondre avec des vraies
 * données. `npm run db:seed` les remplace à chaque exécution.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const TIME_ZONE = process.env.APP_TIME_ZONE || "Europe/Paris";

/**
 * Workspace de démonstration. Neutre par défaut, surchargeable pour une
 * recette : aucune donnée du seed ne doit ressembler à un vrai client.
 */
const WORKSPACE_SLUG = process.env.SEED_WORKSPACE_SLUG?.trim() || "demo";
const WORKSPACE_NAME = process.env.SEED_WORKSPACE_NAME?.trim() || "Demo Workspace";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Échéance décalée de `days` jours par rapport à aujourd'hui (minuit local). */
function dueInDays(days: number): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/**
 * Personnages entièrement fictifs, sur des organisations d'exemple. Aucune
 * personne réelle, aucun client, aucune adresse : ce jeu est destiné à être
 * publié et lu par n'importe qui.
 */
const CONTACTS = [
  { key: "alice", firstName: "Alice", lastName: "Martin", organizationName: "Acme Corp" },
  { key: "bob", firstName: "Bob", lastName: "Dupont", organizationName: "Example Company" },
  { key: "carla", firstName: "Carla", lastName: "Nguyen", organizationName: "Globex" },
  { key: "david", firstName: "David", lastName: "Okoye", organizationName: "Initech" },
];

async function main() {
  // Garde-fou : les données de démonstration n'ont rien à faire en production.
  // `ALLOW_DEMO_SEED=1` permet de forcer sur un environnement de recette dédié.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error(
      "Le seed de démonstration est refusé en production. " +
        "Créez le workspace et l'utilisateur avec `npm run workspace:create` puis `npm run user:create`.",
    );
  }

  const workspace = await prisma.workspace.upsert({
    where: { slug: WORKSPACE_SLUG },
    update: {},
    create: { slug: WORKSPACE_SLUG, name: WORKSPACE_NAME },
  });

  // Idempotent : on repart d'un jeu de démo propre à chaque exécution.
  await prisma.followUp.deleteMany({ where: { workspaceId: workspace.id, isDemo: true } });
  await prisma.contact.deleteMany({ where: { workspaceId: workspace.id, isDemo: true } });

  const contacts = new Map<string, string>();
  for (const contact of CONTACTS) {
    const created = await prisma.contact.create({
      data: {
        workspaceId: workspace.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        organizationName: contact.organizationName,
        isDemo: true,
      },
      select: { id: true },
    });
    contacts.set(contact.key, created.id);
  }

  const followUps = [
    {
      title: "Catalogue produits complet",
      description: "Relancer pour obtenir la liste complète des références.",
      contact: "alice",
      ballOwner: "THEM" as const,
      dueAt: dueInDays(-6),
      createdAt: daysAgo(14),
      nudgeCount: 1,
      lastNudgedAt: daysAgo(6),
    },
    {
      title: "Accès à l'environnement de test",
      description: "Identifiants applicatifs pour la recette.",
      contact: "bob",
      ballOwner: "THEM" as const,
      dueAt: dueInDays(-2),
      createdAt: daysAgo(9),
    },
    {
      title: "Devis prestataire",
      contact: "carla",
      ballOwner: "THEM" as const,
      dueAt: dueInDays(0),
      createdAt: daysAgo(5),
    },
    {
      title: "Préparer la proposition client",
      description: "Trame + chiffrage à envoyer avant la fin de semaine.",
      contact: "david",
      ballOwner: "ME" as const,
      dueAt: dueInDays(1),
      createdAt: daysAgo(2),
    },
    {
      title: "Relire le contrat de sous-traitance",
      contact: null,
      ballOwner: "ME" as const,
      dueAt: dueInDays(4),
      createdAt: daysAgo(1),
    },
    {
      title: "Récupérer les visuels du site",
      contact: "david",
      ballOwner: "THEM" as const,
      dueAt: dueInDays(-11),
      createdAt: daysAgo(21),
      nudgeCount: 2,
      lastNudgedAt: daysAgo(11),
    },
    {
      title: "Signer le NDA",
      contact: "alice",
      ballOwner: "THEM" as const,
      dueAt: dueInDays(-4),
      createdAt: daysAgo(20),
      status: "COMPLETED" as const,
      completedAt: daysAgo(3),
    },
  ];

  for (const followUp of followUps) {
    await prisma.followUp.create({
      data: {
        workspaceId: workspace.id,
        contactId: followUp.contact ? contacts.get(followUp.contact) : null,
        title: followUp.title,
        description: followUp.description ?? null,
        ballOwner: followUp.ballOwner,
        status: followUp.status ?? "OPEN",
        dueAt: followUp.dueAt,
        createdAt: followUp.createdAt,
        completedAt: followUp.completedAt ?? null,
        nudgeCount: followUp.nudgeCount ?? 0,
        lastNudgedAt: followUp.lastNudgedAt ?? null,
        isDemo: true,
      },
    });
  }

  console.log(
    `Seed terminé : ${CONTACTS.length} contacts et ${followUps.length} suivis de démonstration.`,
  );
  // Aucun identifiant n'est seedé : les comptes se créent uniquement à la main.
  const userCount = await prisma.user.count({ where: { workspaceId: workspace.id } });
  if (userCount === 0) {
    console.log(
      `Aucun utilisateur dans « ${WORKSPACE_SLUG} ». Créez-en un : npm run user:create -- --workspace ${WORKSPACE_SLUG}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
