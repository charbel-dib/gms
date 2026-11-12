# GMS — description fonctionnelle

## Pour qui, et ce que chacun voit

| Rôle | Voit et fait |
|---|---|
| **Propriétaire** | Tout : tableau de bord, finances et bénéfice, rapports coachs, réglages, équipe, journal d'activité |
| **Gérant** | Comme le propriétaire, sans le journal d'activité ni la gestion des propriétaires |
| **Réception** | Entrées, membres, ventes et renouvellements, paiements, cours, messages. Pas de chiffres financiers globaux |
| **Coach** | Ses cours (présences), ses clients en coaching privé, séances et programmes |
| **Membre** (application) | Son QR d'entrée, son abonnement, réservation des cours, historique, programmes, assistant |
| **Vous (plateforme)** | Toutes les salles, création en 2 minutes depuis un modèle, statut d'abonnement, revenu mensuel GMS |

## Trois niveaux, pour que ce soit simple

Chaque salle choisit ce qu'elle voit, et peut changer n'importe quel jour sans rien perdre.

| Niveau | Pour qui | Ce qu'on voit |
|---|---|---|
| **Essential** (par défaut) | Salle de musculation | Membres, entrée, paiements, rappels WhatsApp : 6 entrées de menu |
| **Studio** | Salle avec cours ou coaching | + cours, coaching privé, application membre |
| **Everything** | Grande salle | + boutique, dépenses, personnes intéressées, conseils de suivi |

L'interface existe en **anglais et en arabe** (droite à gauche), et chaque personne de l'équipe choisit sa langue.

## Le cœur, pensé pour le Liban

- **Paiements en USD et en LBP** au taux du jour réglé par la salle ; chaque paiement est converti en dollars pour des rapports justes.
  Espèces, Whish, OMT, carte, virement, avec référence de transaction. Reçu numéroté imprimable (A5 ou ticket 80 mm).
  Caisse du jour séparée en dollars et en livres pour compter le tiroir.
- **Formules** illimitées ou en nombre de visites (10 entrées, day pass), réservées aux femmes si besoin, avec jours de gel autorisés.
- **Renouvellement intelligent** : le nouvel abonnement démarre le lendemain de la fin du précédent. Remise, paiement partiel, solde dû.
- **Gel** avec plafond par formule, prolongation automatique de la date de fin, dégel anticipé qui rend les jours non utilisés.
- **Heures réservées aux femmes** : la réception refuse automatiquement l'entrée aux hommes pendant ces créneaux.
- **Groupe électrogène** : les dépenses (loyer, salaires, générateur, mazout, électricité EDL…) donnent le vrai bénéfice.
- **Import Excel** des membres existants (dates au format 31/12/2026, numéros 03 123 456), avec vérification avant import.

## Entrée par QR code

La réception tape un nom ou un numéro de membre ; le QR est un raccourci, pas une obligation. Un lecteur USB (~25 $) tape dans la barre de scan, ou la caméra de la tablette scanne directement (Chrome).
Si internet coupe, l'entrée continue sur le poste et se synchronise au retour de la connexion.
L'écran d'entrée affiche un grand disque de couleur — vert entrée, jaune entrée avec alerte, rouge refusée, bleu gelé —
lisible de loin, avec un son différent. Les règles : jours de grâce après expiration, blocage si solde impayé (option),
anti double-scan, visites décomptées, présence au cours marquée automatiquement.

## Cours et coaching

Planning hebdomadaire récurrent, capacité, liste d'attente avec promotion automatique et message WhatsApp
quand une place se libère, annulation d'un cours avec prévenance des inscrits, présences et absences.
Coaching privé : forfaits de séances, séances planifiées, consommées ou manquées, commission des coachs calculée,
programmes d'entraînement envoyés dans l'application du membre.

## WhatsApp

- **Mode clic-pour-envoyer** (par défaut, gratuit, sans configuration) : rappels de fin d'abonnement, relances,
  annonces de groupe préparés dans « Messages » ; un clic ouvre WhatsApp avec le texte prêt.
- **Mode automatique** (offre Elite) : WhatsApp Business Platform, modèles approuvés, et le bot répond aux membres 24 h/24.

## L'IA, utile et explicable

- **Qui va partir ?** Score de risque par membre, appris sur l'historique de la salle (AUC 0,80 sur les données de démo),
  avec les raisons en clair : « Aucune visite depuis 18 jours », « Visites en baisse de 6 », « Abonnement se termine dans 5 jours ».
  Revenu mensuel menacé chiffré. Un clic rédige un message de reconquête en arabe ou en anglais.
- **Demandez à votre salle** : le propriétaire pose une question (« combien on a encaissé ce mois ? », « chou fi members bi5las ishtirakon ? »)
  et reçoit une réponse chiffrée tirée de ses propres données, avec des actions concrètes.
- **Assistant des membres** : prix, horaires, heures femmes, planning, gel, paiements, état de l'abonnement, réservation d'un cours.
  Il connaît automatiquement les réglages de la salle (pas de ressaisie) et passe la main à la réception quand il ne sait pas.

## Application membre

Une PWA (pas de store) à l'adresse `/m/<salle>`, au nom, logo et couleur de la salle, installable sur l'écran d'accueil.
Connexion par téléphone + PIN envoyé par WhatsApp. QR d'entrée lisible hors connexion, jours restants, série de semaines,
réservations, historique, programmes, et assistant.

## Offres GMS (ce que la salle vous paie)

| | Essential 19 $/mois | Studio 29 $/mois | Complete 49 $/mois |
|---|---|---|---|
| Membres, formules, paiements USD/LBP, reçus | ✓ | ✓ | ✓ |
| Entrée QR, heures femmes, gel, import Excel | ✓ | ✓ | ✓ |
| WhatsApp clic-pour-envoyer, prospects, dépenses, rapports | ✓ | ✓ | ✓ |
| Cours collectifs, réservations, liste d'attente | | ✓ | ✓ |
| Coaching privé, commissions, programmes | | ✓ | ✓ |
| Application membre à la marque de la salle | | ✓ | ✓ |
| Prédiction du churn, « Demandez à votre salle » (mode hors ligne) | | ✓ | ✓ |
| WhatsApp automatique + IA conversationnelle (arabe, arabizi) | | | ✓ |

Les modules d'une offre supérieure sont verrouillés automatiquement ; passer à l'offre au-dessus les active.
Premier mois gratuit, pas de frais d'installation, sans engagement ; à l'année, deux mois offerts. Dans le code, les clés restent `starter`, `pro`, `elite` (`server/services/plans.ts`) ; le prix est enregistré par salle à sa création, donc changer la grille ne change pas ce que paient les salles existantes.
