# GMS — Gym Management System

Logiciel de gestion de salles de sport pensé pour le Liban : abonnements, paiements en dollars **et** en livres,
entrée par QR code, cours collectifs, coaching privé, rappels WhatsApp, application membre aux couleurs de la salle,
et une IA qui prédit qui va partir et répond aux membres en arabe, en arabizi, en anglais ou en français.

Une seule plateforme (multi-tenant) sert toutes les salles. Chaque salle part d'un **modèle** (salle classique,
studio femmes, box CrossFit, club de boxe) puis se personnalise sans code : logo, couleur, formules et prix,
horaires et heures femmes, règles d'entrée, modules activés, équipe et rôles.

## Ce qu'il y a dans ce dossier

| Dossier | Contenu |
|---|---|
| `server/` | API Node 22 + TypeScript, client PostgreSQL maison (TLS, SCRAM), IA (churn, RAG, assistant, bot WhatsApp), tâches de fond |
| `web/` | Back-office React (réception, gérant, coach, plateforme) et application membre (PWA) |
| `tests/` | 30 tests : API de bout en bout sur une vraie base PostgreSQL + tests unitaires |
| `infra/` | Terraform AWS (ECS Fargate, RDS, ALB HTTPS, Secrets Manager, alarmes) + guide de déploiement |
| `Dockerfile`, `docker-compose.yml` | Image de production et lancement local en une commande |
| `.github/workflows/` | CI : typecheck + tests + build ; déploiement automatique sur `main` |
| `gtm/` | Business plan, playbook commercial, **liste de 98 salles à démarcher**, page de vente, fiche à imprimer |
| `docs/` | Description fonctionnelle et captures d'écran |

## Démarrer en local (5 minutes)

Avec Docker :
```bash
docker compose up --build
docker compose exec app node seed-demo.js     # deux salles de démo pleines de données réalistes
```
Puis ouvrir http://localhost:8080 :

| Qui | Identifiant | Mot de passe |
|---|---|---|
| Vous (plateforme GMS) | admin@gms.local | admin12345 |
| Propriétaire de la salle de démo | owner@demo.gms | demo12345 |
| Réception de la salle de démo | reception@demo.gms | demo12345 |
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
  La recherche (RAG) comprend l'arabe, l'arabizi et l'anglais. Sans clé API, tout fonctionne en mode hors ligne ;
  avec une clé Anthropic (offre Elite), l'assistant répond librement dans la langue du membre.

Ce qui n'a pas pu être fait ici : l'installation de Next.js et Prisma était bloquée dans cet environnement, d'où le
choix d'une stack sans dépendances ; Terraform n'a pas pu être exécuté (à valider avec `terraform plan` chez vous) ;
les polices (Archivo, IBM Plex Sans Arabic) se chargent depuis Google Fonts.
