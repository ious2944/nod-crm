# Permissions V1 — cadrage

> Statut : **cadrage + lot 0**. Ce document décrit la règle cible, l'inventaire
> des points d'entrée et le plan des lots. Seul le lot 0 (point de contrôle
> central, sans changement de comportement) est implémenté.
>
> Documents liés : [`security-model.md`](security-model.md) (règle actuelle,
> frontière d'espace) et [`tasks.md`](tasks.md) (droits du module Tâches).

**Avertissement opérationnel.** Tant que les lots A et B ne sont pas livrés,
**ne créez aucun compte partenaire** (`npm run user:create`) dans un espace
existant. Aujourd'hui, un nouvel utilisateur d'un espace voit immédiatement
tout le CRM, le registre RGPD, les tâches libres et les projets `WORKSPACE`.

---

## 1. Point de départ (vérifié dans le code)

| Sujet | État actuel |
|---|---|
| Rôle d'espace | Aucun. Le seul rôle est `ProjectRole` (OWNER / EDITOR / COMMENTER) (`prisma/schema.prisma:87`). |
| Utilisateur ↔ espace | Un utilisateur a **un seul** espace (`User.workspaceId`, clé étrangère indexée, non unique : un espace a plusieurs utilisateurs). `User.email` est unique **globalement** : une adresse ne peut exister que dans un seul tenant. |
| Création de comptes | `scripts/admin.mjs` (`create-workspace`, `create-user`, `reset-password`, `disable-user`) ; `scripts/create-e2e-user.ts` pour les tests e2e. |
| Résolution de l'acteur | Actions : `getActorForAction` (`src/lib/workspace.ts`) → `requireActor` (`src/lib/auth/dal.ts`) → `readSession` (`src/lib/auth/session.ts`). Routes (`withActor`) et pages (`getPageActor`) passent directement par `getCurrentUser` / `requireUser` de la DAL. Le flux SSE et la photo de contact aussi. |
| Acteur | `Actor = { id, workspaceId }` (`src/lib/tasks/access.ts`). |
| Filtrage | 486 appels Prisma dans 32 fichiers (tous modèles, sessions et login compris), dont 263 portent littéralement `workspaceId` ; les autres passent par `readableProjectWhere` / `visibleTaskWhere`, par une clé déjà bornée, ou ne visent pas de donnée d'espace. 8 requêtes SQL brutes, dont 2 dans l'import de contacts (filtre `workspace_id`). Aucune extension Prisma de scoping. |
| Tâches | Prédicats centralisés dans `access.ts` : `readableProjectWhere`, `visibleTaskWhere`, `evaluateTaskAccess`, `canReadProject`, `canEditProjectContent`, `canManageProject`, `isProjectOwner`, `evaluateTrashAccess`, `evaluateProjectTrashAccess`. |
| CRM / RGPD | `where: { id, workspaceId }` écrit à la main dans chaque action ; les requêtes de lecture résolvent l'espace elles-mêmes (`getWorkspaceIdForPage`). |
| Partage | `ProjectMember` (OWNER / EDITOR / COMMENTER), `Project.visibility` `WORKSPACE` (défaut) \| `PRIVATE`, `Project.ownerId` (nullable ; `isProjectOwner` se rabat sur `createdById`). `setProjectMember` n'accepte que des membres actifs du même espace (`validMemberIds`). |
| Points d'écriture | **93** Server Actions d'écriture dans **9** fichiers (et non 8 : `contacts/import-actions.ts` est arrivé avec #54), + 6 actions de lecture, + `login` / `logout`, + **1** route d'écriture (`POST /api/tasks/items/[id]/attachments`). |

Règle actuelle du module Tâches, à garder en tête parce qu'elle est **plus
ouverte** que la cible : une tâche libre (sans projet) est visible **et gérable**
par tout l'espace ; un abonné (`FOLLOWER`) voit la tâche ; une sous-tâche est
visible dès que sa parente l'est.

---

## 2. Règle cible V1 (corrigée après la phase 0)

1. **Privé par défaut.** Chaque utilisateur voit :
   - ses propres fiches CRM : organisations, contacts, opportunités, suivis ;
   - ses propres fiches RGPD (sous réserve de la décision **e**) ;
   - ses tâches libres : il en est créateur, responsable ou collaborateur
     (le sort des **abonnés** est la décision **g**) ;
   - les sous-tâches d'une tâche qu'il voit, et une sous-tâche dont il est
     lui-même créateur, responsable ou collaborateur (la parente reste alors
     « tâche non accessible ») ;
   - ses projets : `ownerId` = lui, ou, à défaut d'`ownerId`, `createdById` =
     lui (même définition que `isProjectOwner`) ;
   - les projets qui lui sont partagés via `ProjectMember`.
2. **Seuls les projets sont partageables en V1.** Le CRM n'est jamais partagé.
   Une fiche CRM ne peut être liée (opportunité → organisation, contact →
   organisation, suivi → contact / opportunité, demande RGPD → contact,
   tâche → contact / suivi / opportunité, projet → CRM) **qu'à une fiche dont
   l'acteur est propriétaire**.
3. **Un projet partagé expose toutes ses tâches**, quel que soit leur
   responsable, avec sous-tâches, commentaires, pièces jointes, saisies de temps
   (décision **c**) et points d'avancement. Niveaux :
   - **Lecture** (`COMMENTER`) : lire, commenter, réagir, suivre ;
   - **Édition** (`EDITOR`) : modifier le contenu (tâches, sections, champs,
     formulaires, import CSV) ;
   - **Gestion** (`OWNER`) : réglages, membres, archivage, suppression.

   Envoyer un formulaire du projet demande l'**Édition** (aujourd'hui la
   lecture suffit : `submitForm`, `settings-service.ts`).
4. **Masquages dans un projet partagé**, pour qui n'a pas accès à la cible :
   - les liens vers des fiches CRM (projet → contact / organisation /
     opportunité ; tâche → contact / **suivi** / opportunité) ;
   - les autres projets d'une tâche multi-projets ;
   - les sous-tâches, parentes et dépendances hors projet, affichées
     « tâche non accessible », sans titre ;
   - dans l'historique (`TaskActivity.oldValue` / `newValue`, texte libre) et
     dans les notifications (`title` / `body`, instantanés), toute valeur qui
     nommerait une de ces cibles.
5. **Automatisations.** Une règle n'agit que sur les données de son auteur et
   sur les projets où il a l'Édition, avec ses droits **au moment de
   l'exécution** (c'est déjà le cas : `ruleActor`, `automations.ts`). Une règle
   « d'espace » (`projectId: null`) ne se déclenche que sur les événements de
   données dont son auteur est propriétaire.
