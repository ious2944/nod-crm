import { describe, expect, it } from "vitest";

import {
  canEditProjectContent,
  canManageProject,
  canReadProject,
  evaluateProjectTrashAccess,
  evaluateTaskAccess,
  evaluateTrashAccess,
  type Actor,
  type ProjectAccessInfo,
  type TaskAccessInfo,
} from "@/lib/tasks/access";

import { authorize } from "./authorize";
import { CAPABILITIES, CAPABILITY_RULES } from "./capabilities";

/**
 * Lot 0 : `authorize` ne fait que ré-exprimer les règles en vigueur. On le
 * vérifie en comparant, sur une matrice de cas, sa décision à celle des
 * fonctions de `access.ts` qu'il délègue.
 */

const W = "11111111-1111-4111-8111-111111111111";
const OTHER_W = "22222222-2222-4222-8222-222222222222";
const me: Actor = { id: "me", workspaceId: W };

const roles = [null, "OWNER", "EDITOR", "COMMENTER"] as const;
const projects: ProjectAccessInfo[] = [];
for (const visibility of ["WORKSPACE", "PRIVATE"] as const) {
  for (const role of roles) {
    for (const ownerId of [null, "me", "other"]) {
      for (const flags of [{}, { archivedAt: new Date() }, { deletedAt: new Date() }]) {
        projects.push({
          id: `p${projects.length}`,
          visibility,
          archivedAt: null,
          isTemplate: false,
          ownerId,
          createdById: ownerId === null ? "me" : "other",
          deletedAt: null,
          members: role ? [{ role }] : [],
          ...flags,
        });
      }
    }
  }
}

const tasks: TaskAccessInfo[] = [];
for (const assigneeId of [null, "me", "other"]) {
  for (const followers of [[], [{ kind: "COLLABORATOR" as const }], [{ kind: "FOLLOWER" as const }]]) {
    for (const projectSet of [[], [projects[0]], [projects[7]], [projects[40]], [projects[2]]]) {
      tasks.push({
        assigneeId,
        createdById: "other",
        followers,
        projects: projectSet.map((project) => ({ project })),
        parentId: null,
        deletedAt: null,
        parent: null,
      });
    }
  }
}

const expected = (allowed: boolean, readable: boolean) =>
  allowed ? { allowed: true } : { allowed: false, code: readable ? "FORBIDDEN" : "NOT_FOUND" };

