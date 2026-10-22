import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import * as commerceActions from "@/app/(app)/commerce/actions";
import * as contactActions from "@/app/(app)/contacts/actions";
import * as importActions from "@/app/(app)/contacts/import-actions";
import * as followUpActions from "@/app/(app)/follow-ups/actions";
import * as organizationActions from "@/app/(app)/organizations/actions";
import * as privacyActions from "@/app/(app)/rgpd/actions";
import * as privacyArchiveActions from "@/app/(app)/rgpd/archive-actions";
import * as legacyTaskActions from "@/app/(app)/tasks/actions";
import * as work from "@/app/(app)/tasks/work-actions";
import { GET as photoGet } from "@/app/api/contacts/[id]/photo/route";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as attachmentGet } from "@/app/api/tasks/attachments/[id]/route";
import { GET as contextGet } from "@/app/api/tasks/context/route";
import { GET as crmGet } from "@/app/api/tasks/crm/route";
import { GET as exportGet } from "@/app/api/tasks/export/route";
import { GET as findGet } from "@/app/api/tasks/find/route";
import { POST as attachmentPost } from "@/app/api/tasks/items/[id]/attachments/route";
import { GET as itemGet } from "@/app/api/tasks/items/[id]/route";
import { GET as linkedGet } from "@/app/api/tasks/linked/route";
import { GET as myGet } from "@/app/api/tasks/my/route";
import { GET as notificationsGet } from "@/app/api/tasks/notifications/route";
import { GET as projectGet } from "@/app/api/tasks/projects/[id]/route";
import { GET as projectSettingsGet } from "@/app/api/tasks/projects/[id]/settings/route";
import { GET as projectsGet } from "@/app/api/tasks/projects/route";
import { GET as searchGet } from "@/app/api/tasks/search/route";
import { GET as trashGet } from "@/app/api/tasks/trash/route";
import { GET as viewsGet } from "@/app/api/tasks/views/route";
import { getCockpit } from "@/lib/cockpit/queries";
import { getCommerceStats, getOpportunityDetail, listOpportunities, searchOpportunityOptions } from "@/lib/commerce/queries";
import { getContactDetail, listContactsPage, listOrganizationOptions, searchContactOptions } from "@/lib/contacts/queries";
import { DEFAULT_CONTACT_LIST_PARAMS } from "@/lib/contacts/filters";
import { getActionableFollowUps, getFollowUpBoard } from "@/lib/follow-ups/queries";
import { getOrganizationDetail, listOrganizationsPage, searchOrganizationOptions } from "@/lib/organizations/queries";
import { DEFAULT_ORG_LIST_PARAMS } from "@/lib/organizations/filters";
import { prisma } from "@/lib/prisma";
import * as privacyQueries from "@/lib/privacy/queries";
import { listTrash } from "@/lib/tasks/service";
import { listProjectTrash } from "@/lib/tasks/project-service";
import { getActionableTasks, getTaskList, getTasksForKpi, searchFollowUpOptions } from "@/lib/tasks/queries";
import { changeFor } from "@/lib/tasks/realtime-filter";
import type { ActionResult } from "@/lib/tasks/types";
import * as wq from "@/lib/tasks/work-queries";
import { getTodayFeed } from "@/lib/today/queries";

import {
  addUserToWorkspace,
  createContactRecord,
  createFollowUpRecord,
  createOpportunityRecord,
  createOrganizationRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Lot A — « un utilisateur fraîchement créé dans un tenant existant voit zéro
 * donnée, partout ».
 *
 * La propriétaire (Alice) a tout : fiches CRM et RGPD, projet, tâches libres
 * et de projet, sous-tâche, commentaire, pièce jointe, photo de contact,
 * règle, modèle, formulaire, vue, notification. Un nouvel utilisateur du même
 * espace (Nadia) parcourt ensuite **chaque point de lecture inventorié** et
 * vise **chaque identifiant existant** en lecture comme en écriture.
 *
 * Inventaire : `READ_POINTS` doit couvrir exactement ce que le code expose —
 * fonctions exportées des modules de requêtes, pages, routes `GET`, actions de
 * lecture et filtre temps réel. La liste attendue est **recalculée depuis le
 * code** : un point de lecture ajouté sans sonde fait échouer le test.
 *
 * Critère de fuite : aucune réponse ne contient la marque `SECRET` (portée par
 * toutes les données d'Alice), ni l'identifiant d'une de ses données, ni son
 * identifiant ou son adresse. Exceptions explicites : l'étiquette et le champ
 * d'espace (décision a — lisibles par tout l'espace) et l'annuaire, qui
 * contient Nadia elle-même (décision b).
 */

const ROOT = join(import.meta.dirname, "..", "..");
const MARK = "SECRET";

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}

let alice: TestUser;
let nadia: TestUser;
const ids: Record<string, string> = {};
const forbidden: string[] = [];

/** Aucune trace des données d'Alice dans `value`. */
function expectNothing(value: unknown, label: string): void {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  expect(text, label).not.toContain(MARK);
  for (const id of forbidden) expect(text.includes(id), `${label} révèle ${id}`).toBe(false);
}

const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
const req = (path: string) => new Request(`http://localhost${path}`);
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
async function body(response: Response): Promise<{ status: number; text: string }> {
  return { status: response.status, text: await response.text() };
}
const notFound = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "NOT_FOUND" });