6. **Migration.** Toutes les données existantes sont attribuées à leur créateur
   lorsqu'il est connu, sinon à l'utilisateur de référence de l'espace (voir
   §5). Pour lui, rien ne change. Un nouvel utilisateur voit zéro donnée — y
   compris dans la recherche, l'export, `/today`, le cockpit, le temps réel, les
   notifications et le contexte (`getWorkContext`).

Effets de bord à traiter explicitement :

- **Import de contacts** : le dédoublonnage et le mode « compléter » comparent
  aujourd'hui à tous les contacts de l'espace (`contacts/import/service.ts`).
  En V1, ils ne comparent qu'aux contacts de l'acteur (sinon l'aperçu révèle
  l'existence d'une fiche d'autrui et le mode « compléter » l'écrase).
- **Mentions** : déjà limitées aux personnes qui lisent la tâche ; la liste des
  mentionnables dépend de l'annuaire (décision **b**).
- **Temps réel** : `realtime-filter.ts` (`changeFor`) doit appliquer la même
  règle de lecture, sinon il fuit des identifiants.
- **Commentaires et saisies de temps d'autrui** dans un projet partagé :
  seul l'auteur modifie ou supprime un commentaire (déjà le cas) ; une saisie
  de temps d'autrui demande l'Édition (déjà le cas).

---

## 3. Inventaire des points d'écriture

Chaque ligne passe, depuis le lot 0, par `authorize` avec la capacité indiquée
(vérifié par `tests/unit/authz-inventory.test.ts`). « Règle actuelle » est le
contrôle fin fait par le service ou l'action, inchangé.

**Total : 99 Server Actions (93 écritures + 6 lectures) dans 9 fichiers, et 1
route d'écriture — 100 points d'entrée, tous enveloppés.** Hors périmètre :
`login` et `logout` (`src/app/login/actions.ts`), sans acteur par définition.

### 3.1 Commerce — `src/app/(app)/commerce/actions.ts` (`runCrmAction`)

| Action | Ressource | Capacité | Règle actuelle |
|---|---|---|---|
| `createOpportunity` | Opportunity (+ Organization, Contact liés) | `crm.opportunity.create` | organisation et contact de l'espace, non archivés |
| `updateOpportunity` | Opportunity | `crm.opportunity.update` | `findFirst({ id, workspaceId })` |
| `changeOpportunityStatus` | Opportunity | `crm.opportunity.update` | idem + machine à états |
| `deleteOpportunity` | Opportunity | `crm.opportunity.delete` | idem |
| `findOpportunities` *(lecture)* | Opportunity | `crm.opportunity.read` | `searchOpportunityOptions`, espace |

