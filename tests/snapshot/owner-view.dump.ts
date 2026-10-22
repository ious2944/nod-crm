import { writeFileSync } from "node:fs";

import { it } from "vitest";

import { createSession } from "@/lib/auth/session";
import { getCockpit } from "@/lib/cockpit/queries";
import { getCommerceStats, getOpportunityDetail, listOpportunities } from "@/lib/commerce/queries";
import { DEFAULT_CONTACT_LIST_PARAMS } from "@/lib/contacts/filters";
import { getContactDetail, listContactsPage } from "@/lib/contacts/queries";
import { getFollowUpBoard } from "@/lib/follow-ups/queries";
import { DEFAULT_ORG_LIST_PARAMS } from "@/lib/organizations/filters";
import { getOrganizationDetail, listOrganizationsPage } from "@/lib/organizations/queries";
import * as privacy from "@/lib/privacy/queries";
import { listProjectTrash } from "@/lib/tasks/project-service";
import { getActionableTasks } from "@/lib/tasks/queries";
import { listTrash } from "@/lib/tasks/service";
import * as wq from "@/lib/tasks/work-queries";
import { getTodayFeed } from "@/lib/today/queries";

import { cookieJar } from "../integration/cookie-jar";

/**
 * Instantané de tout ce que voit la propriétaire (lot A, non-régression).
 *
 * Exécuté deux fois sur la même base par `run-owner-snapshot.sh` : avec le
 * code d'avant le lot A (copie de la branche principale), puis avec le code
 * du lot A après migration 1 → backfill → migration 2. Il n'utilise que des
 * lectures présentes dans les deux versions et écrit un JSON stable (identifiants
 * triés, champs choisis) dans `SNAPSHOT_OUT`.
 */

const OWNER = "a0000000-0000-4000-8000-000000000010";
const WS = "a0000000-0000-4000-8000-000000000001";
const actor = { id: OWNER, workspaceId: WS };
const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id).sort();
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

it("instantané de la vue de la propriétaire", async () => {
  cookieJar.reset();
  await createSession(OWNER);

  const context = await wq.getWorkContext(actor);
  const projects = await wq.listProjects(actor, "all");
  const tasks = await wq.searchTasks(actor, { completion: "all" });
  const visibleTaskIds = ids(tasks);

  const out = {
    crm: {
      contacts: ids((await listContactsPage(DEFAULT_CONTACT_LIST_PARAMS)).items),
      contactDetail: (await getContactDetail("a0000000-0000-4000-8000-000000000201"))?.id ?? null,
      organizations: ids((await listOrganizationsPage(DEFAULT_ORG_LIST_PARAMS)).items),
      organizationDetail: (await getOrganizationDetail("a0000000-0000-4000-8000-000000000101"))?.id ?? null,
      opportunities: ids((await listOpportunities("all")).items),
      opportunityDetail: (await getOpportunityDetail("a0000000-0000-4000-8000-000000000301"))?.id ?? null,
      commerceStats: await getCommerceStats(),
      followUps: ids((await getFollowUpBoard("all")).items),
      cockpitOpen: (await getCockpit("all")).openTotal,
      today: (await getTodayFeed()).length,
      actionableTasks: (await getActionableTasks(new Date(Date.now() + 365 * 86_400_000))).map((t) => t.id).sort(),
    },
    privacy: {
      dashboard: (await privacy.getPrivacyDashboard()).counts,
      treatments: ids(await privacy.listPrivacyTreatments()),
      processors: ids(await privacy.listPrivacyProcessors()),
      requests: ids(await privacy.listPrivacyRequests()),
      incidents: ids(await privacy.listPrivacyIncidents()),
    },
    context: {
      users: context.users.map((u) => u.id).sort(),
      tags: ids(context.tags),
      fields: ids(context.fields),
      unreadCount: context.unreadCount,
    },
    projects: byId(projects).map((p) => ({ id: p.id, name: p.name, canEdit: p.canEdit, canManage: p.canManage, visibility: p.visibility, isTemplate: p.isTemplate })),
    tasks: byId(tasks).map((t) => ({ id: t.id, title: t.title, canEdit: t.canEdit, canManage: t.canManage })),
    myTasks: ids(await wq.getMyTasks(actor, true)),
    taskDetails: Object.fromEntries(
      await Promise.all(
        visibleTaskIds.map(async (id) => {
          const d = await wq.getTaskDetail(actor, id);
          return [id, { subtasks: ids(d.subtasks), comments: d.comments.length, projects: ids(d.projects), followers: d.followers.map((f) => `${f.userId}:${f.kind}`).sort() }];
        }),
      ),
    ),
    bundles: Object.fromEntries(
      await Promise.all(
        ids(projects).map(async (id) => {
          const b = await wq.getProjectBundle(actor, id);
          return [id, { tasks: ids(b.tasks), members: b.project.members.map((m) => `${m.userId}:${m.role}`).sort() }];
        }),
      ),
    ),
    settings: Object.fromEntries(
      await Promise.all(
        ids(projects).map(async (id) => {
          const s = await wq.getProjectSettings(actor, id);
          return [id, { rules: byId(s.rules).map((r) => ({ id: r.id, canManage: r.canManage, isEnabled: r.isEnabled })), templates: ids(s.templates) }];
        }),
      ),
    ),
    notifications: ids(await wq.listNotifications(actor)),
    views: ids(await wq.getSavedViews(actor)),
    trash: ids(await listTrash(actor)),
    projectTrash: ids(await listProjectTrash(actor)),
  };

  writeFileSync(process.env.SNAPSHOT_OUT!, JSON.stringify(out, null, 2));
});
