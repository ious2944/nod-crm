import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/tasks/constants";
import { toCsv } from "@/lib/tasks/csv";
import { viewConfigSchema } from "@/lib/tasks/query-engine";
import { toPlainText } from "@/lib/tasks/rich-text";
import { assertUuid, json, withActor } from "@/lib/tasks/route-helpers";
import { getMyTasks, getProjectBundle, getWorkContext, searchTasks } from "@/lib/tasks/work-queries";
import { prisma } from "@/lib/prisma";

const frDate = (key: string | null) => (key ? key.split("-").reverse().join("/") : "");

/**
 * Export CSV : `?projectId=` (projet), `?scope=my` (Mes tâches) ou
 * `?scope=search&filters=` (recherche). Mêmes permissions que l'affichage.
 */
export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const params = new URL(request.url).searchParams;
    const context = await getWorkContext(actor);
    const users = new Map(context.users.map((u) => [u.id, u]));
    const tags = new Map(context.tags.map((t) => [t.id, t.name]));

    let tasks;
    let sections = new Map<string, string>();
    let projectId: string | null = null;
    let fileName = "taches";
    if (params.get("projectId")) {
      projectId = assertUuid(params.get("projectId"));
      const bundle = await getProjectBundle(actor, projectId);
      tasks = bundle.tasks;
      sections = new Map(bundle.sections.map((s) => [s.id, s.name]));
      fileName = bundle.project.name;
    } else if (params.get("scope") === "my") {
      tasks = await getMyTasks(actor, true);
      fileName = "mes-taches";
    } else {
      const parsed = viewConfigSchema.shape.filters.safeParse(JSON.parse(params.get("filters") ?? "{}"));
      if (!parsed.success) return json({ error: "Filtres invalides." }, { status: 400 });
      tasks = await searchTasks(actor, parsed.data, 5000);
      fileName = "recherche";
    }

    const descriptions = new Map(
      (
        await prisma.task.findMany({
          where: { id: { in: tasks.map((t) => t.id) }, workspaceId: actor.workspaceId },
          select: { id: true, notes: true },
        })
      ).map((t) => [t.id, toPlainText(t.notes)]),
    );
    const titles = new Map(tasks.map((t) => [t.id, t.title]));

    const rows: string[][] = [
      ["Nom", "Description", "Responsable", "Début", "Échéance", "Statut", "Priorité", "Section", "Tags", "Estimation (min)", "Temps passé (min)", "Tâche parente", "Jalon", "Créée le"],
    ];
    for (const task of tasks) {
      const membership = projectId ? task.memberships.find((m) => m.projectId === projectId) : null;
      rows.push([
        task.title,
        descriptions.get(task.id) ?? "",
        task.assigneeId ? (users.get(task.assigneeId)?.email ?? "") : "",
        frDate(task.startDate),
        frDate(task.dueDate),
        STATUS_LABELS[task.status],
        PRIORITY_LABELS[task.priority],
        membership?.sectionId ? (sections.get(membership.sectionId) ?? "") : "",
        task.tagIds.map((id) => tags.get(id) ?? "").filter(Boolean).join(", "),
        task.estimatedMinutes?.toString() ?? "",
        task.spentMinutes ? String(task.spentMinutes) : "",
        task.parentId ? (titles.get(task.parentId) ?? "") : "",
        task.isMilestone ? "Oui" : "",
        task.createdAt.slice(0, 10).split("-").reverse().join("/"),
      ]);
    }
    const safeName = fileName.normalize("NFD").replace(/[^\w.-]+/g, "-").slice(0, 60) || "taches";
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