### 3.2 Contacts — `contacts/actions.ts`, `contacts/import-actions.ts` (`runCrmAction`)

| Action | Ressource | Capacité | Règle actuelle |
|---|---|---|---|
| `createContact` | Contact (+ Organization, photo) | `crm.contact.create` | organisation de l'espace |
| `updateContact` | Contact | `crm.contact.update` | `{ id, workspaceId }` |
| `archiveContact` / `restoreContact` | Contact | `crm.contact.archive` | `updateMany({ id, workspaceId })` |
| `findContacts` *(lecture)* | Contact | `crm.contact.read` | espace |
| `previewContactImport` *(lecture)* | Contact | `crm.contact.import` | dédoublonnage sur l'espace |
| `importContacts` | Contact, Organization | `crm.contact.import` | idem, transaction |

### 3.3 Suivis — `follow-ups/actions.ts` (`runCrmAction`)

| Action | Ressource | Capacité | Règle actuelle |
|---|---|---|---|
| `createFollowUp` | FollowUp (+ Contact, Opportunity) | `crm.followup.create` | cibles de l'espace |
| `applyQuickAction` | FollowUp | `crm.followup.update` | `{ id, workspaceId }` + transitions |
| `updateFollowUp` | FollowUp | `crm.followup.update` | `updateMany({ id, workspaceId })` |

### 3.4 Organisations — `organizations/actions.ts` (`runCrmAction`)

| Action | Ressource | Capacité | Règle actuelle |
|---|---|---|---|
| `createOrganization` | Organization | `crm.organization.create` | — |
| `updateOrganization` | Organization (+ Contact.organizationName) | `crm.organization.update` | `{ id, workspaceId }` |
| `archiveOrganization` / `restoreOrganization` | Organization | `crm.organization.archive` | `updateMany({ id, workspaceId })` |
| `findOrganizations` *(lecture)* | Organization | `crm.organization.read` | espace |

### 3.5 RGPD — `rgpd/actions.ts`, `rgpd/archive-actions.ts` (`runCrmAction`)

| Action | Ressource | Capacité | Règle actuelle |
|---|---|---|---|
| `createTreatment` | PrivacyTreatment (+ processors) | `privacy.treatment.create` | sous-traitants de l'espace |
| `updateTreatment` | PrivacyTreatment | `privacy.treatment.update` | `{ id, workspaceId }` |
| `archiveTreatment` / `restoreTreatment` | PrivacyTreatment | `privacy.treatment.archive` | `updateMany` borné, **silencieux** si l'id n'est pas de l'espace |
| `createProcessor` | PrivacyProcessor | `privacy.processor.create` | — |
| `updateProcessor` | PrivacyProcessor | `privacy.processor.update` | `updateMany` borné, renvoie « succès » même sans ligne touchée |
| `archiveProcessor` / `restoreProcessor` | PrivacyProcessor | `privacy.processor.archive` | `updateMany` borné, silencieux |
| `createPrivacyRequest` | PrivacyRequest (+ Contact) | `privacy.request.create` | contact de l'espace |
| `updatePrivacyRequest` | PrivacyRequest | `privacy.request.update` | `{ id, workspaceId }` |
| `createIncident` | PrivacyIncident | `privacy.incident.create` | — |
| `updateIncident` | PrivacyIncident | `privacy.incident.update` | `{ id, workspaceId }` |

`updateProcessor` garde son `try` : l'appel à `runCrmAction` est **dans** le
`try`, pour qu'une session absente reste un état « error » comme avant.

### 3.6 Tâches, formulaires historiques — `tasks/actions.ts` (`runCrmAction`)

Ces actions renvoient des états de formulaire : `runAction` en changerait la
forme, d'où le helper transparent.

| Action | Ressource | Capacité | Règle actuelle |
|---|---|---|---|
| `createTask` | Task (+ Contact, FollowUp, Opportunity) | `task.create` | cibles CRM de l'espace ; service `createTask` |
| `updateTask` | Task | `task.edit` | `requireTaskEdit` |
| `applyTaskAction` | Task | `task.edit` | `visibleTaskWhere` puis `requireTaskEdit` |
| `findFollowUps` *(lecture)* | FollowUp | `crm.followup.read` | espace |

### 3.7 Gestion de travail — `tasks/work-actions.ts` (`runAction`)

