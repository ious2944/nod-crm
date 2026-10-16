import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Verrou de tâche planifiée (« bail ») partagé par toutes les instances.
 *
 * Une ligne par tâche dans `job_leases`. Prendre le bail est atomique : une
 * mise à jour conditionnelle (bail libre ou expiré), ou la création de la
 * ligne, départagée par la clé primaire. Les horodatages viennent de
 * l'horloge de l'application (instances synchronisées par NTP).
 *
 * Deux exécutions simultanées (deux instances, deux minuteurs, un
 * déclenchement manuel) ne peuvent donc jamais le tenir ensemble ; la seconde
 * s'arrête sans rien faire. Un bail abandonné (processus tué) expire de
 * lui-même après `ttlMs` : l'exécution suivante reprend.
 */

export async function acquireLease(job: string, holder: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  // Une seule instruction UPDATE … WHERE : sous verrou de ligne, une seconde
  // exécution concurrente réévalue la condition et ne prend rien.
  const { count } = await prisma.jobLease.updateMany({
    where: { job, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: until, lockedBy: holder, lastStartedAt: now },
  });
  if (count === 1) return true;
  try {
    // Première exécution : la clé primaire départage deux créations simultanées.
    await prisma.jobLease.create({ data: { job, lockedUntil: until, lockedBy: holder, lastStartedAt: now } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/** Prolonge un bail encore détenu (traitement long). `false` : bail perdu. */
export async function renewLease(job: string, holder: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const { count } = await prisma.jobLease.updateMany({
    where: { job, lockedBy: holder, lockedUntil: { gte: now } },
    data: { lockedUntil: new Date(now.getTime() + ttlMs) },
  });
  return count === 1;
}

export async function releaseLease(job: string, holder: string, status: "SUCCESS" | "ERROR", message: string): Promise<void> {
  await prisma.jobLease.updateMany({
    where: { job, lockedBy: holder },
    data: { lockedUntil: null, lastFinishedAt: new Date(), lastStatus: status, lastMessage: message.slice(0, 500) },
  });
}

export async function leaseState(job: string) {
  return prisma.jobLease.findUnique({ where: { job } });
}
