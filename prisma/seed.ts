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
 * Organisations fictives de démonstration (V0.5).
 *
 * Chaque organisation est rattachée aux contacts qui la référençaient via le
 * champ texte libre `organizationName`. Les deux champs coexistent pour garantir
 * la rétrocompatibilité avec les contacts antérieurs à V0.5.
 */
const ORGANIZATIONS = [
  {
    key: "acme",
    name: "Acme Corp",
    website: "https://www.acme.example.com",
    email: "contact@acme.example.com",
    phone: "+33 1 23 45 67 89",
  },
  {
    key: "example-co",
    name: "Example Company",
    website: "https://www.example.com",
    email: null,
    phone: null,
  },
  {
    key: "globex",
    name: "Globex",
    website: "https://globex.example.com",
    email: null,
    phone: "+33 4 56 78 90 12",
  },
  {
    key: "initech",
    name: "Initech",
    website: null,
    email: "hello@initech.example.com",
    phone: null,
  },
];

/**
 * Personnages entièrement fictifs, sur des organisations d'exemple. Aucune
 * personne réelle, aucun client, aucune adresse : ce jeu est destiné à être
 * publié et lu par n'importe qui.
 */
const CONTACTS = [
  { key: "alice", firstName: "Alice", lastName: "Martin", organizationKey: "acme", organizationName: "Acme Corp" },
  { key: "bob", firstName: "Bob", lastName: "Dupont", organizationKey: "example-co", organizationName: "Example Company" },
  { key: "carla", firstName: "Carla", lastName: "Nguyen", organizationKey: "globex", organizationName: "Globex" },
  { key: "david", firstName: "David", lastName: "Okoye", organizationKey: "initech", organizationName: "Initech" },
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
  // Les tâches d'abord : elles référencent les suivis.
  await prisma.task.deleteMany({ where: { workspaceId: workspace.id, isDemo: true } });
  await prisma.followUp.deleteMany({ where: { workspaceId: workspace.id, isDemo: true } });
  await prisma.contact.deleteMany({ where: { workspaceId: workspace.id, isDemo: true } });
  // Les organisations de démonstration n'ont pas de colonne isDemo : on les
  // identifie par le nom et le workspace, et on les recrée idempotement.
  await prisma.organization.deleteMany({
    where: { workspaceId: workspace.id, name: { in: ORGANIZATIONS.map((o) => o.name) } },
  });

  // Créer les organisations, puis les contacts liés.
  const organizations = new Map<string, string>();
  for (const org of ORGANIZATIONS) {
    const created = await prisma.organization.create({
      data: {
        workspaceId: workspace.id,
        name: org.name,
        website: org.website,
        email: org.email,
        phone: org.phone,
      },
      select: { id: true },
    });
    organizations.set(org.key, created.id);
  }

  const contacts = new Map<string, string>();
  for (const contact of CONTACTS) {
    const organizationId = organizations.get(contact.organizationKey) ?? null;
    const created = await prisma.contact.create({
      data: {
        workspaceId: workspace.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        organizationName: contact.organizationName,
        organizationId,
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

  const followUpIds = new Map<string, string>();

  for (const followUp of followUps) {
    const created = await prisma.followUp.create({
      select: { id: true },
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
    followUpIds.set(followUp.title, created.id);
  }

  /**
   * Tâches de démonstration — « quelque chose à faire », par opposition au
   * suivi qui est « quelque chose à faire avancer avec quelqu'un ».
   *
   * Le jeu couvre volontairement tous les cas d'affichage : en retard,
   * aujourd'hui, demain, plus tard, terminée ; avec et sans contact ; avec et
   * sans suivi lié ; titre court et titre très long.
   */
  const tasks = [
    {
      title: "Préparer la présentation trimestrielle",
      dueAt: dueInDays(-3),
      createdAt: daysAgo(8),
      contact: null,
      followUp: null,
      notes: "Trois slides suffisent : contexte, chiffres, décision.",
    },
    {
      title: "Relire le brief",
      dueAt: dueInDays(-1),
      createdAt: daysAgo(4),
      contact: "carla",
      followUp: null,
    },
    {
      title: "Préparer la proposition commerciale",
      dueAt: dueInDays(0),
      createdAt: daysAgo(2),
      contact: "david",
      // Une tâche et son suivi : deux états, deux échéances, aucune
      // synchronisation. Terminer l'un ne termine jamais l'autre.
      followUp: "Préparer la proposition client",
    },
    {
      title: "Rédiger le compte rendu de l'atelier de cadrage et le diffuser à toutes les parties prenantes",
      dueAt: dueInDays(1),
      createdAt: daysAgo(1),
      contact: "alice",
      followUp: null,
    },
    {
      title: "Mettre à jour la fiche tarifaire",
      dueAt: dueInDays(6),
      createdAt: daysAgo(1),
      contact: null,
      followUp: null,
    },
    {
      title: "Réserver la salle",
      dueAt: dueInDays(-5),
      createdAt: daysAgo(10),
      contact: null,
      followUp: null,
      completedAt: daysAgo(4),
    },
  ];

  for (const task of tasks) {
    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        contactId: task.contact ? contacts.get(task.contact) : null,
        followUpId: task.followUp ? followUpIds.get(task.followUp) : null,
        title: task.title,
        notes: task.notes ?? null,
        dueAt: task.dueAt,
        createdAt: task.createdAt,
        completedAt: task.completedAt ?? null,
        isDemo: true,
      },
    });
  }

  console.log(
    `Seed terminé : ${ORGANIZATIONS.length} organisations, ${CONTACTS.length} contacts, ${followUps.length} suivis et ${tasks.length} tâches de démonstration.`,
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