// ─── Points de lecture ────────────────────────────────────────────────────────

type Probe = () => Promise<void>;

const page = (...probes: Probe[]): Probe => async () => {
  for (const probe of probes) await probe();
};

const READ_POINTS: Record<string, Probe> = {
  // Commerce
  "query:commerce.listOpportunities": async () => {
    const list = await listOpportunities("all");
    expect(list.total).toBe(0);
    expectNothing(list, "listOpportunities");
  },
  "query:commerce.getOpportunityDetail": async () => expect(await getOpportunityDetail(ids.opportunity)).toBeNull(),
  "query:commerce.getCommerceStats": async () => expect(await getCommerceStats()).toEqual({ openCount: 0, closedCount: 0 }),
  "query:commerce.searchOpportunityOptions": async () => expect(await searchOpportunityOptions("")).toEqual([]),
  // Contacts
  "query:contacts.listContactsPage": async () => {
    const page = await listContactsPage(DEFAULT_CONTACT_LIST_PARAMS);
    expect(page.total).toBe(0);
    expectNothing(page, "listContactsPage");
  },
  "query:contacts.getContactDetail": async () => expect(await getContactDetail(ids.contact)).toBeNull(),
  "query:contacts.listOrganizationOptions": async () => expect(await listOrganizationOptions()).toEqual([]),
  "query:contacts.searchContactOptions": async () => expect(await searchContactOptions("")).toEqual([]),
  // Suivis
  "query:follow-ups.getFollowUpBoard": async () => {
    const board = await getFollowUpBoard("all");
    expect(board.items).toEqual([]);
    expectNothing(board, "getFollowUpBoard");
  },
  "query:follow-ups.getActionableFollowUps": async () => expect(await getActionableFollowUps(new Date(Date.now() + 365 * 86_400_000))).toEqual([]),
  // Organisations
  "query:organizations.listOrganizationsPage": async () => {
    const page = await listOrganizationsPage(DEFAULT_ORG_LIST_PARAMS);
    expect(page.items).toEqual([]);
    expectNothing(page, "listOrganizationsPage");
  },
  "query:organizations.getOrganizationDetail": async () => expect(await getOrganizationDetail(ids.organization)).toBeNull(),
  "query:organizations.searchOrganizationOptions": async () => expect(await searchOrganizationOptions("")).toEqual([]),
  // RGPD
  "query:privacy.getPrivacyDashboard": async () => {
    const dashboard = await privacyQueries.getPrivacyDashboard();
    expect(dashboard.counts).toEqual({ treatments: 0, processors: 0, openRequests: 0, openIncidents: 0 });
    expectNothing(dashboard, "getPrivacyDashboard");
  },
  "query:privacy.listPrivacyTreatments": async () => expect(await privacyQueries.listPrivacyTreatments()).toEqual([]),
  "query:privacy.listArchivedPrivacyTreatments": async () => expect(await privacyQueries.listArchivedPrivacyTreatments()).toEqual([]),
  "query:privacy.listPrivacyProcessors": async () => expect(await privacyQueries.listPrivacyProcessors()).toEqual([]),
  "query:privacy.listArchivedPrivacyProcessors": async () => expect(await privacyQueries.listArchivedPrivacyProcessors()).toEqual([]),
  "query:privacy.listPrivacyRequests": async () => expect(await privacyQueries.listPrivacyRequests()).toEqual([]),
  "query:privacy.listPrivacyIncidents": async () => expect(await privacyQueries.listPrivacyIncidents()).toEqual([]),
  "query:privacy.listPrivacyProcessorOptions": async () => expect(await privacyQueries.listPrivacyProcessorOptions()).toEqual([]),
  "query:privacy.listPrivacyContactOptions": async () => expect(await privacyQueries.listPrivacyContactOptions()).toEqual([]),
  // Cockpit, aujourd'hui
  "query:cockpit.getCockpit": async () => {
    const cockpit = await getCockpit("all");
    expect(cockpit.openTotal).toBe(0);
    expectNothing(cockpit, "getCockpit");
  },
  "query:today.getTodayFeed": async () => expect(await getTodayFeed()).toEqual([]),
  // Tâches (historique)
  "query:tasks.getTaskList": async () => {
    for (const filter of ["todo", "done"] as const) {
      const list = await getTaskList(filter);
      expect(list.todoCount + list.completedCount).toBe(0);
      expectNothing(list, `getTaskList ${filter}`);
    }
  },
  "query:tasks.getActionableTasks": async () => expect(await getActionableTasks(new Date(Date.now() + 365 * 86_400_000))).toEqual([]),
  "query:tasks.getTasksForKpi": async () => expect(await getTasksForKpi(new Date(Date.now() + 365 * 86_400_000))).toEqual([]),
  "query:tasks.searchFollowUpOptions": async () => expect(await searchFollowUpOptions("")).toEqual([]),
  // Gestion de travail
  "query:work-queries.getWorkContext": async () => {
    const context = await wq.getWorkContext(actorOf(nadia));
    // Annuaire (décision b) : elle-même seulement.
    expect(context.users.map((u) => u.id)).toEqual([nadia.userId]);
    expect(context.projects).toEqual([]);
    expect(context.unreadCount).toBe(0);
    // Décision (a) : étiquette et champ d'espace sont lisibles par tout l'espace.
    expect(context.tags.map((t) => t.id)).toEqual([ids.tag]);
    expect(context.fields.map((f) => f.id)).toEqual([ids.field]);
    expectNothing(context, "getWorkContext");
  },
  "query:work-queries.getProjectDetail": async () => notFound(wq.getProjectDetail(actorOf(nadia), ids.project)),
  "query:work-queries.getProjectBundle": async () => notFound(wq.getProjectBundle(actorOf(nadia), ids.project)),
  "query:work-queries.listProjects": async () => {
    for (const scope of ["active", "archived", "templates", "all"] as const) expect(await wq.listProjects(actorOf(nadia), scope)).toEqual([]);
  },
  "query:work-queries.getMyTasks": async () => expect(await wq.getMyTasks(actorOf(nadia), true)).toEqual([]),
  "query:work-queries.getTaskDetail": async () => {
    for (const id of [ids.projectTask, ids.freeTask, ids.subtask]) await notFound(wq.getTaskDetail(actorOf(nadia), id));
  },
  "query:work-queries.resolveTaskLocation": async () => {
    for (const id of [ids.projectTask, ids.freeTask, ids.subtask]) await notFound(wq.resolveTaskLocation(actorOf(nadia), id));
  },
  "query:work-queries.searchTasks": async () => expect(await wq.searchTasks(actorOf(nadia), { completion: "all" })).toEqual([]),
  "query:work-queries.searchTaskIds": async () => expect(await wq.searchTaskIds(actorOf(nadia), { completion: "all" })).toEqual([]),
  "query:work-queries.getSavedViews": async () => {
    expect(await wq.getSavedViews(actorOf(nadia))).toEqual([]);
    expect(await wq.getSavedViews(actorOf(nadia), `project:${ids.project}`)).toEqual([]);
  },
  "query:work-queries.getLinkedWork": async () => {
    await notFound(wq.getLinkedWork(actorOf(nadia), "contact", ids.contact));
    await notFound(wq.getLinkedWork(actorOf(nadia), "organization", ids.organization));
    await notFound(wq.getLinkedWork(actorOf(nadia), "opportunity", ids.opportunity));
  },
  "query:work-queries.getCrmRef": async () => {
    expect(await wq.getCrmRef(actorOf(nadia), "contact", ids.contact)).toBeNull();
    expect(await wq.getCrmRef(actorOf(nadia), "organization", ids.organization)).toBeNull();
    expect(await wq.getCrmRef(actorOf(nadia), "opportunity", ids.opportunity)).toBeNull();
  },
  "query:work-queries.searchCrm": async () => {
    for (const kind of ["contact", "organization", "opportunity"] as const) expect(await wq.searchCrm(actorOf(nadia), kind, "")).toEqual([]);
  },
  "query:work-queries.quickFindTasks": async () => expect(await wq.quickFindTasks(actorOf(nadia), "")).toEqual([]),
  "query:work-queries.listNotifications": async () => {
    expect(await wq.listNotifications(actorOf(nadia))).toEqual([]);
    expect(await wq.listNotifications(actorOf(nadia), true)).toEqual([]);
  },
  "query:work-queries.getNotificationPreferences": async () => expect(await wq.getNotificationPreferences(actorOf(nadia))).toEqual({}),
  "query:work-queries.getProjectSettings": async () => notFound(wq.getProjectSettings(actorOf(nadia), ids.project)),
  "query:work-queries.getForm": async () => notFound(wq.getForm(actorOf(nadia), ids.form)),
  "query:work-queries.listForms": async () => expect(await wq.listForms(actorOf(nadia))).toEqual([]),
  "query:work-queries.getWorkload": async () => {
    const workload = await wq.getWorkload(actorOf(nadia), wq.todayKey(), 8);
    expect(workload.tasks).toEqual([]);
    expect(Object.keys(workload.capacities)).toEqual([nadia.userId]);
  },
  // Corbeilles (lues par la page et la route /trash)
  "query:service.listTrash": async () => expect(await listTrash(actorOf(nadia))).toEqual([]),
  "query:project-service.listProjectTrash": async () => expect(await listProjectTrash(actorOf(nadia))).toEqual([]),

  // ─── Pages (les lectures qu'elles appellent) ────────────────────────────────
  "page:/commerce": page(READ_POINTS_REF("query:commerce.getCommerceStats"), READ_POINTS_REF("query:commerce.listOpportunities")),
  "page:/commerce/[id]": page(READ_POINTS_REF("query:commerce.getOpportunityDetail")),
  "page:/contacts": page(READ_POINTS_REF("query:contacts.listContactsPage"), READ_POINTS_REF("query:contacts.listOrganizationOptions")),
  "page:/contacts/[id]": page(READ_POINTS_REF("query:contacts.getContactDetail")),
  "page:/follow-ups": page(READ_POINTS_REF("query:follow-ups.getFollowUpBoard")),
  "page:/organizations": page(READ_POINTS_REF("query:organizations.listOrganizationsPage")),
  "page:/organizations/[id]": page(READ_POINTS_REF("query:organizations.getOrganizationDetail")),
  "page:/rgpd": page(READ_POINTS_REF("query:privacy.getPrivacyDashboard")),
  "page:/rgpd/incidents": page(READ_POINTS_REF("query:privacy.listPrivacyIncidents")),
  "page:/rgpd/processors": page(READ_POINTS_REF("query:privacy.listPrivacyProcessors"), READ_POINTS_REF("query:privacy.listArchivedPrivacyProcessors")),
  "page:/rgpd/requests": page(READ_POINTS_REF("query:privacy.listPrivacyRequests"), READ_POINTS_REF("query:privacy.listPrivacyContactOptions")),
  "page:/rgpd/treatments": page(
    READ_POINTS_REF("query:privacy.listPrivacyTreatments"),
    READ_POINTS_REF("query:privacy.listArchivedPrivacyTreatments"),
    READ_POINTS_REF("query:privacy.listPrivacyProcessorOptions"),
  ),
  "page:/tasks": page(READ_POINTS_REF("query:work-queries.getWorkContext"), READ_POINTS_REF("query:work-queries.getMyTasks"), READ_POINTS_REF("query:work-queries.getSavedViews")),
  "page:/tasks/favorites": page(READ_POINTS_REF("query:work-queries.listProjects")),
  "page:/tasks/forms": page(READ_POINTS_REF("query:work-queries.listForms")),
  "page:/tasks/forms/[id]": page(READ_POINTS_REF("query:work-queries.getForm")),
  "page:/tasks/notifications": page(READ_POINTS_REF("route:/api/tasks/notifications")),
  "page:/tasks/portfolio": page(READ_POINTS_REF("query:work-queries.listProjects")),
  "page:/tasks/projects": page(READ_POINTS_REF("query:work-queries.listProjects")),
  "page:/tasks/projects/[id]": page(READ_POINTS_REF("query:work-queries.getProjectBundle"), READ_POINTS_REF("query:work-queries.getSavedViews")),
  "page:/tasks/search": page(READ_POINTS_REF("query:work-queries.getSavedViews"), READ_POINTS_REF("route:/api/tasks/search")),
  "page:/tasks/settings": page(READ_POINTS_REF("query:work-queries.getWorkContext"), READ_POINTS_REF("query:work-queries.getNotificationPreferences")),
  "page:/tasks/t/[id]": page(READ_POINTS_REF("query:work-queries.resolveTaskLocation")),
  "page:/tasks/trash": page(READ_POINTS_REF("route:/api/tasks/trash")),
  "page:/tasks/workload": page(READ_POINTS_REF("query:work-queries.getWorkload")),
  "page:/today": page(READ_POINTS_REF("query:cockpit.getCockpit"), READ_POINTS_REF("query:tasks.getTasksForKpi"), READ_POINTS_REF("query:today.getTodayFeed")),

  // ─── Routes GET ─────────────────────────────────────────────────────────────
  "route:/api/contacts/[id]/photo": async () => expect((await photoGet(req(`/api/contacts/${ids.contact}/photo`), ctx({ id: ids.contact }))).status).toBe(404),
  "route:/api/health": async () => expectNothing((await body(await healthGet())).text, "health"),
  "route:/api/tasks/attachments/[id]": async () => {
    const response = await body(await attachmentGet(req(`/api/tasks/attachments/${ids.attachment}`), ctx({ id: ids.attachment })));
    expect(response.status).toBe(404);
    expectNothing(response.text, "attachment");
  },
  "route:/api/tasks/context": async () => expectNothing((await body(await contextGet())).text, "context"),
  "route:/api/tasks/crm": async () => {
    for (const kind of ["contact", "organization", "opportunity"]) {
      const response = await body(await crmGet(req(`/api/tasks/crm?kind=${kind}&q=`)));
      expect(response.status).toBe(200);
      expectNothing(response.text, `crm ${kind}`);
    }
  },
  "route:/api/tasks/export": async () => {
    for (const query of ["scope=my", `filters=${encodeURIComponent(JSON.stringify({ completion: "all" }))}`]) {
      const response = await body(await exportGet(req(`/api/tasks/export?${query}`)));
      expect(response.text.trim().split("\n")).toHaveLength(1); // en-tête seul
      expectNothing(response.text, `export ${query}`);
    }
    expect((await exportGet(req(`/api/tasks/export?projectId=${ids.project}`))).status).toBe(404);
  },
  "route:/api/tasks/find": async () => expect(JSON.parse((await body(await findGet(req("/api/tasks/find?q=")))).text)).toMatchObject({ tasks: [] }),
  "route:/api/tasks/items/[id]": async () => {
    for (const id of [ids.projectTask, ids.freeTask, ids.subtask]) {
      const response = await body(await itemGet(req(`/api/tasks/items/${id}`), ctx({ id })));
      expect(response.status).toBe(404);
      expectNothing(response.text, "item");
    }
  },
  "route:/api/tasks/linked": async () => {
    for (const [kind, id] of [["contact", ids.contact], ["organization", ids.organization], ["opportunity", ids.opportunity]]) {
      expect((await linkedGet(req(`/api/tasks/linked?kind=${kind}&id=${id}`))).status).toBe(404);
    }
  },
  "route:/api/tasks/my": async () => {
    const response = await body(await myGet(req("/api/tasks/my?completed=1")));
    expectNothing(response.text, "my");
    expect(JSON.parse(response.text).tasks).toEqual([]);
  },
  "route:/api/tasks/notifications": async () => {
    for (const archived of ["0", "1"]) {
      const response = await body(await notificationsGet(req(`/api/tasks/notifications?archived=${archived}`)));
      expectNothing(response.text, "notifications");
    }
  },
  "route:/api/tasks/projects": async () => {
    for (const scope of ["active", "archived", "templates", "all"]) {
      const response = await body(await projectsGet(req(`/api/tasks/projects?scope=${scope}`)));
      expectNothing(response.text, `projects ${scope}`);
      expect(JSON.parse(response.text).projects).toEqual([]);
    }
  },
  "route:/api/tasks/projects/[id]": async () => expect((await projectGet(req(`/api/tasks/projects/${ids.project}`), ctx({ id: ids.project }))).status).toBe(404),
  "route:/api/tasks/projects/[id]/settings": async () =>
    expect((await projectSettingsGet(req(`/api/tasks/projects/${ids.project}/settings`), ctx({ id: ids.project }))).status).toBe(404),
  "route:/api/tasks/search": async () => {
    const filters = encodeURIComponent(JSON.stringify({ completion: "all" }));
    expectNothing((await body(await searchGet(req(`/api/tasks/search?filters=${filters}`)))).text, "search");
    expect(JSON.parse((await body(await searchGet(req(`/api/tasks/search?idsOnly=1&filters=${filters}`)))).text)).toEqual({ ids: [] });
  },
  "route:/api/tasks/stream": READ_POINTS_REF("sse:changeFor"),
  "route:/api/tasks/trash": async () => expectNothing((await body(await trashGet())).text, "trash"),
  "route:/api/tasks/views": async () => {
    expectNothing((await body(await viewsGet(req("/api/tasks/views")))).text, "views");
    expectNothing((await body(await viewsGet(req(`/api/tasks/views?scope=project:${ids.project}`)))).text, "views projet");
  },

  // ─── Lectures déguisées en actions ──────────────────────────────────────────
  "action:findContacts": async () => expect(await contactActions.findContacts("")).toEqual([]),
  "action:findOrganizations": async () => expect(await organizationActions.findOrganizations("")).toEqual([]),
  "action:findOpportunities": async () => expect(await commerceActions.findOpportunities("")).toEqual([]),
  "action:findFollowUps": async () => expect(await legacyTaskActions.findFollowUps("")).toEqual([]),
  "action:previewContactImport": async () => {
    // Le fichier reprend l'adresse d'un contact d'Alice : aucun doublon détecté.
    const file = new File([`Prénom,Nom,Adresse de messagerie\r\nCamille,Client,${MARK.toLowerCase()}@client.test\r\n`], "c.csv", { type: "text/csv" });
    const data = new FormData();
    data.set("file", file);
    const preview = await importActions.previewContactImport(data);
    expectNothing(preview, "previewContactImport");
    expect(preview).toMatchObject({ ok: true });
  },
  "action:previewProjectPurgeAction": async () => expect(await work.previewProjectPurgeAction(ids.project)).toMatchObject({ ok: false, code: "NOT_FOUND" }),

  // ─── Temps réel ─────────────────────────────────────────────────────────────
  "sse:changeFor": async () => {
    const message = { w: alice.workspaceId, a: alice.userId, t: [ids.projectTask, ids.freeTask, ids.subtask], p: [ids.project], k: "task_updated" };
    expect(await changeFor(actorOf(nadia), message)).toBeNull();
    // Changement sans cible (réglages) : transmis, mais sans l'auteur.
    expect(await changeFor(actorOf(nadia), { w: alice.workspaceId, a: alice.userId, k: "context" })).toMatchObject({ actorId: null });
  },
};

