# GMS — business plan (version 1, novembre 2026)

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
| WhatsApp + Excel + cahier | Gratuit, ce que 80 % des salles utilisent | GMS garde WhatsApp (clic-pour-envoyer) mais ajoute le suivi, les rappels, l'argent et l'entrée QR |
| GymLeb | Local, 20+ salles, rappels WhatsApp, contrôle d'accès Hikvision ([G2](https://www.g2.com/products/gymleb/discuss)) | Application membre à la marque de la salle, cours avec liste d'attente, IA qui prédit les départs, assistant en arabizi, multi-devises, modèles par type de salle |
| Fitness Force | CRM international arrivé au Liban en mai 2025 ([blog](https://www.fitnessforce.com/blog)) | Prix libanais (29–99 $ contre des outils à 100–300 $), interface arabe, WhatsApp natif, accompagnement sur place |
| Outils internationaux (Glofox, Mindbody…) | 100–300 $/mois en général ([Recess](https://www.recess.tv/blog-posts/gym-management-software-pricing-in-2025-what-you-need-to-know)) | Trop chers, pas de LBP, pas d'arabe, pas de WhatsApp clic-pour-envoyer |

## L'offre

Starter 29 $, Pro 59 $, Elite 99 $ par mois et par salle (détail dans `docs/PRODUIT.md`), plus des frais
d'installation et d'import de 100 $ (offerts aux 5 premières salles). Paiement mensuel ou annuel (2 mois offerts).
Essai gratuit de 30 jours avec import de leurs données : c'est l'argument qui fait signer.

## Les chiffres (modèle complet dans `GMS-prospects-Lebanon.xlsx`, onglet *Revenue model*)

Hypothèses prudentes : 3 nouvelles salles par mois pendant 6 mois puis 5 par mois, 3 % de départs mensuels, panier moyen 55 $.

| | Mois 12 | Mois 24 |
|---|---|---|
| Salles payantes | ~42 | ~80 |
| Revenu mensuel récurrent | ~2 300 $ | ~4 400 $ |
| Rythme annuel | ~27 600 $ | ~52 700 $ |
| Bénéfice cumulé (hors temps du fondateur) | ~11 800 $ | ~49 700 $ |

Coûts : ~85 $/mois d'AWS au départ, ~4 $/mois et par salle d'IA et de messages. La marge brute dépasse 85 %.
L'équilibre (AWS payé) est atteint dès **2 salles**.

**Verdict.** Rentable comme petite entreprise ou activité à côté d'un CDI, surtout avec un partenaire sur place.
Pas une start-up à lever des millions sur le seul Liban ; le potentiel de croissance est régional (Irak, Jordanie,
Golfe), où les mêmes besoins existent et les prix sont plus élevés.

## Les risques et comment les réduire

| Risque | Réponse |
|---|---|
| Vente depuis la France | Trouver un partenaire au Liban (coach, ancien gérant de salle) payé à la commission (15 % la première année) |
| Les salles ne paient pas un logiciel | Essai gratuit de 30 jours avec leurs vraies données ; montrer le total des impayés et la liste des membres à risque dès la démo |
| Paiement des abonnements GMS | Whish / OMT / virement mensuel ; facturation annuelle encouragée |
| Coupures d'électricité ou d'internet à la salle | Hébergement cloud, QR lisible hors ligne côté membre ; la réception peut travailler depuis un téléphone en 4G |
| Concurrent local (GymLeb) | Différenciation par l'application membre, l'IA et le prix ; vitesse d'exécution et proximité |

## Feuille de route

1. **Mois 1** — Déployer sur AWS, faire 15 démos (liste A), signer 3 salles pilotes en essai gratuit.
2. **Mois 2–3** — Ajuster le produit avec les pilotes, obtenir 3 témoignages, convertir en payant.
3. **Mois 4–6** — Partenaire commercial, recommandations entre gérants, Instagram ciblé gérants de salles.
4. **Après 6 mois** — Contrôle d'accès (tourniquets), paiement en ligne des abonnements, multi-salles pour les chaînes, expansion régionale.
