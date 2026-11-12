# GMS — Gym Management System

Logiciel de gestion de salles de sport pensé pour le Liban : abonnements, paiements en dollars **et** en livres,
entrée par QR code, cours collectifs, coaching privé, rappels WhatsApp, application membre aux couleurs de la salle,
et une IA qui prédit qui va partir et répond aux membres en arabe ou en anglais (y compris l'arabe écrit en lettres latines).
Toute l'interface existe en anglais et en arabe, et rien d'autre.

Une seule plateforme (multi-tenant) sert toutes les salles. Chaque salle part d'un **modèle** (salle classique,
studio femmes, box CrossFit, club de boxe) puis se personnalise sans code : logo, couleur, formules et prix,
horaires et heures femmes, règles d'entrée, modules activés, équipe et rôles.

## Ce qu'il y a dans ce dossier

| Dossier | Contenu |
|---|---|
| `server/` | API Node 22 + TypeScript, client PostgreSQL maison (TLS, SCRAM), IA (churn, RAG, assistant, bot WhatsApp), tâches de fond |
| `web/` | Back-office React (réception, gérant, coach, plateforme) et application membre (PWA) |
| `tests/` | 49 tests : API de bout en bout sur une vraie base PostgreSQL (39) + tests unitaires (10) |
| `infra/` | Terraform AWS (ECS Fargate, RDS, ALB HTTPS, Secrets Manager, alarmes) + guide de déploiement |
| `Dockerfile`, `docker-compose.yml` | Image de production et lancement local en une commande |
| `.github/workflows/` | CI : typecheck + tests + build ; déploiement automatique sur `main` |
| `gtm/` | Business plan, playbook commercial, **liste de 265 salles à démarcher**, affiche A4 (anglais + arabe), deux vidéos de présentation |
| `docs/` | Description fonctionnelle et captures d'écran |

## Démarrer en local (5 minutes)

Avec Docker :
```bash
docker compose up --build
docker compose exec app node seed-demo.js     # trois salles de démo pleines de données réalistes
```
Puis ouvrir http://localhost:8080 :

| Qui | Identifiant | Mot de passe |
|---|---|---|
| Vous (plateforme GMS) | admin@gms.local | admin12345 |
| Propriétaire de la salle de démo | owner@demo.gms | demo12345 |
| Réception de la salle de démo | reception@demo.gms | demo12345 |
| Petite salle, niveau Essentiel (la démo à montrer hors de Beyrouth) | owner@demo-halba.gms | demo12345 |
| Membre (application) | http://localhost:8080/m/demo — téléphone et PIN affichés par `seed-demo.js` | |

Sans Docker (Node 22 + PostgreSQL 16) :
```bash
npm install
export DATABASE_URL=postgres://postgres:motdepasse@localhost:5432/gms
npm run build && npm run seed:demo && npm start
```

Tests : `npm test` (crée et vide une base `gms_test`, voir `tests/helpers.ts`).

## Documentation des API

- Dans l'app : **API reference** en bas du menu (owner) ou sur la page Platform (super-admin). Chaque route y figure avec qui peut l'appeler, ses paramètres et les champs du corps (types, obligatoires, valeurs permises). Un bouton **Try it** envoie un vrai appel dans ta session.
- Fichier OpenAPI 3.1 : bouton **OpenAPI file**, ou `GET /api/docs.json`. Il s'importe dans Postman, Insomnia ou Swagger Editor.
- Elle est générée depuis le code à chaque `npm run build` (`scripts/gen-api-docs.ts`) : routes, rôles et vrais schémas zod. Pour la régénérer seule : `npm run docs:api`.
- Une nouvelle route doit avoir son résumé dans `scripts/api-summaries.ts`, sinon un test échoue.

## Engagement, KPI et rapport financier (v3)