/** Sonde différée : permet aux pages de réutiliser les sondes des lectures qu'elles appellent. */
function READ_POINTS_REF(key: string): Probe {
  return () => {
    const probe = READ_POINTS[key];
    if (!probe) throw new Error(`Sonde inconnue : ${key}`);
    return probe();
  };
}

// ─── Inventaire recalculé depuis le code ──────────────────────────────────────

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function exportedAsyncFunctions(file: string): string[] {
  return [...readFileSync(join(ROOT, file), "utf8").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
}

const QUERY_MODULES: Record<string, string> = {
  commerce: "src/lib/commerce/queries.ts",
  contacts: "src/lib/contacts/queries.ts",
  "follow-ups": "src/lib/follow-ups/queries.ts",
  organizations: "src/lib/organizations/queries.ts",
  privacy: "src/lib/privacy/queries.ts",
  cockpit: "src/lib/cockpit/queries.ts",
  today: "src/lib/today/queries.ts",
  tasks: "src/lib/tasks/queries.ts",
  "work-queries": "src/lib/tasks/work-queries.ts",
};

function expectedReadPoints(): string[] {
  const keys: string[] = [];
  for (const [module, file] of Object.entries(QUERY_MODULES)) {
    for (const fn of exportedAsyncFunctions(file)) keys.push(`query:${module}.${fn}`);
  }
  keys.push("query:service.listTrash", "query:project-service.listProjectTrash");
  const app = join(ROOT, "src", "app");
  for (const file of walk(app)) {
    const rel = relative(app, file).split("\\").join("/");
    if (rel.startsWith("(app)/") && rel.endsWith("/page.tsx")) keys.push(`page:/${rel.slice("(app)/".length, -"/page.tsx".length)}`);
    if (rel.startsWith("api/") && rel.endsWith("/route.ts") && /export async function GET\b/.test(readFileSync(file, "utf8"))) {
      keys.push(`route:/${rel.slice(0, -"/route.ts".length)}`);
    }
  }
  // Lectures exposées en Server Actions (voir `docs/permissions-v1.md` §4.3).
  keys.push(
    "action:findContacts",
    "action:findOrganizations",
    "action:findOpportunities",
    "action:findFollowUps",
    "action:previewContactImport",
    "action:previewProjectPurgeAction",
    "sse:changeFor",
  );
  return keys.sort();
}

// ─── Données de la propriétaire ───────────────────────────────────────────────

async function seedOwnerData(): Promise<void> {
  await signIn(alice);
  ids.organization = await createOrganizationRecord(alice.workspaceId, { name: `${MARK} Org` });
  ids.contact = await createContactRecord(alice.workspaceId, {
    firstName: "Camille",
    lastName: `${MARK} Client`,
    email: `${MARK.toLowerCase()}@client.test`,
    organizationId: ids.organization,
  });
  await prisma.contact.update({ where: { id: ids.contact }, data: { photoKey: "photo-cle", photoMimeType: "image/png" } });
  ids.opportunity = await createOpportunityRecord(alice.workspaceId, ids.organization, { name: `${MARK} Affaire`, contactId: ids.contact });
  ids.followUp = await createFollowUpRecord(alice.workspaceId, `${MARK} Relance`);
  const owner = { workspaceId: alice.workspaceId, ownerId: alice.userId };
  ids.treatment = (await prisma.privacyTreatment.create({ data: { ...owner, name: `${MARK} Traitement`, purpose: "Prospection" } })).id;
  ids.processor = (await prisma.privacyProcessor.create({ data: { ...owner, name: `${MARK} Cloud`, service: "Hébergement" } })).id;
  // Lien traitement ↔ sous-traitant : sans lui, l'empreinte ne verrait pas une suppression de lien (phase 3, B1).
  await prisma.privacyTreatmentProcessor.create({ data: { workspaceId: alice.workspaceId, treatmentId: ids.treatment, processorId: ids.processor } });
  ids.request = (
    await prisma.privacyRequest.create({
      data: { ...owner, requestType: "ACCESS", status: "RECEIVED", receivedAt: new Date(), dueAt: new Date(Date.now() + 86_400_000), requesterName: `${MARK} Demandeur` },
    })
  ).id;
  ids.incident = (await prisma.privacyIncident.create({ data: { ...owner, title: `${MARK} Incident`, description: "Fuite", discoveredAt: new Date() } })).id;

  ids.project = ok(await work.createProjectAction({ name: `${MARK} Projet`, contactId: ids.contact }));
  ids.projectTask = ok(await work.createTaskAction({ title: `${MARK} Tâche de projet`, projectId: ids.project, dueDate: wq.todayKey(), contactId: ids.contact })).id;
  ids.freeTask = ok(await work.createTaskAction({ title: `${MARK} Tâche libre`, dueDate: wq.todayKey(), opportunityId: ids.opportunity })).id;
  ids.subtask = ok(await work.createTaskAction({ title: `${MARK} Sous-tâche`, parentId: ids.projectTask })).id;
  ok(await work.addCommentAction(ids.projectTask, `${MARK} commentaire`));
  ids.comment = (await prisma.comment.findFirstOrThrow({ where: { taskId: ids.projectTask } })).id;
  ok(await work.addTimeEntryAction(ids.projectTask, { minutes: 30, date: wq.todayKey(), note: `${MARK} temps` }));
  ids.timeEntry = (await prisma.taskTimeEntry.findFirstOrThrow({ where: { taskId: ids.projectTask } })).id;
  const upload = new FormData();
  upload.append("file", new File([new TextEncoder().encode(MARK)], "brief.txt"));
  const posted = await attachmentPost(
    new Request(`http://localhost/api/tasks/items/${ids.projectTask}/attachments`, { method: "POST", body: upload, headers: { origin: "http://localhost", host: "localhost" } }),
    ctx({ id: ids.projectTask }),
  );
  ids.attachment = ((await posted.json()) as { id: string }).id;
  ids.tag = ok(await work.createTagAction({ name: "commune" })).id;
  ids.field = ok(await work.saveCustomFieldAction(null, { name: "Champ commun", type: "TEXT" }));
  ids.rule = ok(await work.saveRuleAction(null, null, { name: `${MARK} Règle`, trigger: "TASK_CREATED", triggerConfig: {}, conditions: [], actions: [{ kind: "set_priority", priority: "HIGH" }], isEnabled: true }));
  ids.template = ok(await work.saveTaskTemplateAction(null, { name: `${MARK} Modèle`, title: `${MARK} Modèle` }));
  ids.form = ok(await work.saveFormAction(null, ids.project, { name: `${MARK} Formulaire`, fields: {} }));
  ids.view = ok(await work.saveViewAction(null, { name: `${MARK} Vue`, scope: "my-tasks", config: {} }));
  ids.notification = (
    await prisma.notification.create({ data: { workspaceId: alice.workspaceId, userId: alice.userId, type: "ASSIGNED", title: `${MARK} notification`, taskId: ids.projectTask } })
  ).id;

  forbidden.push(...Object.entries(ids).filter(([key]) => key !== "tag" && key !== "field").map(([, id]) => id));
  forbidden.push(alice.userId, alice.email);
}

/** Empreinte de toutes les tables métier : une écriture refusée ne doit rien changer. */
async function fingerprint(): Promise<Record<string, string>> {
  const tables = (
    await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename NOT IN ('sessions', 'login_attempts', 'job_leases', '_prisma_migrations', 'users')`,
    )
  ).map((r) => r.tablename);
  const out: Record<string, string> = {};
  for (const table of tables.sort()) {
    const [row] = await prisma.$queryRawUnsafe<{ h: string | null }[]>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${table}" t`);
    out[table] = row.h ?? "";
  }
  return out;
}