| Action | Ressource | Capacité | Règle actuelle (service) |
|---|---|---|---|
| `createTaskAction` | Task | `task.create` | `requireProjectContentEdit` si projet ; parente : `requireTaskEdit` |
| `updateTaskAction` | Task | `task.edit` | `requireTaskEdit` |
| `deleteTaskAction` | Task | `task.manage` | `requireTaskManage` |
| `restoreTaskAction` | Task (corbeille) | `task.restore` | `evaluateTrashAccess.canRestore` |
| `purgeTaskAction` | Task (corbeille) | `task.purge` | `evaluateTrashAccess.canPurge` |
| `duplicateTaskAction` | Task | `task.manage` | `requireTaskManage` |
| `moveTaskAction` | Task, TaskProject | `task.manage` | `requireTaskManage` + `requireProjectContentEdit` (cible) |
| `addTaskToProjectAction` | TaskProject | `task.manage` | idem |
| `removeTaskFromProjectAction` | TaskProject | `task.manage` | idem |
| `moveSubtaskAction` | Task | `task.edit` | `requireTaskEdit` |
| `setTaskParentAction` | Task | `task.manage` | `requireTaskManage` (tâche et parente) |
| `setTaskTagsAction` | TaskTag | `task.edit` | `requireTaskEdit` |
| `setCustomFieldValueAction` | TaskCustomFieldValue | `task.edit` | `requireTaskEdit` |
| `addDependencyAction` | TaskDependency | `task.edit` | `requireTaskEdit` (bloquée) + `requireTaskRead` (bloquante) |
| `removeDependencyAction` | TaskDependency | `task.edit` | `requireTaskEdit` |
| `setFollowerAction` | TaskFollower | `task.read` | soi-même en abonné : lecture ; sinon `requireTaskManage` |
| `addTimeEntryAction` | TaskTimeEntry | `task.edit` | `requireTaskEdit` |
| `deleteTimeEntryAction` | TaskTimeEntry | `task.read` | sa saisie : lecture ; celle d'autrui : `requireTaskEdit` |
| `addCommentAction` | Comment | `task.comment` | lecture de la tâche / du projet |
| `editCommentAction` | Comment | `task.comment.own` | auteur + accès actuel |
| `deleteCommentAction` | Comment | `task.comment.own` | idem |
| `toggleReactionAction` | CommentReaction | `task.comment` | lecture |
| `bulkUpdateAction` | Task × n | `task.edit` | `requireTaskEdit` par tâche |
| `bulkPatchAction` | Task × n | `task.edit` | idem |
| `bulkDeleteAction` | Task × n | `task.manage` | `requireTaskManage` par tâche |
| `bulkMoveAction` | Task × n | `task.manage` | comme `moveTaskAction` |
| `deleteAttachmentAction` | TaskAttachment | `task.edit` | `requireTaskEdit` |
| `createProjectAction` | Project | `project.create` | membres de l'espace, liens CRM de l'espace, modèle lisible |
| `updateProjectAction` | Project | `project.manage` | `requireProjectManage` |
| `duplicateProjectAction` | Project | `project.read` | `requireProjectRead` |
| `archiveProjectAction` | Project | `project.manage` | `requireProjectManage` |
| `deleteProjectAction` | Project | `project.manage` | `requireProjectManage` |
| `restoreProjectAction` | Project (corbeille) | `project.restore` | `evaluateProjectTrashAccess.canRestore` |
| `previewProjectPurgeAction` *(lecture)* | Project (corbeille) | `project.purge` | `canPurge` |
| `purgeProjectAction` | Project (corbeille) | `project.purge` | `canPurge` + jeton de périmètre |
| `setProjectMemberAction` | ProjectMember | `project.manage` | `requireProjectManage` + `validMemberIds` |
| `setFavoriteAction` | ProjectFavorite | `project.read` | `requireProjectRead` |
| `createSectionAction` | ProjectSection | `project.edit` | `requireProjectEdit` |
| `renameSectionAction` | ProjectSection | `project.edit` | `requireSection` (édition du projet) |
| `moveSectionAction` | ProjectSection | `project.edit` | idem |
| `deleteSectionAction` | ProjectSection | `project.edit` | idem |
| `postStatusUpdateAction` | ProjectStatusUpdate | `project.edit` | `requireProjectEdit` |
| `commentStatusUpdateAction` | Comment | `project.read` | `requireProjectRead` |
| `setProjectFieldAction` | ProjectCustomField | `project.edit` | `requireProjectEdit` |
| `importCsvAction` | Task × n | `project.edit` | `requireProjectEdit` |
| `createTagAction` / `updateTagAction` / `deleteTagAction` | Tag | `workspace.tag.write` | espace |
| `saveCustomFieldAction` / `deleteCustomFieldAction` | CustomField | `workspace.field.write` | espace ; champ de projet : `requireProjectEdit` |
| `saveRuleAction` / `deleteRuleAction` | AutomationRule | `workspace.rule.write` | `requireRuleManage` (projet : édition ; espace : auteur) |
| `saveTaskTemplateAction` / `deleteTaskTemplateAction` | TaskTemplate | `workspace.template.write` | espace ; modèle de projet : `requireProjectEdit` |
| `taskToTemplateAction` | TaskTemplate | `workspace.template.write` | `requireTaskRead` |
| `saveFormAction` / `deleteFormAction` | TaskForm | `project.edit` | `requireProjectEdit` |
| `submitFormAction` | Task | `project.read` | `requireProjectRead` (puis création « de confiance ») |
| `saveViewAction` / `deleteViewAction` | SavedView | `user.view.write` | propres vues ; portée projet : lecture |
| `markNotificationsAction` | Notification | `user.notification.write` | propres notifications |
| `setNotificationPreferenceAction` | NotificationPreference | `user.notification.write` | soi |
| `setWeeklyCapacityAction` | User.weeklyCapacityMinutes | `user.capacity.write` | soi |

