# GMS — business plan (version 2, novembre 2026)

## En une phrase

Un logiciel de gestion à abonnement mensuel pour les salles de sport libanaises, qui remplace WhatsApp + Excel,
fait gagner du temps à la réception, sécurise l'argent (dollars et livres) et réduit les départs de membres.

## Le marché

- Environ **1 100 salles au Liban**, dont ~176 à Beirut, ~40 à Tripoli, ~21 à Byblos ([poidata.io, nov. 2025](https://poidata.io/report/gym/lebanon)).
- La plupart fonctionnent encore au téléphone : réservations par WhatsApp, renouvellements de mémoire, planning en photo ([span.it.com](https://span.it.com/guides/how-to-manage-a-gym-in-lebanon/)).
- Tendance : de plus en plus de petites salles et de studios boutique plutôt que de grands clubs ([Executive Magazine](https://www.executive-magazine.com/page/145?id=386)). Ce sont exactement des clients pour un logiciel simple et abordable.
- Cible réaliste à 3 ans : 10 % du marché = 110 salles.

## La concurrence

| Concurrent | Positionnement | Notre différence |
|---|---|---|
| WhatsApp + Excel + cahier | Gratuit, ce que 80 % des salles utilisent | GMS garde WhatsApp (clic-pour-envoyer) mais ajoute le suivi, les rappels, l'argent et l'entrée |
| GymLeb | Local, 20+ salles, rappels WhatsApp, contrôle d'accès Hikvision ([G2](https://www.g2.com/products/gymleb/discuss)) | Démarrage simple par niveaux, arabe complet, entrée qui marche sans internet, application membre à la marque de la salle, cours avec liste d'attente |
| Fitness Force | CRM international arrivé au Liban en mai 2025 ([blog](https://www.fitnessforce.com/blog)) | Prix libanais (19–49 $ contre des outils à 100–300 $), interface arabe, WhatsApp et Telegram, accompagnement sur place |
| Outils internationaux (Glofox, Mindbody…) | 100–300 $/mois en général ([Recess](https://www.recess.tv/blog-posts/gym-management-software-pricing-in-2025-what-you-need-to-know)) | Trop chers, pas de LBP, pas d'arabe, pas de WhatsApp clic-pour-envoyer |

## L'offre

Trois formules, alignées sur les trois niveaux du produit (détail dans `docs/PRODUIT.md`) :

| Formule | Pour qui | Prix |
|---|---|---|
| Essential | Salle de musculation | 19 $/mois |
| Studio | Salle avec cours ou coachs | 29 $/mois |
| Complete | Rappels automatiques et assistant pour les membres | 49 $/mois |

Premier mois gratuit avec leurs vrais membres, sans frais d'installation, sans engagement. À l'année, 2 mois offerts.
Paiement en dollars par Whish, OMT ou espèces. Le prix est fixé à la création de la salle.

En attendant un numéro WhatsApp Business, les messages automatiques, l'assistant et le résumé hebdomadaire du
propriétaire passent par **un bot Telegram GMS** commun à toutes les salles. Une salle passe à WhatsApp Business le
jour où elle fournit son numéro.

## Les chiffres

Hypothèses de la version 1 : 3 nouvelles salles par mois pendant 6 mois puis 5 par mois, 3 % de départs mensuels,
panier moyen 55 $ (ancienne grille 29–99 $).

| Plan v1 (panier 55 $) | Mois 12 | Mois 24 |
|---|---|---|
| Salles payantes | ~42 | ~80 |
| Revenu mensuel récurrent | ~2 300 $ | ~4 400 $ |

Avec la nouvelle grille, le panier moyen tombe vers **25 $** (estimation : 60 % Essential, 30 % Studio, 10 % Complete) :
au même rythme, ~1 050 $ par mois à 12 mois. La revue de novembre 2026 (`docs/REVUE-2026-11.md`) juge ce rythme
optimiste depuis la France : plutôt **8 à 15 salles payantes à 12 mois, soit 200 à 375 $ par mois**.

Coûts : ~85 $/mois d'AWS au départ (moins en pause entre les démos), quelques dollars par salle en Complete pour l'IA.
Telegram est gratuit ; WhatsApp Business facture chaque message envoyé.

**Verdict.** Un revenu d'appoint à côté d'un CDI et une belle référence, pas un salaire à 12 mois. Le potentiel de
croissance est régional (Irak, Jordanie), après 30 salles payantes au Liban.

## Les risques et comment les réduire

| Risque | Réponse |
|---|---|
| Vente depuis la France | Partenaire au Liban (coach, ancien gérant), payé 40–50 $ par salle signée plus 20 % la première année |
| Les salles ne paient pas un logiciel | Mois gratuit avec leurs vraies données ; montrer dès la démo le total des impayés et la liste des membres qui ne viennent plus |
| Paiement des abonnements GMS | Whish / OMT / espèces, prépayé ; facturation annuelle encouragée |
| Coupures d'électricité ou d'internet | L'entrée continue sur le poste de l'accueil et se synchronise au retour ; les paiements se notent et se saisissent après |
| Pas de numéro WhatsApp Business | Bot Telegram GMS pour les rappels et l'assistant ; WhatsApp clic-pour-envoyer pour les membres non connectés |
| Concurrent local (GymLeb) | Simplicité, prix, arabe, proximité et vitesse d'exécution |

## Feuille de route

1. **Mois 1** — Déployer, 15 entretiens de gérants (Akkar et Tripoli d'abord), 3 salles pilotes en mois gratuit.
2. **Mois 2–3** — Ajuster le produit avec les pilotes, 3 témoignages, conversion en payant.
3. **Mois 4–6** — Partenaire commercial, recommandations entre gérants, Instagram ciblé gérants de salles, nom de domaine.
4. **Après 6 mois** — WhatsApp Business pour les salles qui le veulent, contrôle d'accès (tourniquets), paiement en ligne, multi-salles, expansion régionale.