describe("lot A — un nouvel utilisateur du tenant ne voit et ne touche rien", () => {
  beforeAll(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("lot-a-tenant");
    await seedOwnerData();
    // Compte créé après coup dans le même espace (le lot C fournira le parcours).
    nadia = await addUserToWorkspace(alice.workspaceId, "Nadia");
    await signIn(nadia);
  });

  it("l'inventaire des lectures couvre exactement les points exposés par le code", () => {
    expect(Object.keys(READ_POINTS).sort()).toEqual(expectedReadPoints());
  });

  it.each(Object.keys(READ_POINTS).sort())("%s : rien de la propriétaire", async (key) => {
    await READ_POINTS[key]();
  });

  it("chaque identifiant existant est introuvable en écriture, et rien n'est modifié", async () => {
    const before = await fingerprint();
    const refused = (r: ActionResult<unknown>) => expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const rejects = (p: Promise<unknown>) => expect(p).rejects.toThrow(/introuvable/i);
    const stateError = async (p: Promise<{ status: string }>) => expect((await p).status).toBe("error");

    // CRM
    await stateError(commerceActions.updateOpportunity({ status: "idle" }, formData({ id: ids.opportunity, name: "x", organizationId: ids.organization, contactId: "", estimatedAmount: "", expectedCloseDate: "", notes: "" })));
    await rejects(commerceActions.changeOpportunityStatus(formData({ id: ids.opportunity, status: "EN_DISCUSSION" })));
    await rejects(commerceActions.deleteOpportunity(formData({ id: ids.opportunity })));
    await stateError(commerceActions.createOpportunity({ status: "idle" }, formData({ name: "x", organizationId: ids.organization, status: "A_QUALIFIER" })));
    await stateError(contactActions.updateContact({ status: "idle" }, formData({ id: ids.contact, firstName: "x", lastName: "y" })));
    await rejects(contactActions.archiveContact(formData({ id: ids.contact })));
    await rejects(contactActions.restoreContact(formData({ id: ids.contact })));
    await stateError(contactActions.createContact({ status: "idle" }, formData({ firstName: "x", lastName: "y", organizationId: ids.organization })));
    await stateError(followUpActions.updateFollowUp({ status: "idle" }, formData({ id: ids.followUp, title: "x", description: "", dueDate: "2026-12-01", contactId: "" })));
    await expect(followUpActions.applyQuickAction(formData({ id: ids.followUp, intent: "complete" }))).rejects.toThrow();
    await stateError(followUpActions.createFollowUp({ status: "idle" }, formData({ title: "x", dueDate: "2026-12-01", ballOwner: "THEM", contactId: ids.contact })));
    await stateError(organizationActions.updateOrganization({ status: "idle" }, formData({ id: ids.organization, name: "x", website: "", phone: "", email: "", notes: "" })));
    // Archivage d'organisation : silencieux comme avant (`updateMany` borné) ; l'empreinte prouve l'absence d'effet.
    await organizationActions.archiveOrganization(formData({ id: ids.organization }));
    await organizationActions.restoreOrganization(formData({ id: ids.organization }));
    // RGPD : bornées par `updateMany`, silencieuses comme avant — l'empreinte prouve l'absence d'effet.
    await privacyActions.archiveTreatment(formData({ id: ids.treatment }));
    await privacyArchiveActions.restoreTreatment(formData({ id: ids.treatment }));
    await privacyActions.archiveProcessor(formData({ id: ids.processor })).catch(() => {});
    await privacyArchiveActions.restoreProcessor(formData({ id: ids.processor }));
    await privacyActions.updateProcessor({ status: "idle" }, formData({ id: ids.processor, name: "x", service: "y", category: "", dataCategories: "", purpose: "", country: "", eeaStatus: "YES", dpaStatus: "SIGNED", dpaUrl: "", subprocessorsStatus: "UNKNOWN", notes: "", lastReviewedAt: "", nextReviewAt: "" }));
    await expect(privacyActions.createPrivacyRequest(formData({ contactId: ids.contact, requesterName: "x", requesterEmail: "", requestType: "ACCESS", status: "RECEIVED", receivedAt: "2026-10-01", dueAt: "2026-11-01", owner: "", notes: "" }))).rejects.toThrow(/introuvable/i);

    // Tâches (historiques)
    await rejects(legacyTaskActions.applyTaskAction(formData({ id: ids.freeTask, intent: "complete" })));
    await stateError(legacyTaskActions.updateTask({ status: "idle" }, formData({ id: ids.freeTask, title: "x", dueDate: "", notes: "" })));
    await stateError(legacyTaskActions.createTask({ status: "idle" }, formData({ title: "x", contactId: ids.contact })));

    // Tâches V1 : chaque tâche d'Alice (de projet, libre, sous-tâche)
    for (const id of [ids.projectTask, ids.freeTask, ids.subtask]) {
      refused(await work.updateTaskAction(id, { title: "x" }));
      refused(await work.deleteTaskAction(id));
      refused(await work.duplicateTaskAction(id));
      refused(await work.moveSubtaskAction(id, null, null));
      refused(await work.setTaskParentAction(id, null));
      refused(await work.setTaskTagsAction(id, [ids.tag]));
      refused(await work.setCustomFieldValueAction(id, ids.field, "x"));
      refused(await work.setFollowerAction(id, nadia.userId, "FOLLOWER"));
      refused(await work.addTimeEntryAction(id, { minutes: 5, date: wq.todayKey() }));
      refused(await work.addCommentAction(id, "x"));
      refused(await work.removeTaskFromProjectAction(id, ids.project));
      refused(await work.restoreTaskAction(id));
      refused(await work.purgeTaskAction(id));
      refused(await work.taskToTemplateAction(id, null));
      expect(await work.bulkUpdateAction([id], { title: "x" })).toMatchObject({ ok: true, data: { updated: [] } });
    }
    refused(await work.addDependencyAction(ids.projectTask, ids.freeTask));
    refused(await work.removeDependencyAction(ids.projectTask, ids.freeTask));
    refused(await work.editCommentAction(ids.comment, "x"));
    refused(await work.deleteCommentAction(ids.comment));
    refused(await work.toggleReactionAction(ids.comment, "👍"));
    refused(await work.deleteTimeEntryAction(ids.timeEntry));
    refused(await work.deleteAttachmentAction(ids.attachment));
    expect(await work.createTaskAction({ title: "x", contactId: ids.contact })).toMatchObject({ ok: false });
    expect(await work.createTaskAction({ title: "x", parentId: ids.projectTask })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.createTaskAction({ title: "x", assigneeId: alice.userId })).toMatchObject({ ok: false });
    const upload = new FormData();
    upload.append("file", new File([new TextEncoder().encode("x")], "x.txt"));
    expect((await attachmentPost(new Request(`http://localhost/api/tasks/items/${ids.projectTask}/attachments`, { method: "POST", body: upload, headers: { origin: "http://localhost", host: "localhost" } }), ctx({ id: ids.projectTask }))).status).toBe(404);

    // Projets
    refused(await work.updateProjectAction(ids.project, { name: "x" }));
    refused(await work.duplicateProjectAction(ids.project, {}));
    refused(await work.archiveProjectAction(ids.project, true));
    refused(await work.deleteProjectAction(ids.project));
    refused(await work.restoreProjectAction(ids.project));
    refused(await work.purgeProjectAction(ids.project, "x"));
    refused(await work.setProjectMemberAction(ids.project, nadia.userId, "EDITOR"));
    refused(await work.setFavoriteAction(ids.project, true));
    refused(await work.createSectionAction(ids.project, "x"));
    refused(await work.postStatusUpdateAction(ids.project, { status: "ON_TRACK", body: "x" }));
    refused(await work.setProjectFieldAction(ids.project, ids.field, true));
    refused(await work.importCsvAction(ids.project, "Nom\nx"));
    refused(await work.saveFormAction(null, ids.project, { name: "x", fields: {} }));
    refused(await work.deleteFormAction(ids.form));
    expect(await work.submitFormAction(ids.form, { title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    refused(await work.addTaskToProjectAction(ids.freeTask, ids.project));
    expect(await work.createProjectAction({ name: "x", contactId: ids.contact })).toMatchObject({ ok: false });

    // Réglages : étiquette et champ d'espace visibles mais réservés à leur créatrice (décision a).
    expect(await work.updateTagAction(ids.tag, { name: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.deleteTagAction(ids.tag)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.saveCustomFieldAction(ids.field, { name: "x", type: "TEXT" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.deleteCustomFieldAction(ids.field)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // Règle et modèle d'espace : personnels, donc introuvables.
    refused(await work.saveRuleAction(ids.rule, null, { name: "x", trigger: "TASK_CREATED", triggerConfig: {}, conditions: [], actions: [{ kind: "set_priority", priority: "LOW" }], isEnabled: true }));
    refused(await work.deleteRuleAction(ids.rule));
    refused(await work.saveTaskTemplateAction(ids.template, { name: "x", title: "x" }));
    refused(await work.deleteTaskTemplateAction(ids.template));
    expect(await work.createTaskAction({ title: "x", templateId: ids.template })).toMatchObject({ ok: false });
    // Préférences personnelles : seulement les siennes.
    await work.deleteViewAction(ids.view); // silencieuse et bornée à ses propres vues (inchangé) : l'empreinte prouve l'absence d'effet
    expect(await work.saveViewAction(ids.view, { name: "x", scope: "my-tasks", config: {} })).toMatchObject({ ok: false });
    await work.markNotificationsAction([ids.notification], { read: true, archived: true });

    expect(await fingerprint()).toEqual(before);
  });
});
