/**
 * Script de setup pour les tests E2E.
 * Usage: npx tsx scripts/create-e2e-user.ts [email] [password]
 */
import { hash } from "@node-rs/argon2";
import { prisma } from "@/lib/prisma";

const email = process.argv[2] ?? "e2e@nod-crm.test";
const password = process.argv[3] ?? "E2ePassword!2026";

async function main() {
  let workspace = await prisma.workspace.findFirst({ where: { slug: "e2e-workspace" } });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: { slug: "e2e-workspace", name: "E2E Workspace" },
    });
    console.log(`Workspace created: ${workspace.id}`);
  } else {
    console.log(`Workspace found: ${workspace.id}`);
  }

  // Parameters from the app's auth module (OWASP recommended)
  const passwordHash = await hash(password, {
    memoryCost: 64 * 1024,
    timeCost: 3,
    outputLen: 32,
    parallelism: 1,
  });

  const existing = await prisma.user.findFirst({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        workspaceId: workspace.id,
        displayName: "E2E User",
      },
    });
    console.log(`User created: ${user.id}`);
  } else {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, workspaceId: workspace.id, disabledAt: null },
    });
    console.log(`User updated: ${existing.id}`);
  }

  console.log(`\nReady:\n  email: ${email}\n  password: ${password}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
