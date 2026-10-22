-- Jeu de données « d'avant le lot A » pour le test de non-régression du
-- propriétaire (`tests/snapshot/run-owner-snapshot.sh`). Il est écrit pour le
-- schéma de la branche principale d'avant le lot A : aucune colonne de
-- propriété, projets ouverts à l'espace, tâches libres partagées.
--
-- Un espace mono-utilisateur réaliste : la propriétaire de migration, une
-- ancienne collègue désactivée (qui a laissé des projets, des tâches, une règle
-- et un modèle) et un compte de test e2e. Cas délicats couverts : projet
-- « espace » d'une autre personne, projet hérité sans propriétaire, tâche libre
-- sans créateur, tâche libre d'une autre personne dont elle n'est qu'abonnée,
-- règle et modèle sans auteur ou d'un auteur inactif. Et deux cas qui ne se
-- préservent pas sans changer les droits, que le dry-run doit chiffrer : une
-- sous-tâche qu'elle ne voyait que par elle-même (racine dans un projet privé
-- dont elle n'est pas membre), et un projet privé orphelin qui lui revient.

\set ws '''a0000000-0000-4000-8000-000000000001'''
\set owner '''a0000000-0000-4000-8000-000000000010'''
\set ex '''a0000000-0000-4000-8000-000000000011'''
\set e2e '''a0000000-0000-4000-8000-000000000012'''

INSERT INTO workspaces (id, slug, name, updated_at) VALUES (:ws, 'acme', 'Acme', now());
INSERT INTO users (id, workspace_id, email, password_hash, display_name, is_active, updated_at) VALUES
  (:owner, :ws, 'proprietaire@acme.fr', 'x', 'Propriétaire', true, now()),
  (:ex, :ws, 'ancienne@acme.fr', 'x', 'Ancienne', false, now()),
  (:e2e, :ws, 'e2e@nod-crm.test', 'x', 'E2E', true, now());