describe("authorize — délègue aux règles de access.ts", () => {
  it("sans ressource, autorise tout acteur de session pour chaque capacité", () => {
    for (const capability of CAPABILITIES) expect(authorize(me, capability)).toEqual({ allowed: true });
  });

  it("refuse un acteur incomplet (garde de cohérence)", () => {
    expect(authorize({ id: "", workspaceId: W }, "crm.contact.create")).toEqual({ allowed: false, code: "FORBIDDEN" });
  });

  it("une ressource d'un autre espace est introuvable, quelle que soit la capacité", () => {
    expect(authorize(me, "crm.contact.update", { kind: "record", workspaceId: OTHER_W })).toEqual({ allowed: false, code: "NOT_FOUND" });
    expect(authorize(me, "task.edit", { kind: "task", workspaceId: OTHER_W, task: tasks[0] })).toEqual({
      allowed: false,
      code: "NOT_FOUND",
    });
  });

  it("une donnée de l'espace est accessible (règle actuelle du CRM et du RGPD)", () => {
    for (const capability of CAPABILITIES.filter((c) => CAPABILITY_RULES[c].scope === "record")) {
      expect(authorize(me, capability, { kind: "record", workspaceId: W })).toEqual({ allowed: true });
    }
  });

  it("tâches : identique à evaluateTaskAccess", () => {
    const rights = { "task.read": "canRead", "task.comment": "canComment", "task.edit": "canEdit", "task.manage": "canManage" } as const;
    for (const task of tasks) {
      const permissions = evaluateTaskAccess(task, me);
      for (const [capability, right] of Object.entries(rights) as [keyof typeof rights, (typeof rights)[keyof typeof rights]][]) {
        expect(authorize(me, capability, { kind: "task", workspaceId: W, task })).toEqual(
          expected(permissions[right], permissions.canRead),
        );
      }
    }
  });

  it("projets : identique à canReadProject / canEditProjectContent / canManageProject", () => {
    for (const project of projects) {
      const readable = canReadProject(project, me);
      const resource = { kind: "project" as const, workspaceId: W, project };
      expect(authorize(me, "project.read", resource)).toEqual(expected(readable, readable));
      expect(authorize(me, "project.edit", resource)).toEqual(expected(readable && canEditProjectContent(project, me), readable));
      expect(authorize(me, "project.manage", resource)).toEqual(expected(readable && canManageProject(project, me), readable));
    }
  });

  it("corbeilles : identique à evaluateTrashAccess / evaluateProjectTrashAccess", () => {
    for (const project of projects) {
      const rights = evaluateProjectTrashAccess(project, me);
      const visible = rights.canRestore || rights.canPurge;
      const resource = { kind: "project-trash" as const, workspaceId: W, project };
      expect(authorize(me, "project.restore", resource)).toEqual(expected(rights.canRestore, visible));
      expect(authorize(me, "project.purge", resource)).toEqual(expected(rights.canPurge, visible));
    }
    for (const base of tasks) {
      const task = { ...base, deletedAt: new Date(), deletedById: "me" };
      const rights = evaluateTrashAccess(task, me);
      const visible = rights.canRestore || rights.canPurge;
      const resource = { kind: "task-trash" as const, workspaceId: W, task };
      expect(authorize(me, "task.restore", resource)).toEqual(expected(rights.canRestore, visible));
      expect(authorize(me, "task.purge", resource)).toEqual(expected(rights.canPurge, visible));
    }
  });

  it("lot A — fiche CRM / RGPD : seul le propriétaire, sinon introuvable", () => {
    for (const capability of CAPABILITIES.filter((c) => CAPABILITY_RULES[c].scope === "owned")) {
      expect(authorize(me, capability, { kind: "record", workspaceId: W, ownerId: "me" })).toEqual({ allowed: true });
      expect(authorize(me, capability, { kind: "record", workspaceId: W, ownerId: "other" })).toEqual({ allowed: false, code: "NOT_FOUND" });
    }
  });

  it("lot A — étiquette et champ d'espace : visibles, modifiables par leur créateur seul (refus explicite)", () => {
    for (const capability of ["workspace.tag.write", "workspace.field.write"] as const) {
      expect(authorize(me, capability, { kind: "record", workspaceId: W, ownerId: "me" })).toEqual({ allowed: true });
      expect(authorize(me, capability, { kind: "record", workspaceId: W, ownerId: "other" })).toEqual({ allowed: false, code: "FORBIDDEN" });
      expect(authorize(me, capability, { kind: "record", workspaceId: W, ownerId: null })).toEqual({ allowed: false, code: "FORBIDDEN" });
    }
  });

  it("lot A — règle et modèle d'espace : personnels, introuvables pour les autres", () => {
    for (const capability of ["workspace.rule.write", "workspace.template.write"] as const) {
      expect(authorize(me, capability, { kind: "record", workspaceId: W, ownerId: "me" })).toEqual({ allowed: true });
      expect(authorize(me, capability, { kind: "record", workspaceId: W, ownerId: "other" })).toEqual({ allowed: false, code: "NOT_FOUND" });
    }
  });

  it("lot A — un projet WORKSPACE dont on n'est ni propriétaire ni membre n'est pas lisible", () => {
    const project: ProjectAccessInfo = {
      id: "p",
      visibility: "WORKSPACE",
      archivedAt: null,
      isTemplate: false,
      ownerId: "other",
      createdById: "other",
      deletedAt: null,
      members: [],
    };
    expect(authorize(me, "project.read", { kind: "project", workspaceId: W, project })).toEqual({ allowed: false, code: "NOT_FOUND" });
  });

  it("une ressource qui ne correspond pas à la capacité est une erreur de programmation", () => {
    expect(() => authorize(me, "task.edit", { kind: "record", workspaceId: W })).toThrow(/attend une ressource « task »/);
  });
});