### 3.8 Routes d'écriture (`withActor(…, capacité)`)

| Route | Ressource | Capacité | Règle actuelle |
|---|---|---|---|
| `POST /api/tasks/items/[id]/attachments` | TaskAttachment | `task.edit` | même origine, `requireTaskEdit`, taille, type |

Les 18 autres routes sont des `GET` (§4).

### 3.9 Écrivains hors requête (pas d'acteur de session)

Ils ne passent pas par `authorize` au lot 0 et sont à traiter aux lots A / B :

| Écrivain | Fichier | Remarque V1 |
|---|---|---|
| Moteur de règles (`processEvents`, `runScheduledRule`) | `src/lib/tasks/automations.ts` | agit avec les droits de l'auteur (`ruleActor`) ; filtrer les règles d'espace sur la propriété (règle 5) |
| Récurrences, rappels, jobs | `scheduler.ts`, `task-reminders.ts`, `jobs.ts`, `recurrence.ts` | héritent de la tâche source ; rappels seulement à qui lit la tâche |
| Notifications | `notify.ts` | déjà filtrées par `evaluateTaskAccess(…).canRead` |
| CLI d'administration | `scripts/admin.mjs` | création de comptes : lot C |
| Seed | `prisma/seed.ts` | données de démo : propriétaire = utilisateur de démo |

---

## 4. Inventaire des points de lecture

« Filtre V1 » est ce que chaque lecture devra appliquer au lot A (propriété) et
au lot B (partage de projet). Notation : *own* = `ownerId = actor.id` ;
*visibleTask* = `visibleTaskWhere` réécrit selon la règle 1 ;
*readableProject* = projets possédés ou partagés.

### 4.1 Pages

| Page | Lecture | Filtre V1 |
|---|---|---|
| `/today` | `getTodayFeed`, `getActionableFollowUps`, `getActionableTasks`, `getTasksForKpi` | suivis *own* ; tâches *visibleTask* |
| `/commerce`, `/commerce/[id]` | `listOpportunities`, `getCommerceStats`, `getOpportunityDetail` (tâches liées) | *own* ; tâches liées *visibleTask* |
| `/contacts`, `/contacts/[id]` | `listContactsPage`, `listOrganizationOptions`, `getContactDetail` (suivis, tâches) | *own* |
| `/organizations`, `/organizations/[id]` | `listOrganizationsPage`, `getOrganizationDetail` (contacts, tâches) | *own* |
| `/follow-ups` | `getFollowUpBoard` | *own* |
| `/rgpd`, `/rgpd/*` | `getPrivacyDashboard`, `listPrivacy*` (dont `listPrivacyContactOptions`) | décision **e** ; contacts *own* |
| `/tasks` (layout) | `getWorkContext` : utilisateurs, tags, champs, projets, non lus | annuaire (**b**), tags / champs (**a**), *readableProject* |
| `/tasks`, `/tasks/favorites`, `/tasks/portfolio`, `/tasks/workload` | `getMyTasks`, `listProjects`, `getWorkload` | *visibleTask*, *readableProject* ; charge : annuaire (**b**) |
| `/tasks/projects`, `/tasks/projects/[id]` | `listProjects`, `getProjectBundle` / `getProjectDetail` | *readableProject* + masquages (règle 4) |
| `/tasks/t/[id]` | `getTaskDetail`, `resolveTaskLocation` | *visibleTask* + masquages |
| `/tasks/search` | `searchTasks` | *visibleTask* |
| `/tasks/forms`, `/tasks/forms/[id]` | `listForms`, `getForm` | *readableProject* ; envoi : Édition |
| `/tasks/notifications` | `listNotifications` | destinataire (inchangé) ; instantanés : règle 4 |
| `/tasks/settings` | tags, champs, règles, modèles, préférences | décision **a** |
| `/tasks/trash` | `listTrash`, `listProjectTrash` | inchangé (droits de gestion), sur *visibleTask* |

