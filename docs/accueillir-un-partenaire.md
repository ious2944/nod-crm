# Accueillir un partenaire

Cette page explique, étape par étape, comment donner à une personne extérieure
(un partenaire, une autre société) l'accès à **certains projets** de votre
espace, sans rien lui montrer d'autre. Elle suit l'installation réelle de
production (`/home/ubuntu/nod-crm-prod`).

Le détail technique est dans [`permissions-v1.md`](permissions-v1.md), §10.

---

## Ce que le partenaire verra, et ce qu'il ne verra pas

- **Il voit** les projets que vous lui partagez, avec **toutes** leurs tâches,
  sous-tâches, commentaires, pièces jointes, saisies de temps et points
  d'avancement, ainsi que le nom affiché des autres membres de ces projets.
- **Il ne voit pas** votre CRM : contacts, organisations, opportunités, suivis,
  registre RGPD. Si un projet ou une tâche est lié à une de vos fiches, il voit
  seulement « Fiche non accessible », sans nom, et ne peut ni la changer ni la
  retirer.
- **Il ne voit pas** vos autres projets, vos tâches personnelles, ni les autres
  utilisateurs de l'espace avec qui il ne partage aucun projet.

---

## 0. Avant de commencer

1. **Le lot B doit être déployé.** Pour le vérifier, ouvrez un de vos projets,
   puis la fenêtre **Membres** : elle doit contenir un champ **« Ajouter par
   adresse e-mail exacte »**. Sinon, n'allez pas plus loin.
2. **Relisez le projet à partager.** Le partenaire lira tout ce qui y est
   **écrit** : nom et description du projet, titres et descriptions des tâches,
   commentaires, pièces jointes. Si un nom de client y figure en clair, il le
   lira (seuls les **liens** vers vos fiches CRM sont masqués).
3. **Vérifiez que l'adresse du partenaire n'a pas déjà un compte**, dans
   n'importe quel espace : une adresse e-mail n'existe qu'une fois sur toute
   l'installation.

Toutes les commandes se lancent sur le serveur, depuis le dossier du dépôt :

```bash
cd /home/ubuntu/nod-crm-prod
```

---

## 1. Repérer votre espace

```bash
docker compose exec app node scripts/admin.mjs list-workspaces
docker compose exec app node scripts/admin.mjs list-users
```

Notez le **slug** de votre espace (par exemple `nod-lab`) : le partenaire doit
être créé **dans votre espace**, pas dans un espace à lui.
`list-users` montre aussi que l'adresse du partenaire n'existe pas encore.

---

## 2. Mot de passe initial

**Aujourd'hui, il n'existe aucun moyen de forcer le changement du mot de passe
à la première connexion, ni de le changer soi-même dans l'application.** Seule
la commande `admin.mjs reset-password`, sur le serveur, change un mot de passe.
Ce manque est prévu pour un prochain lot ([`permissions-v1.md`](permissions-v1.md), §10.5).

D'ici là, la procédure la plus sûre est la suivante.

1. **Générer un mot de passe long et aléatoire**, sur votre poste ou sur le
   serveur, sans l'enregistrer nulle part :
   ```bash
   openssl rand -base64 24
   ```
   Il doit faire au moins 12 caractères et mélanger au moins trois types de
   caractères (minuscules, majuscules, chiffres, symboles). Si l'outil le
   refuse, générez-en un autre.
2. **Le transmettre par un autre canal que l'adresse e-mail** : l'adresse et le
   lien de connexion par e-mail, le mot de passe par SMS, Signal ou de vive
   voix. Jamais les deux dans le même message.
3. **Effacer ensuite votre trace** (message envoyé, note) : vous connaissez ce
   mot de passe tant que vous ne l'avez pas oublié.
4. **Vérifier la première connexion** : `list-users` affiche la date de
   « dernière connexion ». Si le compte n'a pas servi dans les jours qui
   suivent, ou en cas de doute (message perdu, mauvais destinataire),
   remplacez le mot de passe : cela déconnecte aussi toutes ses sessions.
   ```bash
   docker compose exec app node scripts/admin.mjs reset-password --email prenom@partenaire.fr
   ```

---

## 3. Créer le compte

```bash
docker compose exec app node scripts/admin.mjs create-user \
  --email prenom@partenaire.fr --workspace nod-lab --name "Prénom Nom (Société)"
```

- Remplacez l'adresse, le slug (étape 1) et le nom affiché. Le **nom affiché**
  est ce que les autres membres verront : mettez la société entre parenthèses.
- Le mot de passe de l'étape 2 est **demandé deux fois, sans s'afficher**. Il
  n'est jamais accepté sur la ligne de commande.
