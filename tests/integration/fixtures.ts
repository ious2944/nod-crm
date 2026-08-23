import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

import { cookieJar } from "./cookie-jar";

export const DEV_SESSION_COOKIE = "nod_session";

export interface TestUser {
  userId: string;
  workspaceId: string;
  email: string;
  password: string;
}

/** Vide toutes les tables. La base de test est dédiée : voir `setup.ts`. */
export async function resetDatabase(): Promise<void> {
  // Un seul TRUNCATE en cascade : plus rapide et insensible à l'ordre des FK.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "login_attempts", "sessions", "users", "follow_ups", "contacts", "workspaces" RESTART IDENTITY CASCADE',
  );
  cookieJar.reset();
}

let counter = 0;

/** Crée un workspace avec son utilisateur actif. */
export async function createWorkspaceWithUser(
  slug: string,
  password = "Mot-De-Passe-Test-2026!",
  options: { isActive?: boolean } = {},
): Promise<TestUser> {
  counter += 1;
  const workspace = await prisma.workspace.create({
    data: { slug, name: `Workspace ${slug}` },
    select: { id: true },
  });

  const email = `user${counter}@${slug}.test`;
  const user = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      email,
      passwordHash: await hashPassword(password),
      isActive: options.isActive ?? true,
    },
    select: { id: true },
  });

  return { userId: user.id, workspaceId: workspace.id, email, password };
}

/** Ouvre une session pour cet utilisateur, sans passer par le formulaire. */
export async function signIn(user: TestUser): Promise<void> {
  const { createSession } = await import("@/lib/auth/session");
  cookieJar.reset();
  await createSession(user.userId);
}

/** Détruit le cookie côté client sans toucher à la base (session orpheline). */
export function dropCookie(): void {
  cookieJar.reset();
}

/** Crée un suivi directement en base, pour tester l'accès inter-workspace. */
export async function createFollowUpRecord(
  workspaceId: string,
  title = "Suivi de test",
): Promise<string> {
  const followUp = await prisma.followUp.create({
    data: {
      workspaceId,
      title,
      ballOwner: "THEM",
      dueAt: new Date(Date.now() - 86_400_000),
    },
    select: { id: true },
  });
  return followUp.id;
}

export async function createContactRecord(workspaceId: string): Promise<string> {
  const contact = await prisma.contact.create({
    data: { workspaceId, firstName: "Test", lastName: "Contact" },
    select: { id: true },
  });
  return contact.id;
}

/** Construit un `FormData` à partir d'un objet simple. */
export function formData(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, String(value));
  }
  return data;
}