### 4.2 Routes `GET`

| Route | Lecture | Filtre V1 |
|---|---|---|
| `/api/contacts/[id]/photo` | `contact.findFirst({ id, workspaceId })` | *own* |
| `/api/health` | sonde | aucun (pas de donnée) |
| `/api/tasks/attachments/[id]` | `readAttachment` (`requireTaskRead`) | *visibleTask* |
| `/api/tasks/context` | `getWorkContext` | comme le layout |
| `/api/tasks/crm` | `searchCrm` (sélecteur CRM) | *own* |
| `/api/tasks/export` | `getMyTasks`, `getProjectBundle`, `searchTasks`, `getWorkContext` | *visibleTask* + masquages ; colonnes CRM masquées |
| `/api/tasks/find` | `quickFindTasks` | *visibleTask* |
| `/api/tasks/items/[id]` | `getTaskDetail` | *visibleTask* + masquages |
| `/api/tasks/linked` | `getLinkedWork` (CRM → travail) | fiche *own*, tâches *visibleTask* |
| `/api/tasks/my` | `getMyTasks` | *visibleTask* |
| `/api/tasks/notifications` | `listNotifications` | destinataire |
| `/api/tasks/projects`, `/api/tasks/projects/[id]`, `…/settings` | `listProjects`, `getProjectBundle`, `getProjectSettings` | *readableProject* |
| `/api/tasks/search` | `searchTaskIds`, `searchTasks` | *visibleTask* |
| `/api/tasks/stream` (SSE) | `subscribe(workspaceId)` + `changeFor` | même règle que la lecture, appliquée par événement |
| `/api/tasks/trash` | `listTrash`, `listProjectTrash` | comme la page |
| `/api/tasks/views` | `getSavedViews` | propres vues (inchangé) |

### 4.3 Lectures déguisées en actions

`findContacts`, `findOrganizations`, `findOpportunities`, `findFollowUps`,
`previewContactImport`, `previewProjectPurgeAction` : filtre *own* (ou droits de
corbeille), comme les pages correspondantes. Elles passent déjà par `authorize`.

### 4.4 Cockpit

`getCockpit` (`src/lib/cockpit/queries.ts`) : suivis *own*, tâches
*visibleTask*. Le journal d'audit n'a aucune lecture applicative.

---

## 5. Modèles qui recevront un `ownerId` (lot A)

Principe : `ownerId String? @db.Uuid`, relation `User` en `SetNull` (comme
`createdById`), index `(workspaceId, ownerId)`. Renseignement en migration :
champ créateur s'il existe, sinon journal d'audit (`AuditLog` `CREATE`,
`entityType`, `entityId`, `userId`), sinon **utilisateur de référence de
l'espace** (le seul utilisateur, ou le plus ancien actif — à confirmer espace
par espace avant migration).

| Modèle | Champ créateur existant | Renseignement de `ownerId` |
|---|---|---|
| `Organization` | aucun | `AuditLog` (`Organization`, `CREATE`), sinon référence |
| `Contact` | aucun | `AuditLog` (`Contact`, `CREATE`) ; imports CSV (`ContactImport`, sans `entityId`) et seed → référence |
| `Opportunity` | aucun | `AuditLog` (`Opportunity`, `CREATE`), sinon référence |
| `FollowUp` | aucun | `AuditLog` (`FollowUp`, `CREATE`), sinon référence |
| `PrivacyTreatment`, `PrivacyProcessor`, `PrivacyRequest`, `PrivacyIncident` | aucun (`owner` est un **texte libre**, à ne pas confondre) | selon la décision **e** : `AuditLog`, sinon référence |
| `Task` (tâches libres) | `createdById` | `createdById`, sinon référence. Pas de nouveau champ nécessaire si la règle s'exprime sur `createdById` / `assigneeId` / collaborateurs (recommandé) |
| `Project` | `ownerId` existe déjà, `createdById` | aucun nouveau champ ; combler `ownerId` nul par `createdById`, sinon référence |
| `Tag`, `CustomField`, `TaskTemplate`, `AutomationRule`, `TaskForm` | `createdById` sur `TaskTemplate` et `AutomationRule` seulement | uniquement si la décision **a** les rend personnels ; `Tag` est `@@unique([workspaceId, name])`, contrainte à revoir dans ce cas |
| `SavedView`, `Notification`, `NotificationPreference`, `ProjectFavorite`, `TaskTimeEntry` | `userId` | déjà personnels : rien à ajouter |
| `Comment`, `ProjectStatusUpdate`, `TaskAttachment` | `authorId` / `uploadedById` | suivent leur tâche ou leur projet : rien à ajouter |

