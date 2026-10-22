# Permissions V1 — cadrage

> Statut : **cadrage + lot 0 + lot A + lot B**. Ce document décrit la règle
> cible, l'inventaire des points d'entrée et le plan des lots. Le lot 0 (point
> de contrôle central), le lot A (privé par défaut + migration, §9) et le lot B
> (masquages dans un projet partagé, partage par e-mail, §10) sont
> implémentés ; le lot C reste à faire.
>
> Documents liés : [`security-model.md`](security-model.md) (règle actuelle,
> frontière d'espace) et [`tasks.md`](tasks.md) (droits du module Tâches).

**Avertissement opérationnel.** Le lot A rend un nouvel utilisateur aveugle
aux données des autres ; le lot B masque, dans un projet partagé, les fiches
CRM liées. **Ne partagez aucun projet avec un partenaire avant que le lot B
soit déployé.** Une fois le lot B en production, un partenaire peut être
accueilli avec les précautions de
[`accueillir-un-partenaire.md`](accueillir-un-partenaire.md) (le lot C, rôle
d'espace, reste à faire : §10.5).

---

## 1. Point de départ (vérifié dans le code)

| Sujet | État actuel |
|---|---|
| Rôle d'espace | Aucun. Le seul rôle est `ProjectRole` (OWNER / EDITOR / COMMENTER) (`prisma/schema.prisma:86`). |
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
| `moveTaskAction` | Task, TaskProject | `task.manage` | `requireTaskRead`, `requireProjectContentEdit` (cible), puis `requireTaskManage` si la tâche n'est pas déjà dans ce projet (sinon `canManage` est acquis par l'édition du projet) |
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
| `addCommentAction` | Comment | `task.comment` | `requireTaskRead` + `canComment` |
| `editCommentAction` | Comment | `task.comment.own` | auteur + accès actuel (tâche ou point d'avancement) |
| `deleteCommentAction` | Comment | `task.comment.own` | idem |
| `toggleReactionAction` | CommentReaction | `task.comment` | lecture de la tâche, ou du projet pour un commentaire de point d'avancement (au lot B : `project.read` dans ce cas) |
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
| `addProjectMemberByEmailAction` *(lot B)* | ProjectMember | `project.manage` | `requireProjectManage` ; compte actif de l'espace, adresse exacte ; Lecture ou Édition seulement |
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
| `PrivacyTreatment`, `PrivacyProcessor`, `PrivacyRequest`, `PrivacyIncident` | aucun (`owner` de Treatment, Request et Incident est un **texte libre**, à ne pas confondre) | selon la décision **e** : `AuditLog`, sinon référence |
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
| **B** — partage de projet + masquages (implémenté, §10) | `readableProjectWhere` sans `WORKSPACE` implicite pour les partenaires ; niveaux Lecture / Édition / Gestion ; masquages de la règle 4 (sérialisation, historique, notifications, export, SSE) ; `submitForm` exige l'Édition ; les services passent leur ressource à `authorize` (`loadAccess`, `loadProject`, `requireProjectContentEdit`) | oui |
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

**Ce que le lot 0 garantit, et ce qu'il ne garantit pas encore.** Les trois
appels de production (`runCrmAction`, `runAction`, `withActor`) appellent
`authorize` **sans ressource** : il ne peut refuser qu'un acteur incomplet, ce
qu'une session ne produit jamais. Les capacités sont donc, à ce stade, des
étiquettes figées et vérifiées (la table du test d'inventaire reprend la
colonne « Capacité » du §3) ; la branche avec ressource n'est exercée que par
`authorize.test.ts`. Elle devient active au lot A (`checkRecord`) et au lot B
(services). Le test d'inventaire impose aussi : helper importé de son module,
exactement deux arguments (capacité littérale, fonction), pas de `finally`, un
`catch` sans appel, aucune directive `"use server"` inline, aucune méthode
d'écriture ré-exportée dans une route ; il parcourt tout `src/`.

Limites connues, assumées au lot 0 : `withActor` prend la capacité en second
argument optionnel (une route d'écriture qui l'oublie compile ; seul le test la
rattrape) ; rien n'interdit techniquement à une route `GET` d'écrire (aucune ne
le fait aujourd'hui).

---

## 9. Lot A — privé par défaut + migration (implémenté)

### 9.1 Décisions figées appliquées

| Décision | Mise en œuvre |
|---|---|
| (a) étiquettes, champs d'espace | lisibles par tout l'espace ; modification et suppression par leur créateur seul (`createdById`, refus `FORBIDDEN` car la donnée est visible). Règles d'automatisation et modèles de tâche **d'espace** : personnels (`NOT_FOUND` pour les autres). Les règles et modèles **de projet** suivent l'Édition du projet, inchangé. |
| (b) annuaire | `directoryUserWhere(actor)` : soi + propriétaires et membres des projets lisibles. Sert à `getWorkContext` (et donc à tous les sélecteurs), à la charge, et **côté serveur** à la validation d'un responsable, d'un collaborateur, d'un abonné, des destinataires d'une règle et des responsables d'un import CSV. L'adresse d'une autre personne n'est plus exposée (nom affiché, sinon « Membre de l'espace »). |
| (e) RGPD | traitements, sous-traitants, demandes, incidents : par propriétaire, comme le CRM. |
| (f) `WORKSPACE` | conservé dans l'enum ; tous les projets passent en `PRIVATE` (backfill) ; défaut du schéma `PRIVATE` ; création, modification et duplication refusent ou neutralisent `WORKSPACE` ; option retirée de l'interface ; aucun prédicat ne lit plus la visibilité. |
| (g) abonnés | un `FOLLOWER` n'a plus aucun accès ; créateur, responsable et `COLLABORATOR` restent les voies d'accès à une tâche **libre**. |

### 9.2 Règle implémentée

- **CRM et RGPD** : `crmReadableWhere(actor)` = `{ workspaceId, ownerId: actor.id }`
  dans chaque lecture (pages, sélecteurs, cockpit, `/today`, fiches, photo,
  `searchCrm`, `getCrmRef`, `getLinkedWork`) et chaque écriture (fiche visée et
  toutes les liaisons : organisation, contact, opportunité, suivi,
  sous-traitant). `ownerId = actor.id` à toute création, jamais lu du client.
- **Projets** : propriétaire (`ownerId`, sinon `createdById` s'il n'y en a plus)
  ou membre. `projectAccessWhere` / `readableProjectWhere` / `canReadProject`
  sont la seule source ; le filtre temps réel et `notify.ts` les utilisent.
- **Tâches** : racine visible si elle est dans un projet lisible, ou libre et
  l'acteur en est créateur, responsable ou collaborateur ; une sous-tâche
  suit sa racine et seulement elle. Un responsable non membre d'un projet ne
  lit plus la tâche (la règle « responsable en Lecture » est au lot B).
- **Corbeille des tâches libres** : réservée aux personnes impliquées (et à
  celle qui a supprimé), plus à tout l'espace.
- **Retirer une tâche de son seul projet / la rattacher à une parente** :
  refusé seulement si une personne y gagnerait l'accès (`gainsReaders`) — les
  anciennes gardes reposaient sur « une tâche libre est visible de tous ».
- **`submitForm`** : exige l'Édition (introuvable sans lecture ; refus explicite
  pour un commentateur). Le contexte de confiance n'est plus utilisé.
- **Import de contacts** : analyse, dédoublonnage, complément et organisations
  rattachées dans les seuls contacts de l'acteur.
- **Automatisations** (`canAutomateTask`) : une règle n'agit que sur une tâche
  libre de son auteur ou une tâche d'un projet où il a l'Édition — le contrôle
  est dans `runRule`, donc vaut pour les événements d'activité, le
  planificateur et les rappels. Un tiers qui déclenche une règle n'obtient
  jamais, par elle, une écriture que l'auteur ne pourrait pas faire.
- **Notifications** : `readableNotificationWhere` filtre la liste **et** le
  compteur : seulement les siennes, sur une tâche ou un projet lisible.
- **Temps réel** : un changement sans cible visible n'est pas transmis ;
  l'auteur d'un changement n'est transmis que s'il s'agit de soi ou si la
  cible est visible.
- **`authorize`** : capacités par ressource désormais actives — portées `owned`
  (CRM, RGPD), `authored` (étiquettes, champs), `personal` (règles et modèles
  d'espace), `task.*` et `project.*` passés par `requireTask*` /
  `requireProject*`. Introuvable pour une ressource non lisible, réponse
  actuelle conservée pour une ressource lisible mais non modifiable.

### 9.3 Migration et déploiement

Trois étapes, déployables séparément :

1. **`20261021090000_permissions_owner_additive`** — `owner_id` nullable sur les
   8 modèles CRM / RGPD (`ON DELETE NO ACTION` : la suppression d'un espace
   passe, celle d'un utilisateur qui possède des fiches est refusée),
   `created_by_id` sur `tags` et `custom_fields`, index `(workspace_id,
   owner_id)`. Aucun changement de comportement.
2. **`scripts/backfill-owner.mjs`** — attribue tout au propriétaire de
   migration (voir l'en-tête du script pour le détail et les garde-fous :
   refus si un autre utilisateur actif existe hors comptes e2e désignés par
   `--e2e-user` et en `.test`, idempotent, `--dry-run`, une transaction, verrou
   consultatif). Il préserve aussi ce que voyait la propriétaire : adhésion
   `EDITOR` sur un projet « espace » qu'elle ne possédait pas, collaboratrice
   des tâches libres d'une autre personne, règles et modèles d'espace sans
   auteur (ou d'un auteur inactif) repris — les règles désactivées, puisqu'elles
   ne s'exécutaient pas.
3. **`20261021100000_permissions_owner_required`** — `owner_id` NOT NULL,
   défaut `PRIVATE`. Refuse de s'appliquer, avant toute modification, s'il
   reste un NULL ou un projet `WORKSPACE` (message nommant les tables).

`prisma migrate deploy` (service `migrate` de `docker-compose.yml`) applique
toutes les migrations en attente d'un coup : les étapes passent donc par **deux
déploiements**, avec le backfill entre les deux. Le code d'avant le lot A ne
renseigne pas `owner_id` : toute création faite entre les deux déploiements
laisse un NULL — d'où la **relance du backfill application arrêtée**, juste
avant le déploiement final.

#### Procédure VPS, pas à pas

Depuis le répertoire du dépôt sur le serveur, en `sudo` comme pour les
sauvegardes. Références :

- `pre-lot-a` — étiquette posée sur `3c83e86`, la branche principale juste
  avant le lot A : point de retour stable, indépendant de la fusion ;
- `FINAL` — le commit de fusion du lot A sur la branche principale.

Le **déploiement 1** est le code `pre-lot-a` augmenté du seul répertoire de la
migration 1, pris dans `FINAL` : `prisma migrate deploy` ne lit que les
fichiers de migration, et l'ancien code ignore les colonnes ajoutées. Le
backfill ne tourne **qu'application arrêtée** : le code d'avant lit un projet
`PRIVATE` comme « membres seulement », et un projet attribué par le backfill
sans adhésion y disparaîtrait jusqu'au déploiement final.

1. **Sauvegarde vérifiée** (base et photos) :
   ```bash
   sudo ./deploy/backup/nod-crm-backup.sh
   sudo ./deploy/backup/nod-crm-restore.sh --verify
   ```
   Elle couvre les photos et l'état d'avant toute migration (filet de sécurité
   si le déploiement 1 lui-même échoue).
2. **Repérer les espaces et leur propriétaire** :
   ```bash
   docker compose exec app node scripts/admin.mjs list-workspaces
   docker compose exec app node scripts/admin.mjs list-users
   ```
   Désactiver (`admin.mjs disable-user`) tout compte actif qui n'est ni la
   propriétaire ni un compte de test e2e — sinon le backfill refuse. Un compte
   e2e se désigne avec `--e2e-user`, un par un, et doit avoir une adresse en
   `.test`. Un espace **sans aucun utilisateur actif** ne peut pas être
   attribué : réactiver son utilisateur le temps du backfill, ou supprimer
   l'espace s'il est abandonné — la migration 2 refuse tant qu'il reste une
   ligne non attribuée, quel que soit l'espace.
3. **Déploiement 1 — migration 1** (code inchangé) :
   ```bash
   git fetch --tags origin && git checkout pre-lot-a
   git checkout FINAL -- prisma/migrations/20261021090000_permissions_owner_additive
   docker compose up -d --build
   docker compose logs migrate | tail   # « All migrations have been successfully applied »
   ```
4. **Image finale construite, sans la démarrer**, et **dry-run** (lecture
   seule, application en ligne) pour chaque espace :
   ```bash
   git checkout FINAL
   docker compose build app
   docker compose run --rm --no-deps app node scripts/backfill-owner.mjs \
     --workspace <id> --owner <email> [--e2e-user e2e@nod-crm.test] --dry-run
   ```
   Vérifier **la liste des comptes exclus** (e-mail, `isActive`), les comptes
   par table, et les sections « gain » (projets sans propriétaire ni créateur)
   et « Accès perdus ». `--no-deps` évite de lancer le service `migrate`, qui
   appliquerait la migration 2 trop tôt.
5. **Maintenance, seconde sauvegarde, backfill** — une seule interruption pour
   tous les espaces :
   ```bash
   docker compose stop app
   sudo NOD_CRM_SKIP_UPLOADS=1 ./deploy/backup/nod-crm-backup.sh
   sudo ./deploy/backup/nod-crm-restore.sh --verify
   docker compose run --rm --no-deps app node scripts/backfill-owner.mjs \
     --workspace <id> --owner <email> [--e2e-user …]        # pour chaque espace
   ```
   **Noter le nom de l'archive de cette seconde sauvegarde : c'est le point de
   retour arrière.** Prise application arrêtée, juste avant le backfill, elle
   contient toutes les écritures faites depuis le déploiement 1, migration 1
   appliquée. Base seule (`NOD_CRM_SKIP_UPLOADS=1`) : le script de sauvegarde
   lit les photos dans le conteneur de l'application, qui est arrêté ; ni le
   backfill ni la migration 2 ne touchent aux photos, et la restauration de
   la base ne touche pas au volume des photos.
   Le backfill est idempotent : le relancer ne fait que rattraper ce qui reste.
6. **Déploiement final** — migration 2 et code du lot A :
   ```bash
   docker compose up -d
   docker compose logs migrate | tail
   ```
   Si la migration 2 refuse (« backfill incomplet »), rien n'a été modifié :
   ```bash
   docker compose run --rm --no-deps app npx prisma migrate resolve \
     --rolled-back 20261021100000_permissions_owner_required
   ```
   relancer l'étape 5 pour l'espace nommé (`docker compose stop app` d'abord
   si l'application a démarré ; inutile de refaire la seconde sauvegarde si
   l'application n'a rien écrit entre-temps), puis refaire l'étape 6.
7. **Contrôle** : se connecter en propriétaire ; vérifier projets, tâches,
   fiches et notifications ; `GET /api/health`.

#### Retour arrière

- **Après l'étape 3 seulement** : rien à faire, la migration 1 est additive et
  l'ancien code l'ignore.
- **À partir de l'étape 5** (backfill fait, que l'étape 6 ait eu lieu ou non) :
  l'ancien code verrait des projets `PRIVATE` sans adhésion, et ne peut plus
  écrire une fois la migration 2 appliquée. Le retour se fait par la
  **seconde sauvegarde** (étape 5), vers le code du déploiement 1 — la base
  restaurée a la migration 1 appliquée, le code doit donc en avoir le
  répertoire :
  ```bash
  git checkout pre-lot-a
  git checkout FINAL -- prisma/migrations/20261021090000_permissions_owner_additive
  docker compose build app
  sudo ./deploy/backup/nod-crm-restore.sh --into-production <archive de l'étape 5> --yes-i-am-sure
  docker compose up -d
  ```
  Seules les écritures faites après le déploiement final sont perdues (aucune
  si l'étape 6 n'a pas démarré l'application) ; tout le monde est déconnecté.
  La sauvegarde de l'étape 1 ne sert qu'en dernier recours (déploiement 1 en
  échec, ou seconde sauvegarde inutilisable) : elle ramène au code
  `pre-lot-a` seul, et perd tout ce qui a été écrit depuis l'étape 1.

### 9.4 Tests

| Test | Ce qu'il prouve |
|---|---|
| `tests/integration/lot-a-new-user.test.ts` | Un utilisateur créé après coup dans l'espace : zéro donnée sur **chaque** point de lecture (101 points : fonctions exportées des modules de requêtes, pages, routes `GET`, actions de lecture, SSE). La liste attendue est recalculée depuis le code : un point de lecture ajouté sans sonde fait échouer le test. Chaque identifiant existant est introuvable en écriture, et l'empreinte de toutes les tables est inchangée. Exceptions explicites : étiquette et champ d'espace (a), annuaire = soi (b). |
| `tests/snapshot/run-owner-snapshot.sh` (`npm run test:owner-snapshot`, base jetable) | Non-régression de la propriétaire : instantané avec le **code d'avant le lot A** puis après migration 1 → refus de la migration 2 → backfill (dry-run, exécution, relance idempotente) → migration 2. Seules des différences attendues et justifiées : visibilité `PRIVATE`, adhésion `EDITOR` ajoutée, collaboratrice ajoutée, règles dormantes désactivées, projet orphelin attribué (gestion), annuaire réduit (b). C'est ce test qui a trouvé le défaut de comparaison NULL du backfill. |
| `tests/integration/lot-a-backfill.test.ts` | dry-run sans écriture, idempotence, relance après des créations faites entre deux déploiements (la migration 2 refuse puis passe), refus d'un second utilisateur actif, comptes e2e (domaine, appartenance, liste avec `isActive`). |
| `tests/integration/lot-a-rules.test.ts` | (a), (f), (g), liaisons CRM d'autrui refusées partout, formulaire sans Édition, automatisation sans effet sur les données d'un tiers, membres existants qui gardent exactement leurs droits. |
| `tests/integration/lot-a-attack.test.ts` | Tests d'attaque (phase 2) : un nouvel utilisateur, un co-membre éditeur et une commentatrice cherchent à atteindre les données de la propriétaire (ids devinés, recherche, export, SSE, notifications, annuaire, liaisons, formulaires, automatisations, sous-tâches, dépendances, pièces jointes, photo, import, modèles, corbeille, oracle d'erreur). 21 sans fuite ; 5 tests de **caractérisation** affirmaient, champ par champ, la seule fuite restante, réservée au lot B (§9.6) ; **inversés au lot B** (§10.3), ils prouvent son absence. |
| `tests/integration/authz-isolation.test.ts`, `tests/unit/authz-inventory.test.ts` | lot 0, toujours verts (table des capacités inchangée). |

**Tests existants adaptés** (chacun parce qu'il figeait la règle d'avant) :

- fixtures : propriétaire par défaut (premier utilisateur de l'espace) pour les
  fiches CRM / RGPD et créateur par défaut pour les tâches ; `shareDirectory`
  (projet « Équipe ») pour mettre les personnes d'un scénario dans l'annuaire ;
- créations directes en base : `ownerId` ajouté (cockpit, contacts, suivis,
  RGPD, isolation) ; `createdById` pour une tâche libre (commerce) ;
- projets « ouverts à l'espace » des scénarios (`work-automation-rights`,
  `work-copies`, `work-history-links`, `work-trash-integrity`) : remplacés par
  un projet partagé avec les mêmes personnes en éditrices ;
- responsable non membre (`work-permissions`, `work-project-trash`,
  `work-reminders`, `work-management`) : il ne voit plus rien et n'est plus
  notifié ; les scénarios qui testaient autre chose (rappels, mentions,
  automatisations) en font un membre ;
- règles d'espace d'autrui : `NOT_FOUND` au lieu de `FORBIDDEN`, plus de reprise
  d'une règle d'auteur inactif, journal invisible ;
- gardes de visibilité (`work-trash-integrity`) : refus seulement si quelqu'un
  gagnerait l'accès ; contrôle d'exposition fondé sur l'appartenance au projet ;
- `migration-work-management` : nombre de migrations en attente calculé ; le
  scénario 093000 s'arrête avant les migrations du lot A ;
- cockpit : la tâche libre d'une collègue n'est plus visible.

### 9.5 Points d'attention

- `Project.ownerId` reste nullable (`ON DELETE SET NULL`) : le backfill le
  renseigne partout, et un projet dont le propriétaire serait supprimé reste
  géré via `createdById` (`isProjectOwner`). Les utilisateurs se désactivent,
  ils ne se suppriment pas.
- Une étiquette ou un champ dont le créateur est supprimé (`created_by_id`
  NULL) n'est plus modifiable par personne : même remarque.
- Les modèles de tâche **de projet** suivent l'Édition du projet (lecture de
  la décision (a), qui vise les modèles d'espace).
- Les actions CRM et RGPD écrivent `ownerId: userId` à côté de `workspaceId`
  dans chaque `where` : c'est la même règle que `crmReadableWhere`, gardée en
  ligne pour ne pas réécrire ces actions (lot 0 : pas de refactor) ; les
  lectures, elles, passent toutes par `crmReadableWhere`.
- `MutationContext.trusted` n'est plus utilisé depuis que `submitForm` exige
  l'Édition ; à retirer avec le lot B s'il ne retrouve pas d'usage.

### 9.6 Ce qui restait pour le lot B

> Liste d'origine, conservée telle quelle. Ce que le lot B a traité et ce
> qu'il laisse : §10.

- Interface de partage : recherche d'une personne par e-mail exact (le
  sélecteur ne propose plus que l'annuaire) ; `setProjectMember` accepte déjà
  tout utilisateur actif de l'espace.
- Masquages dans un projet partagé — **seule fuite trouvée par l'attaque du
  lot A**, démontrée par les 5 `it.fails` de `lot-a-attack.test.ts` : un
  co-membre lit le nom et l'identifiant des fiches CRM liées (`getTaskDetail`,
  `getProjectDetail` / `getProjectBundle`, champs `contactId…` des `TaskItem`,
  historique « Contact »). Correction attendue : résoudre chaque lien via
  `crmReadableWhere(actor)` (sinon « fiche non accessible »). Liens CRM (projet → contact /
  organisation / opportunité ; tâche → contact / suivi / opportunité), autres
  projets d'une tâche multi-projets, sous-tâches et dépendances hors projet
  (« tâche non accessible »), valeurs figées de l'historique (`TaskActivity`,
  dont les noms et adresses en texte libre) et des notifications.
  Autres lectures qui nomment une fiche CRM liée à une tâche partagée : la
  liste historique des tâches (`TASK_INCLUDE`, `src/lib/tasks/queries.ts`),
  `/today` et `getActionableTasks`, les libellés figés par `fieldLabel`
  (`src/lib/tasks/service.ts`).
- Règle des saisies de temps (décision c) et du responsable en Lecture
  (décision d). Lié : une personne peut être nommée responsable d'une tâche de
  projet qu'elle ne lit pas (elle est dans l'annuaire de l'acteur, pas membre
  du projet) — à restreindre aux lecteurs du projet avec la décision (d).
- Réactions et commentaires des points d'avancement : capacité de portée
  projet (`project.read` avec ressource), au lieu de `task.comment`.
- Affecter une tâche libre à un co-membre la lui partage : à trancher avec le
  lot B (seuls les projets sont partageables).
- Lot C : rôle d'espace minimal, création du compte partenaire.


---

## 10. Lot B — masquages dans un projet partagé, partage par e-mail (implémenté)

### 10.1 Règle implémentée

- **Liens CRM d'une tâche ou d'un projet.** Une fiche CRM liée n'est
  transmise (identifiant et nom) qu'à qui la lit — sa propriétaire,
  `canReadCrm` (`src/lib/authz/crm-access.ts`), même règle que
  `crmReadableWhere`. Pour les autres membres du projet :
  - `getTaskDetail` et `getProjectDetail` renvoient `{ hidden: true }`
    (« fiche non accessible ») au lieu de `{ id, label }` ;
  - les `TaskItem` (listes, tableaux, recherche, export, `getProjectBundle`,
    Mes tâches) ont `contactId`, `organizationId`, `opportunityId`,
    `followUpId` à `null` (`readableCrmId`, `serialize.ts`) ;
  - les listes historiques (`getTaskList`, `getActionableTasks`,
    `getTasksForKpi` : `/tasks`, `/today`, indicateurs) affichent la tâche
    sans contact ni suivi.
  Le lien est symétrique : si un co-membre lie **sa** fiche à une tâche
  partagée, la propriétaire du projet voit « fiche non accessible ».
- **Historique.** Les lignes « Contact », « Organisation », « Opportunité »
  (`CRM_LINK_FIELD_LABELS`) ne montrent leurs valeurs qu'à leur auteur
  (`TaskActivity.actorId`). Sans migration : depuis le lot A on ne lie que ses
  propres fiches, et avant le lot A chaque espace n'avait qu'un utilisateur —
  l'auteur d'une ligne est donc la propriétaire des fiches qu'elle nomme. Une
  ligne écrite par une automatisation ou par un compte supprimé (`actorId`
  nul) est masquée pour tout le monde.
- **Un lien masqué ne se modifie pas.** `assertCrmLinksEditable`
  (`service.ts`) : remplacer ou retirer un lien vers une fiche que l'acteur ne
  lit pas est refusé (`FORBIDDEN`, `LOCKED_CRM_LINK`), pour une tâche
  (`updateTaskFields`, donc aussi le formulaire historique et les
  automatisations) comme pour un projet (`updateProject`). Renvoyer un lien
  inchangé n'est pas le modifier : seuls les liens qui changent sont vérifiés
  (au projet, `assertCrmLinks` ne vérifie plus que ceux-là). Le formulaire
  historique `updateTask` renvoie le contact vide quand il ne l'affiche pas :
  ce vide est ignoré si le contact actuel appartient à une autre personne.
- **Partage par e-mail exact.** `addProjectMemberByEmailAction` (capacité
  `project.manage`) : la personne qui gère le projet ajoute un compte **actif
  de l'espace** par son adresse exacte (casse ignorée), en Lecture ou en
  Édition seulement ; la Gestion se donne ensuite, à un membre déjà présent.
  C'est la seule façon d'atteindre un compte qui n'est pas encore dans
  l'annuaire de l'acteur (un partenaire tout juste créé).
- **Responsable d'une tâche de projet.** Il doit pouvoir lire un des projets
  de la tâche (de sa racine pour une sous-tâche) : création, modification,
  automatisation `set_assignee`, import CSV. Message : `ASSIGNEE_NOT_MEMBER`.
  Une tâche libre n'est pas concernée (son responsable la lit).

Interface : « Fiche non accessible » dans le panneau de tâche (contact,
organisation, opportunité, suivi), l'aperçu du projet et les réglages du
projet, sans lien ni bouton de modification ; les réglages n'envoient jamais
un lien masqué. La fenêtre « Membres du projet » a un champ « Ajouter par
adresse e-mail exacte » avec le niveau (Lecture / Édition).

**Aucune migration.** Le lot B ne change que du code : un seul déploiement,
retour arrière par le code seul (§10.4).

### 10.2 Ce qu'un co-membre lit encore (assumé)

- Le **texte libre** écrit par les personnes du projet : nom et description du
  projet, titres, descriptions, commentaires, pièces jointes, points
  d'avancement. Rien ne peut y masquer le nom d'un client.
- Les **noms** des étiquettes et des champs personnalisés d'espace (décision
  a) — lisibles par tout l'espace.
- Le nom affiché des membres des projets qu'il lit, et le sien (décision b).
- Le **détail des saisies de temps** de tous les membres (décision c non
  traitée).

### 10.3 Tests

| Test | Ce qu'il prouve |
|---|---|
| `tests/integration/lot-a-attack.test.ts` (5 tests inversés) | Les 5 tests de caractérisation de §9.6 affirment désormais l'**absence** de fuite : `getTaskDetail` (éditeur et commentatrice), `getProjectDetail`, `getProjectBundle`, historique. Chaque réponse est aussi fouillée en entier (`JSON.stringify`) : aucun nom ni identifiant des fiches d'Alice. Les 21 autres tests du fichier sont inchangés. |
| `tests/integration/lot-b-sharing.test.ts` (15 tests) | Non-régression de la propriétaire (tous ses liens, listes historiques) ; listes historiques d'un co-membre ; lien masqué ni détachable ni remplaçable (tâche, formulaire historique — avec la raison du refus —, projet par un membre Gestion), modification des autres champs possible, symétrie (fiche d'un co-membre masquée pour la propriétaire) ; partage par e-mail (casse, compte inconnu / d'un autre espace / inactif / déjà membre, niveau Gestion refusé, non-gestionnaire refusé, introuvable pour qui ne lit pas le projet) ; règle du responsable (création, modification, sous-tâche ; membre de tout niveau et tâche libre acceptés). |
| `tests/unit/authz-inventory.test.ts` | Nouvelle action déclarée : `addProjectMemberByEmailAction` → `project.manage` (100 actions + 1 route). |
| `tests/snapshot/run-owner-snapshot.sh` | Rejoué avec le code du lot B : 0 différence inattendue pour la propriétaire. |

**Contre-épreuve** (faite, non commitée ; 41 tests dans les deux fichiers) :
- fuite réintroduite (`canReadCrm` → `true`, historique non filtré) : les 5
  tests inversés échouent, ainsi que 4 tests de `lot-b-sharing` (9 échecs) ;
- historique seul réintroduit : le test d'historique échoue, et celui de la
  symétrie (la ligne d'historique de Bob nomme sa fiche à Alice) ;
- verrou d'écriture retiré (`assertCrmLinksEditable` et le vide ignoré du
  formulaire historique) : les 6 tests d'écriture de `lot-b-sharing` échouent ;
- règle du responsable retirée : son test de refus échoue.

**Tests existants adaptés** (règle du responsable seulement) : les scénarios
« responsable non membre » (`work-permissions`, `work-project-trash`,
`work-trash-integrity`, `work-automation-rights`) posent désormais
l'affectation en base (`assignOutsideProject`, `fixtures.ts`) — l'état existe
toujours (affectation antérieure au lot B, membre retiré, tâche déplacée) et
ce qu'ils vérifient est inchangé ; l'import CSV de `work-management` rend le
responsable importé membre du projet.

### 10.4 Déploiement — installation réelle

Installation de production (différente des exemples de `deploy/`) :
dépôt dans **`/home/ubuntu/nod-crm-prod`**, application sur
**`127.0.0.1:3024`**, sauvegardes dans **`/var/backups/nod-crm`** (lisible par
root seulement : jamais de `*` hors `sudo`). Les scripts de sauvegarde
reçoivent `NOD_CRM_DIR=/home/ubuntu/nod-crm-prod`.

Références :
- `pre-lot-b` — étiquette sur `b917ad6`, la branche principale avec le lot A,
  telle qu'en production : point de retour. À poser **avant** le déploiement,
  depuis un poste qui peut pousser :
  ```bash
  git fetch origin
  git tag -a pre-lot-b b917ad6 -m "Production avant le lot B (lot A déployé)"
  git push origin pre-lot-b
  ```
- `FINAL` — le commit de fusion du lot B sur la branche principale.

Pas de migration, pas de backfill : **un seul déploiement**, une coupure de
quelques secondes (recréation du conteneur).

1. **État de départ**
   ```bash
   cd /home/ubuntu/nod-crm-prod
   git status --short            # rien : aucun fichier modifié
   git log -1 --format=%h        # b917ad6
   docker compose ps             # nod-crm-postgres healthy, nod-crm-app up
   curl -fsS http://127.0.0.1:3024/api/health
   ```
   L'avertissement de Compose sur le volume `nod-crm-postgres-data-prod`
   (« created for project nod-crm-prod ») est connu et sans effet sur ce
   déploiement.
2. **Sauvegarde vérifiée** (base et photos, application en ligne) :
   ```bash
   sudo NOD_CRM_DIR=/home/ubuntu/nod-crm-prod ./deploy/backup/nod-crm-backup.sh
   sudo NOD_CRM_DIR=/home/ubuntu/nod-crm-prod ./deploy/backup/nod-crm-restore.sh --verify
   sudo ls -lt /var/backups/nod-crm | head -5
   ```
   Le `--verify` sans argument restaure **la plus récente** sur une base
   jetable. **Noter le nom de l'archive `.sql.gz`** (dernier `ls`) : c'est le
   filet de sécurité. Ne pas poursuivre si la vérification échoue.
3. **Code du lot B, image construite pendant que l'application tourne**
   ```bash
   git fetch --tags origin
   git checkout --detach FINAL
   git log -1 --format='%h %s'   # le commit de fusion du lot B
   docker compose build app
   ```
4. **Bascule**
   ```bash
   docker compose up -d
   docker compose logs migrate | tail -5   # « No pending migrations to apply. »
   docker compose ps
   curl -fsS http://127.0.0.1:3024/api/health
   ```
   Le service `migrate` doit trouver **zéro** migration en attente : le lot B
   n'en apporte pas. S'il en appliquait une, arrêter et revenir en arrière
   (étape « Retour arrière ») : ce ne serait pas le bon commit.
5. **Contrôles**
   - Se connecter avec le compte de chaque espace utilisé : projets, tâches,
     fiches CRM liées **nommées** (la propriétaire voit tous ses liens),
     notifications, `/today`.
   - Facultatif mais recommandé avant le premier partenaire : dérouler une
     fois [`accueillir-un-partenaire.md`](accueillir-un-partenaire.md) avec un
     compte de test (adresse en `.test`), dans un projet de test lié à une
     fiche CRM ; vérifier, connecté en compte de test dans une fenêtre
     privée, « Fiche non accessible » au lieu du nom ; puis désactiver le
     compte de test (`admin.mjs disable-user`).

#### Retour arrière

Le lot B ne modifie ni le schéma ni les données existantes : le code du lot A
relit tout ce que le lot B a écrit. Retour par le **code seul**, sans
restauration :

```bash
cd /home/ubuntu/nod-crm-prod
git checkout --detach pre-lot-b    # = b917ad6
docker compose build app
docker compose up -d
curl -fsS http://127.0.0.1:3024/api/health
```

**Avant** ce retour, si un partenaire a déjà été ajouté à un projet : le
retirer du projet (ou désactiver son compte, `admin.mjs disable-user`) — le
code du lot A lui montrerait de nouveau les fiches CRM liées.

La restauration de l'archive de l'étape 2 ne sert qu'en dernier recours
(données abîmées, ce que rien dans le lot B ne fait) ; elle perd tout ce qui a
été écrit depuis l'étape 2 et déconnecte tout le monde :
```bash
sudo NOD_CRM_DIR=/home/ubuntu/nod-crm-prod ./deploy/backup/nod-crm-restore.sh \
  --into-production /var/backups/nod-crm/<archive de l'étape 2>.sql.gz --yes-i-am-sure
```

### 10.5 Ce qui reste

- **Lot C** : rôle d'espace minimal (h) — réserver aux internes la création des
  étiquettes et des champs d'espace (a), la création de projets, et la
  recherche par e-mail (aujourd'hui, une personne qui gère un projet, même
  partenaire sur son propre projet, peut vérifier si une adresse a un compte
  dans l'espace) ; e-mail unique global (une adresse déjà utilisée dans un
  autre espace ne peut pas être ajoutée).
- **Mot de passe initial** : aucun moyen aujourd'hui, ni de changer son mot de
  passe dans l'application, ni d'en forcer le changement à la première
  connexion (seul `admin.mjs reset-password`, côté serveur). Ce n'est pas un
  petit changement — colonne `must_change_password` (migration additive),
  garde dans la DAL pour **toutes** les entrées (pages, actions, routes, flux
  SSE), page et action de changement exclues de l'inventaire comme `login`,
  limitation des essais : proposé pour le lot suivant. Procédure d'ici là :
  [`accueillir-un-partenaire.md`](accueillir-un-partenaire.md), étape 2.
- Décision (c) — saisies de temps : chacun les siennes et le total ; le détail
  pour la Gestion.
- Décision (d) — responsable en Lecture : éditer ses champs.
- Réactions et commentaires des points d'avancement : capacité `project.read`
  avec ressource au lieu de `task.comment`.
- Un responsable peut encore se retrouver hors du projet par un autre chemin
  que l'affectation (membre retiré, tâche déplacée, duplication qui garde les responsables) : il ne
  voit alors plus la tâche (pas de fuite, mais une affectation sans effet).
- Un lien CRM posé par une personne ensuite désactivée ne peut plus être
  retiré par les autres membres (la fiche reste à elle).
- `MutationContext.trusted`, inutilisé depuis le lot A : à retirer.