- **KPI** : Insights → Key numbers. Chaque indicateur est comparé à la période d'avant et noté (bon / à surveiller / à agir) selon les repères du secteur. « Focus now » classe les actions par argent en jeu.
- **Rapport financier** : Reports (ou Payments) → Export report. Aperçu A4 avec logo : « PDF / Print » puis « Enregistrer en PDF », ou bouton Excel (7 feuilles).
- **App membre** : Home (pass, prochain cours/PT, objectif de la semaine, série, défi, offres, produits), Classes (avec durée), Coach (réservation PT), Shop (catalogue, « I want it »), Me (historique, progrès, invitations, paramètres).
- **Côté gym** : menu Member app (offres, défis, parrainage, interrupteurs), Shop → App orders et bundles, Personal training → Coach hours (disponibilités, congés, règles de réservation).

## Site web et installation de l'app (v4)

- **Site de GMS** : servi sur `/` aux visiteurs (`web/site/`). Les équipes des salles se connectent sur **`/login`**. Le super-admin voit le site avec `/?site=1` et les demandes de démo dans la page Platform.
- **Installer l'app membre sans store** : le lien `/m/<salle>/install` (dans le message WhatsApp du PIN et sur l'affiche) montre les bonnes étapes selon le téléphone. Android : bouton « Installer » (Chrome crée une vraie app). iPhone : Partager puis « Sur l'écran d'accueil ». Instagram/Facebook : ouvrir d'abord dans le navigateur. Ordinateur : QR code.
- **Côté salle** : Member app → Get the app (lien, QR, affiche A4 à imprimer, icône de l'app générée depuis le logo).

## Mettre en production

Voir **[infra/README.md](infra/README.md)** : environ 45 minutes la première fois, environ 85 $/mois au départ, puis
`./scripts/deploy.sh` à chaque nouvelle version.

## Choix techniques

- **Zéro dépendance au runtime** : le serveur est un seul bundle Node (React et zod sont compilés dedans).
  L'image Docker ne contient ni `node_modules` ni outil de build, donc elle est légère et rien ne casse au déploiement.
- **PostgreSQL** avec un client natif écrit pour le projet (protocole v3, requêtes paramétrées, TLS vérifié
  avec le certificat RDS, authentification SCRAM-SHA-256), testé contre une vraie base.
- **Multi-tenant** strict : chaque requête métier est filtrée par la salle connectée, et des tests vérifient
  qu'une salle ne peut ni lire ni scanner les membres d'une autre.
- **IA sans boîte noire** : le modèle de churn (régression logistique) est entraîné sur l'historique de chaque salle,
  avec un modèle de départ tant qu'il n'y a pas assez de données, et chaque score est expliqué en phrases simples.
  La recherche (RAG) comprend l'arabe, l'arabe écrit en lettres latines et l'anglais. Sans clé API, tout fonctionne en mode hors ligne ;
  avec une clé Anthropic (offre Elite), l'assistant répond librement dans la langue du membre.

Ce qui n'a pas pu être fait ici : l'installation de Next.js et Prisma était bloquée dans cet environnement, d'où le
choix d'une stack sans dépendances ; Terraform n'a pas pu être exécuté (à valider avec `terraform plan` chez vous) ;
les polices (Archivo, IBM Plex Sans Arabic) se chargent depuis Google Fonts.

## Simplification (v5, novembre 2026)

Rien n'a été retiré du produit ; ce qui change, c'est ce qu'on voit par défaut.

- **Trois niveaux par salle** (`settings.level`) : *Essential* (membres, entrée, paiements, WhatsApp), *Studio* (+ cours, coaching, app membre), *Everything* (+ boutique, dépenses, intéressés, conseils de suivi). Une nouvelle salle démarre en Essential. Le gérant change de niveau dans Settings → What you use, et peut toujours activer un outil isolé. Code : `server/templates.ts` (`levelModules`), `PUT /api/gym { level }`.
- **Menu** : une entrée par tâche. Payments, Reports et Expenses sont regroupés sous « Money ». Sur téléphone : quatre entrées fixes et « More » (qui contient aussi le compte, la langue et la déconnexion).
- **Today** : une phrase pour la journée, puis au plus trois choses à faire (encaisser, renouvellements de la semaine, membres qui ne viennent plus), chaque nom avec un message WhatsApp prêt. Les graphiques sont repliés en bas.
- **Getting started** : cinq étapes observables (logo, prix, membres, premier paiement, première entrée). Le gérant les voit sur Today ; la plateforme les voit pour chaque salle (`server/services/setup.ts`).
- **Entrée** : on tape un nom, un numéro ou on scanne. Le QR n'est plus obligatoire.
- **Coupure internet** : l'entrée continue. Le poste garde une copie de la liste des membres (`GET /api/offline/members`), enregistre chaque entrée avec son heure réelle et l'envoie au retour de la connexion (`web/admin/offline.ts`, `web/public/staff-sw.js`). Les paiements ne sont jamais pris hors ligne : il leur faut un numéro de reçu.
- **Arabe** : tous les écrans passent par `t()`. Le dictionnaire est dans `web/shared/i18n.ts` et `web/shared/ar-more.ts` (libanais simple, chiffres 0-9). Les noms de formules et de produits restent tels que la salle les a saisis.
- **Plateforme** : « Needs you today » liste les salles qui doivent de l'argent, dont l'essai se termine, qui sont bloquées dans l'installation ou qui n'utilisent plus l'entrée, avec un message WhatsApp prêt pour le propriétaire.
- **Site** (`web/site/`) : anglais et arabe (`site-ar.js`, lien direct `/?lang=ar`), section « Start simple », captures refaites.

- **Prix** : Essential 15 $, Studio 29 $, Complete 49 $ par mois, alignés sur les trois niveaux. Premier mois gratuit, sans frais d'installation.
- **Site** : réduit à six blocs (accroche avec la démo d'entrée, trois tâches, prix, démarrage en trois étapes, quatre questions, demande d'essai). La demande d'essai pose cinq questions, une par carte ; sans JavaScript, le formulaire s'affiche en entier et fonctionne quand même.
- **Telegram** (en attendant WhatsApp Business) : un seul bot GMS pour toutes les salles. Tu le crées une fois avec @BotFather et tu colles son token sur la page Platform (carte « Telegram ») : GMS le vérifie, branche le webhook (`/api/webhooks/telegram/<secret>`) et garde le token chiffré. Aucune variable d'environnement ni Terraform à toucher.
  - Une salle l'active dans Settings → Advanced → Telegram. Un membre se connecte avec un lien à usage unique (bouton « Connect their Telegram » sur sa fiche, envoyé par WhatsApp ou scanné à l'accueil) ou depuis l'app membre. Ensuite ses rappels et messages partent sur Telegram, tout seuls ; s'il n'est pas connecté, rien ne change (WhatsApp clic-pour-envoyer).
  - L'assistant de la salle répond aux membres sur Telegram ; « je veux parler à quelqu'un » prévient le propriétaire et le gérant.
  - Le propriétaire et le gérant connectent leur Telegram dans « Your account » : résumé de la semaine chaque lundi à 9 h (Beyrouth), `/summary` à la demande, et questions sur leurs chiffres.
  - Toi : nouvelles demandes d'essai en direct et résumé de la plateforme le lundi. `/stop` déconnecte n'importe qui.
  - Code : `server/services/telegram.ts`, `server/modules/telegram.ts`, `server/services/weekly.ts`, migration `007_telegram.sql`.
- **Page confidentialité et conditions** : `/privacy`, en anglais et en arabe, liée en pied de page du site.
- **Archiver une salle** (page Platform → Archive) : avec une raison. La salle quitte la liste principale, son équipe et ses membres sont déconnectés et ne peuvent plus se connecter, les rappels s'arrêtent. Toutes les données restent ; « Restore » la remet telle quelle. « Delete for good » n'existe que pour une salle archivée et demande de retaper son adresse (slug) : tout est effacé, sans retour possible. Migration `006_gym_archive.sql`.

Ce qui reste en anglais : la référence d'API, l'écran plateforme (pour toi), et les textes de conseil « Focus now » calculés par le serveur (niveau Everything).