Garde-fou de migration : tant qu'un espace a un seul utilisateur, la migration
est sans effet visible. S'il en a plusieurs **avant** le lot A, l'attribution
par l'audit est incomplète ; la migration doit refuser de tourner sans une
correspondance explicite (« espace → utilisateur de référence ») fournie par
l'administrateur.

---

## 6. Décisions ouvertes

Recommandations argumentées ; **aucune n'est tranchée par ce document.**

**(a) Tags, champs personnalisés, modèles et règles d'espace : communs ou par
utilisateur ?**
Recommandation : **communs au tenant pour les tags et la bibliothèque de
champs, personnels pour les règles d'espace, modèles au choix de l'auteur.**
Les tags et champs sont du vocabulaire : les dupliquer par personne casse le
filtrage d'un projet partagé (un même tag sous deux identifiants) et heurte la
contrainte `@@unique([workspaceId, name])`. Leur nom peut fuiter un peu
d'information : réserver leur création / suppression au propriétaire de
l'espace (rôle d'espace minimal, lot C). Les règles d'espace (`projectId:
null`) agissent sur des données : elles doivent être personnelles, sinon une
règle d'un utilisateur s'appliquerait aux tâches d'un autre (règle 5).

**(b) Annuaire : le partenaire voit-il la liste des utilisateurs du tenant ?**
Recommandation : **non ; il voit les membres des projets qui lui sont partagés,
plus lui-même.** `getWorkContext` renvoie aujourd'hui tous les utilisateurs
(e-mail compris) : c'est une fuite pour une autre entité juridique. Le
propriétaire du projet, lui, doit pouvoir choisir n'importe quel utilisateur
actif de l'espace pour l'inviter (sélecteur filtré côté serveur, par e-mail
exact si l'on veut aller plus loin).

**(c) Saisies de temps : visibles par tous les membres du projet, ou seulement
les siennes plus le total ?**
Recommandation : **les siennes en détail + le total par tâche ; le détail de
tous pour la Gestion.** Le temps passé par un partenaire peut être une donnée
commerciale (facturation) ; le total suffit au pilotage du projet et la Gestion
garde la vue détaillée.

**(d) Le responsable d'une tâche garde-t-il le droit de l'éditer s'il n'a que
Lecture sur le projet ?**
Recommandation : **oui, pour ses champs (statut, échéance, description,
temps), non pour la structure** (déplacer, supprimer, partager). C'est la règle
actuelle d'`evaluateTaskAccess` (`canEdit` vs `canManage`) : la garder évite de
casser l'usage « je mets à jour ma tâche » et ne permet pas de sortir la tâche
du projet.

**(e) Registre RGPD : par utilisateur, ou commun ?**
Recommandation : **par utilisateur (propriétaire), au même titre que le CRM.**
Le partenaire est une autre entité juridique : il est son propre responsable de
traitement et ne doit ni voir ni modifier le registre de l'hôte. Un registre
commun n'aurait de sens que pour une même entité, ce qui n'est pas le cas
d'usage V1.

**(f) Que devient `visibility = WORKSPACE` ?**
Recommandation : **la garder comme option explicite, et changer le défaut des
nouveaux projets en `PRIVATE`.** La supprimer imposerait de convertir les
projets existants et contredirait « pour lui, rien ne change » dès qu'un espace
a plusieurs utilisateurs internes. Au lot B, `WORKSPACE` doit être réservé aux
utilisateurs internes (à définir au lot C) : un partenaire ne voit jamais un
projet `WORKSPACE` dont il n'est pas membre.

Décisions supplémentaires révélées par la phase 0 :

**(g) Abonnés (`FOLLOWER`) d'une tâche libre ou hors projet :** recommandation —
l'abonnement ne donne plus accès à lui seul (il découle d'un accès) ; un abonné
existant sans autre lien perd la tâche après migration (rare, à journaliser).

**(h) Rôle d'espace minimal :** recommandation — un drapeau `User.isPartner`
(ou un rôle `MEMBER` / `PARTNER`) au lot C, nécessaire pour (a), (b) et (f).

---

## 7. Plan des lots

| Lot | Contenu | Changement visible |
|---|---|---|
| **0** (ce lot) | `src/lib/authz` : `Capability`, `authorize`, `runCrmAction` ; toutes les actions et la route d'écriture passent par `authorize` ; test d'inventaire ; tests d'isolation A/B | **aucun** |
| **A** — privé par défaut + migration | `ownerId` (§5) et migration ; `checkRecord` vérifie la propriété ; toutes les lectures CRM / RGPD (§4) filtrent *own* ; liaisons CRM limitées aux fiches *own* ; tâches libres limitées à créateur / responsable / collaborateur ; import de contacts dédoublonné sur *own* ; règles d'espace personnelles ; tests « un nouvel utilisateur voit zéro donnée » sur chaque lecture du §4 | oui, pour tout utilisateur autre que l'utilisateur de référence |
| **B** — partage de projet + masquages | `readableProjectWhere` sans `WORKSPACE` implicite pour les partenaires ; niveaux Lecture / Édition / Gestion ; masquages de la règle 4 (sérialisation, historique, notifications, export, SSE) ; `submitForm` exige l'Édition ; les services passent leur ressource à `authorize` (`loadAccess`, `loadProject`, `requireProjectContentEdit`) | oui |
| **C** — compte partenaire | rôle d'espace minimal (h) ; création via `admin.mjs` (et éventuellement invitation) ; annuaire restreint (b) ; e-mail unique global à garder ou à revoir | oui |

---

## 8. Lot 0 — mécanisme

- **`src/lib/authz/capabilities.ts`** : `CAPABILITY_RULES`, catalogue des
  capacités et de la règle existante associée ; `Capability` en est l'union de
  chaînes. Constante (et pas seulement un type) pour que le test d'inventaire
  refuse une chaîne inconnue.
- **`src/lib/authz/authorize.ts`** : `authorize(actor, capability, resource?)`
  → `{ allowed: true } | { allowed: false, code: "NOT_FOUND" | "FORBIDDEN" }`.
  Sans ressource : acteur de session ⇒ autorisé (seule condition actuelle à
  l'entrée d'une action). Avec ressource : même espace, puis la fonction de
  `access.ts` correspondante. Point d'extension du lot A : `checkRecord`.
  Équivalence avec `access.ts` vérifiée par `src/lib/authz/authorize.test.ts`.
- **`runCrmAction(capability, fn)`** (`src/lib/authz/run-crm-action.ts`) :
  résout l'acteur une fois (`getActorForAction`), appelle `authorize`, exécute
  `fn(actor)` et rend son résultat **tel quel** — mêmes types de retour, mêmes
  erreurs (`UnauthenticatedError` sans session), contrairement à `runAction`
  qui convertit tout en `ActionResult`.
- **`runAction(capability, fn)`** et **`withActor(handler, capability?)`** :
  même appel à `authorize`, refus converti comme un `TaskAccessError` du même
  code. `withActor` sans capacité reste la forme des lectures.
- **Test d'inventaire** (`tests/unit/authz-inventory.test.ts`) : analyse
  statique (arbre syntaxique TypeScript) de tous les fichiers `"use server"`
  sous `src/app` et de toutes les routes. Chaque action exportée doit avoir pour
  corps unique `return runAction|runCrmAction("<capacité>", …)` (seule variante :
  un `try` qui ne contient que cet appel) ; chaque `POST` / `PUT` / `PATCH` /
  `DELETE` doit finir par `return withActor(…, "<capacité>")`, précédé au plus
  de la garde `isSameOrigin`. Les exclusions (`login`, `logout`) sont figées.
  Choix d'une analyse statique plutôt qu'un registre à l'exécution : un
  registre prouve qu'`authorize` a été appelé, pas qu'il l'a été **avant** toute
  requête ; la forme imposée garantit l'ordre par construction, sans devoir
  exécuter chaque action avec des arguments valides.
- **Isolation A/B** (`tests/integration/authz-isolation.test.ts`) : une action
  par module (commerce, contacts, import, suivis, organisations, RGPD, tâches,
  pièce jointe, projets, espace) ; un acteur de B visant un identifiant de A
  obtient exactement la réponse d'avant le lot 0, et la donnée de A est
  intacte. Écrit et passé **sur le code d'avant** le lot 0, puis après.

Les `where: { id, workspaceId }` et les contrôles des services sont inchangés :
le lot 0 ajoute un point de contrôle, il n'en retire aucun.