- Le message « Utilisateur … créé dans « … » » confirme la création.

À sa première connexion, le partenaire ne voit **aucune donnée** : ni projet, ni
tâche, ni fiche. Il voit seulement le nom de l'espace et, dans les filtres, les
**noms** des étiquettes et des champs personnalisés de l'espace (voir les
précautions).

---

## 4. Lui partager un projet

1. Ouvrez le projet, puis **Membres** (les avatars, dans l'aperçu du projet).
2. Dans **« Ajouter par adresse e-mail exacte »**, saisissez l'adresse du
   partenaire, choisissez le niveau, puis **Ajouter**.
3. Le partenaire reçoit une notification « Vous avez été ajouté au projet ».

Seule la personne qui **gère** le projet peut ajouter un membre. L'adresse doit
être exacte (la casse ne compte pas) et correspondre à un compte actif de votre
espace : sinon, le message « Aucun compte actif de votre espace n'a cette
adresse » s'affiche.

### Niveaux

| Niveau | Ce qu'il permet | Pour un partenaire |
|---|---|---|
| **Commentateur** (Lecture) | lire tout le projet, commenter, réagir, suivre une tâche | ✅ par défaut |
| **Éditeur** (Édition) | en plus : créer et modifier les tâches, les sections, les champs, les formulaires, importer un CSV | ✅ s'il doit travailler dans le projet |
| **Propriétaire** (Gestion) | en plus : réglages du projet, **membres**, archivage, **suppression** | ❌ **jamais** |

L'ajout par e-mail ne propose que Commentateur et Éditeur. Ne passez **jamais**
un partenaire en Propriétaire dans la liste des membres : il pourrait ajouter
d'autres personnes, supprimer le projet, ou rechercher des adresses de votre
espace.

Pour lui confier une tâche, il doit d'abord être membre du projet : sinon
l'application refuse (« Cette personne n'est pas membre du projet de la
tâche »).

---

## 5. Précautions tant que le lot C n'est pas fait

Le lot C ajoutera un vrai rôle « partenaire » dans l'espace. D'ici là, le
partenaire est un utilisateur comme un autre, isolé par les règles des lots A
et B. Concrètement :

- **N'écrivez rien de confidentiel dans les noms d'étiquettes ni de champs
  personnalisés de l'espace** : tout l'espace les lit, partenaire compris.
- **Relisez le texte des projets partagés** (étape 0) : le texte libre n'est
  jamais masqué.
- **Saisies de temps** : dans un projet partagé, chaque membre voit le détail
  du temps saisi par les autres. N'y saisissez pas de temps que le partenaire
  ne doit pas connaître.
- **Le partenaire peut créer ses propres projets, tâches, étiquettes et fiches
  CRM.** Vous ne les voyez pas (sauf s'il vous les partage), mais ils sont
  hébergés chez vous. Ses étiquettes et champs d'espace, eux, sont visibles de
  tous.
- **Un partenaire Éditeur peut lier une tâche partagée à une de ses propres
  fiches CRM.** Vous verrez alors « Fiche non accessible » sur cette tâche, et
  vous ne pourrez pas retirer ce lien : demandez-lui de le faire.
- **Il peut vérifier si une adresse a un compte dans votre espace** en essayant
  de l'ajouter à un projet qu'il a créé lui-même. Ce n'est pas un accès à des
  données, mais c'est une information.
- **Un seul espace par adresse** : si le partenaire a déjà un compte dans un
  autre espace de l'installation, il faut une autre adresse.

---

## 6. Retirer un partenaire

**D'un projet** : **Membres** → **Retirer** en face de son nom. L'accès est coupé
aussitôt, y compris pour les pages déjà ouvertes à leur prochaine action.

**De tout l'espace** (fin de collaboration) :

```bash
docker compose exec app node scripts/admin.mjs disable-user --email prenom@partenaire.fr
```

Le compte ne peut plus se connecter et ses sessions ouvertes sont supprimées.
Il n'existe pas de commande pour réactiver un compte : il faudrait le recréer
avec une autre adresse.

Après la désactivation :

- **Réaffectez les tâches** dont il était responsable (elles restent à son nom).
- Ce qu'il a écrit dans vos projets (tâches, commentaires, pièces jointes)
  reste en place.
- Les **fiches CRM qu'il a créées** restent les siennes : personne d'autre ne
  les voit. Un lien qu'il aurait posé vers une de ses fiches, sur une tâche
  partagée, ne peut plus être retiré par les autres membres. S'il faut
  supprimer ces données (fin de contrat, RGPD), demandez une intervention
  technique : il n'y a pas encore de commande pour cela.