-- CRM et RGPD : aucune colonne de propriétaire avant le lot A.
INSERT INTO organizations (id, workspace_id, name, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000101', :ws, 'Org Une', now()),
  ('a0000000-0000-4000-8000-000000000102', :ws, 'Org Deux', now());
INSERT INTO contacts (id, workspace_id, organization_id, first_name, last_name, email, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000201', :ws, 'a0000000-0000-4000-8000-000000000101', 'Camille', 'Client', 'camille@client.test', now()),
  ('a0000000-0000-4000-8000-000000000202', :ws, NULL, 'Dominique', 'Autre', NULL, now());
INSERT INTO opportunities (id, workspace_id, organization_id, contact_id, name, status, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000301', :ws, 'a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000201', 'Affaire', 'EN_DISCUSSION', now());
INSERT INTO follow_ups (id, workspace_id, contact_id, title, ball_owner, due_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000401', :ws, 'a0000000-0000-4000-8000-000000000201', 'Relancer Camille', 'THEM', now() - interval '1 day', now()),
  ('a0000000-0000-4000-8000-000000000402', :ws, NULL, 'Suivi sans contact', 'ME', now() + interval '2 days', now());
INSERT INTO privacy_treatments (id, workspace_id, name, purpose, updated_at) VALUES ('a0000000-0000-4000-8000-000000000501', :ws, 'Prospection', 'Prospecter', now());
INSERT INTO privacy_processors (id, workspace_id, name, service, updated_at) VALUES ('a0000000-0000-4000-8000-000000000502', :ws, 'CloudCo', 'Hébergement', now());
INSERT INTO privacy_requests (id, workspace_id, contact_id, request_type, received_at, due_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000503', :ws, 'a0000000-0000-4000-8000-000000000201', 'ACCESS', now(), now() + interval '30 days', now());
INSERT INTO privacy_incidents (id, workspace_id, title, description, discovered_at, updated_at) VALUES ('a0000000-0000-4000-8000-000000000504', :ws, 'Incident', 'Perte', now(), now());

-- Projets.
INSERT INTO projects (id, workspace_id, name, owner_id, created_by_id, visibility, is_template, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000601', :ws, 'P1 espace, à elle', :owner, :owner, 'WORKSPACE', false, now()),
  ('a0000000-0000-4000-8000-000000000602', :ws, 'P2 espace, de l''ancienne', :ex, :ex, 'WORKSPACE', false, now()),
  ('a0000000-0000-4000-8000-000000000603', :ws, 'P3 privé, à elle', :owner, :owner, 'PRIVATE', false, now()),
  ('a0000000-0000-4000-8000-000000000604', :ws, 'P4 privé, commentatrice', :ex, :ex, 'PRIVATE', false, now()),
  ('a0000000-0000-4000-8000-000000000605', :ws, 'P5 hérité sans propriétaire', NULL, NULL, 'WORKSPACE', false, now()),
  ('a0000000-0000-4000-8000-000000000606', :ws, 'Modèle', :owner, :owner, 'WORKSPACE', true, now()),
  -- Cas non préservables, que le dry-run doit signaler :
  ('a0000000-0000-4000-8000-000000000607', :ws, 'P7 privé de l''ancienne', :ex, :ex, 'PRIVATE', false, now()),
  ('a0000000-0000-4000-8000-000000000608', :ws, 'P8 privé orphelin', NULL, NULL, 'PRIVATE', false, now());
INSERT INTO project_members (project_id, user_id, workspace_id, role) VALUES
  ('a0000000-0000-4000-8000-000000000601', :owner, :ws, 'OWNER'),
  ('a0000000-0000-4000-8000-000000000602', :ex, :ws, 'OWNER'),
  ('a0000000-0000-4000-8000-000000000603', :owner, :ws, 'OWNER'),
  ('a0000000-0000-4000-8000-000000000604', :ex, :ws, 'OWNER'),
  ('a0000000-0000-4000-8000-000000000604', :owner, :ws, 'COMMENTER'),
  ('a0000000-0000-4000-8000-000000000606', :owner, :ws, 'OWNER');

-- Tâches.
INSERT INTO tasks (id, workspace_id, title, assignee_id, created_by_id, parent_id, due_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000701', :ws, 'Tâche P1', :owner, :owner, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000702', :ws, 'Tâche P2 de l''ancienne', :ex, :ex, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000703', :ws, 'Tâche P3', NULL, :owner, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000704', :ws, 'Tâche P4', :ex, :ex, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000705', :ws, 'Tâche P5', NULL, NULL, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000706', :ws, 'Sous-tâche de P1', NULL, :owner, 'a0000000-0000-4000-8000-000000000701', now(), now()),
  ('a0000000-0000-4000-8000-000000000707', :ws, 'Libre à elle', NULL, :owner, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000708', :ws, 'Libre sans créateur', NULL, NULL, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000709', :ws, 'Libre de l''ancienne', :ex, :ex, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000710', :ws, 'Libre suivie', NULL, :ex, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000711', :ws, 'Tâche du modèle', NULL, :owner, NULL, NULL, now()),
  ('a0000000-0000-4000-8000-000000000712', :ws, 'Racine dans P7', :ex, :ex, NULL, now(), now()),
  ('a0000000-0000-4000-8000-000000000713', :ws, 'Sous-tâche à elle sous P7', :owner, :ex, 'a0000000-0000-4000-8000-000000000712', now(), now());
INSERT INTO task_projects (task_id, project_id, workspace_id) VALUES
  ('a0000000-0000-4000-8000-000000000701', 'a0000000-0000-4000-8000-000000000601', :ws),
  ('a0000000-0000-4000-8000-000000000702', 'a0000000-0000-4000-8000-000000000602', :ws),
  ('a0000000-0000-4000-8000-000000000703', 'a0000000-0000-4000-8000-000000000603', :ws),
  ('a0000000-0000-4000-8000-000000000704', 'a0000000-0000-4000-8000-000000000604', :ws),
  ('a0000000-0000-4000-8000-000000000705', 'a0000000-0000-4000-8000-000000000605', :ws),
  ('a0000000-0000-4000-8000-000000000711', 'a0000000-0000-4000-8000-000000000606', :ws),
  ('a0000000-0000-4000-8000-000000000712', 'a0000000-0000-4000-8000-000000000607', :ws);
INSERT INTO task_followers (task_id, user_id, kind) VALUES ('a0000000-0000-4000-8000-000000000710', :owner, 'FOLLOWER');

-- Réglages.
INSERT INTO tags (id, workspace_id, name) VALUES ('a0000000-0000-4000-8000-000000000801', :ws, 'urgent');
INSERT INTO custom_fields (id, workspace_id, name, type, updated_at) VALUES ('a0000000-0000-4000-8000-000000000802', :ws, 'Budget', 'TEXT', now());
INSERT INTO automation_rules (id, workspace_id, project_id, name, trigger, actions, created_by_id, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000901', :ws, NULL, 'Règle à elle', 'TASK_CREATED', '[{"kind":"set_priority","priority":"HIGH"}]', :owner, now()),
  ('a0000000-0000-4000-8000-000000000902', :ws, NULL, 'Règle sans auteur', 'TASK_CREATED', '[{"kind":"set_priority","priority":"LOW"}]', NULL, now()),
  ('a0000000-0000-4000-8000-000000000903', :ws, NULL, 'Règle de l''ancienne', 'TASK_CREATED', '[{"kind":"set_priority","priority":"LOW"}]', :ex, now()),
  ('a0000000-0000-4000-8000-000000000904', :ws, 'a0000000-0000-4000-8000-000000000601', 'Règle de P1', 'TASK_COMPLETED', '[{"kind":"set_priority","priority":"LOW"}]', :owner, now());
INSERT INTO task_templates (id, workspace_id, name, title, created_by_id) VALUES
  ('a0000000-0000-4000-8000-000000000911', :ws, 'Modèle à elle', 'M1', :owner),
  ('a0000000-0000-4000-8000-000000000912', :ws, 'Modèle sans auteur', 'M2', NULL),
  ('a0000000-0000-4000-8000-000000000913', :ws, 'Modèle de l''ancienne', 'M3', :ex);
INSERT INTO saved_views (id, workspace_id, user_id, name, scope, config, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000921', :ws, :owner, 'Ma vue', 'my-tasks', '{}', now());
INSERT INTO notifications (id, workspace_id, user_id, type, title, task_id) VALUES
  ('a0000000-0000-4000-8000-000000000931', :ws, :owner, 'ASSIGNED', 'Tâche P1', 'a0000000-0000-4000-8000-000000000701'),
  ('a0000000-0000-4000-8000-000000000932', :ws, :owner, 'COMMENT', 'Libre de l''ancienne', 'a0000000-0000-4000-8000-000000000709');
INSERT INTO comments (id, workspace_id, task_id, author_id, body) VALUES ('a0000000-0000-4000-8000-000000000941', :ws, 'a0000000-0000-4000-8000-000000000701', :owner, 'Bonjour');
INSERT INTO task_time_entries (id, task_id, workspace_id, user_id, minutes, spent_at) VALUES ('a0000000-0000-4000-8000-000000000951', 'a0000000-0000-4000-8000-000000000701', :ws, :owner, 30, now());
