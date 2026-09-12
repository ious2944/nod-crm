# Journal d'audit

Réponse à V-08 / P1 de l'audit sécurité (RGPD art. 30 : traçabilité des
traitements). Une ligne par mutation instrumentée : qui, quand, quoi, sur
quelle entité.

## Ce qui est stocké — et rien de plus

`timestamp · userId · workspaceId · action · entityType · entityId · requestId`

C'est tout. Volontairement :

- **Pas de snapshot** des valeurs avant/après.
- **Pas de diff** des champs modifiés.
- **Pas de métadonnées libres.**

Un contact, une organisation, une demande RGPD contiennent par nature des
données personnelles. Un journal d'audit qui copie ces valeurs — même
partiellement — devient lui-même un second endroit où ces données vivent,
avec sa propre politique de rétention à gérer, son propre risque de fuite, et
sans les protections déjà en place sur les tables métier (isolation
workspace, purge RGPD). Le principe retenu ici : le journal répond à « qui a
fait quoi, quand », jamais à « quelle était la valeur ». Pour retrouver la
valeur elle-même, l'entité de production reste la source — l'audit ne fait
que pointer vers elle via `entityId`.

Si un besoin futur exige plus (diff de champs pour un export de conformité,
par exemple), ça doit être une décision explicite et scopée, pas un champ
`metadata: Json?` fourre-tout où n'importe quel appelant peut, un jour,
glisser un email ou une note.

## Comment instrumenter un nouveau module

1. Ajouter l'entité à `AUDIT_ENTITY_TYPES` dans `types.ts` si elle n'y est pas
   déjà.
2. Dans l'action, après authentification (`getActorForAction()`) et après que
   la mutation a réellement réussi (jamais avant, jamais dans un chemin qui
   peut encore lever) :

   ```ts
   await recordAudit({
     workspaceId,
     userId,
     action: "CREATE", // ou UPDATE / ARCHIVE / RESTORE / DELETE / EXPORT
     entityType: AUDIT_ENTITY_TYPES.CONTACT,
     entityId: contact.id,
   });
   ```

3. Ne jamais faire dépendre le comportement métier du résultat de
   `recordAudit()` — elle ne lève pas, et sa valeur de retour (`void`) n'est
   pas destinée à être inspectée.
4. Une opération qui touche plusieurs entités en une transaction (ex. une
   suppression en cascade) journalise une ligne par entité affectée, pas une
   ligne agrégée — c'est ce qui permet ensuite d'interroger « qu'est-il arrivé
   à CETTE entité », qui est la question que ce journal existe pour
   répondre.

## Ce qui n'est délibérément pas couvert dans cette première version

- Les lectures (consultation d'une fiche, export en lecture seule) : seules
  les mutations sont journalisées. Voir « Risques résiduels » dans le rapport
  d'instrumentation pour ce que ça laisse hors périmètre.
- Les rôles/permissions : ce module n'existe pas encore dans NOD CRM (un seul
  niveau d'accès par workspace — voir l'audit, item RBAC). Le jour où il
  existera, un changement de rôle est une mutation comme une autre et doit
  être journalisé de la même façon.
- Un export de données au sens propre (CSV, PDF...) n'existe pas non plus
  aujourd'hui dans l'application. Le type d'action `EXPORT` est prévu dans le
  schéma pour ce jour-là.
