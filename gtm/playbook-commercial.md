# Playbook commercial GMS

Objectif du premier mois : **15 démos, 3 salles pilotes**. La liste des 98 salles est dans
`GMS-prospects-Lebanon.xlsx` (onglet *Prospects*), triée par priorité. Commencer par les salles **A**
(indépendantes, plus de 40 avis Google : actives, le décideur est sur place).

## Ordre d'attaque

1. Salles A de Beirut et du Metn (proches, nombreuses, habituées aux outils).
2. Salles A de Keserwan, Jbeil, Batroun.
3. Studios femmes, box CrossFit et clubs de boxe : ils ont le plus besoin des cours et de l'application membre.
4. Chaînes (Fitness Zone, Goodlife, Fit20, F45…) : cycle plus long, viser une seule succursale pilote.

## Premier message (WhatsApp ou Instagram)

Un message, une relance trois jours plus tard, puis on arrête si pas d'intérêt.

**Arabizi**
> Marhaba! Ana Charbel, mhandes men Lebnen. 3am nelta2 ma3 asshab gyms 3an system bisahhel ishtirakat, el dafe3 bel dollar w lira, w reminders 3al WhatsApp bi shakel automatique. Btsamahli 15 d2i2a demo bel gym 3andak hal jem3a? Bfarjik kif bta3rif min mn el members 3am yfello abel ma yfello.

**Arabe**
> مرحبا! أنا شربل، مهندس من لبنان. عم نشتغل مع أصحاب نوادي رياضية على برنامج بيسهّل الاشتراكات، الدفع بالدولار والليرة، وتذكير تلقائي عالواتساب. بتسمحلي بـ ١٥ دقيقة عرض بالنادي هالجمعة؟ بفرجيك كيف بتعرف مين من المشتركين عم يفلّ قبل ما يفلّ.

**English**
> Hi! I'm Charbel, a Lebanese engineer. I built GMS, a gym system made for Lebanon: memberships, payments in dollars and lira, QR entry, and automatic WhatsApp renewal reminders. Could I show you in 15 minutes this week? I'll show you which of your members are about to leave, before they do.

## La démo (15 minutes, sur la salle de démo « Cedar Fitness »)

| Temps | Montrer | Phrase clé |
|---|---|---|
| 0–2 | Leur situation : « Comment vous savez qui doit renouveler cette semaine ? » | Laisser parler. Noter les douleurs. |
| 2–4 | **Today** : phrase du jour, qui termine cette semaine, impayés | « Ça, c'est votre matinée en 10 secondes. » |
| 4–6 | **Check-in** : scanner un QR, voir le disque vert, puis un membre expiré en rouge | « Plus personne n'entre avec un abonnement fini. » |
| 6–8 | **Vente/renouvellement** en dollars puis en livres, reçu imprimé | « Le taux du jour, le reçu, et la caisse du soir est juste. » |
| 8–10 | **Messages** : rappels préparés, un clic = WhatsApp ouvert | « Vous gardez votre WhatsApp, GMS fait le travail. » |
| 10–12 | **Insights** : membres à risque avec les raisons, brouillon de message en arabizi | « Ces 13 personnes, c'est ~500 $ par mois qui va partir. » |
| 12–14 | **Application membre** sur votre téléphone : QR, réservation de cours, question en arabizi | « Votre appli, à votre nom, sans passer par l'App Store. » |
| 14–15 | Proposition | « J'importe votre Excel gratuitement et vous l'utilisez 30 jours. Si ça ne vous fait pas gagner de temps, vous arrêtez. » |

Avant la démo : `node seed-demo.js` (ou Platform → New gym → *Fill with demo data*), et se connecter en `owner@demo.gms`.

## Objections fréquentes

| Objection | Réponse |
|---|---|
| « J'ai déjà Excel / WhatsApp. » | GMS garde WhatsApp. Ce qu'Excel ne fait pas : bloquer l'entrée d'un abonnement fini, rappeler tout seul, montrer qui va partir. |
| « C'est cher. » | Un seul membre retenu par mois (45–60 $) paie l'offre Pro. On le voit dans l'onglet *At risk* dès la première semaine. |
| « Mes employés ne savent pas utiliser un logiciel. » | La réception fait deux gestes : scanner et encaisser. Formation sur place de 30 minutes incluse. |
| « Et si internet coupe ? » | Fonctionne en 4G depuis un téléphone ; le QR des membres reste lisible hors connexion. |
| « Mes données ? » | Hébergement AWS en Europe, sauvegardes 14 jours, chaque salle ne voit que ses données, export Excel à tout moment. |
| « Il y a GymLeb. » | Comparer sur place : application membre à leur marque, cours avec liste d'attente, IA, prix. |

## Mise en service d'une salle pilote (2 heures)

1. Platform → **New gym** avec le bon modèle (classique, femmes, CrossFit, boxe), offre Pro, statut *trial*.
2. Settings → logo, couleur, taux LBP, horaires, heures femmes, règles d'entrée.
3. Settings → **Plans & prices** : leurs vraies formules.
4. Members → **Import from Excel** (vérifier d'abord, puis importer).
5. Settings → **Team** : un compte par personne de l'accueil et par coach.
6. Imprimer le QR de l'application membre (Settings → Member app) et le poser à l'accueil.
7. Brancher un lecteur QR USB sur l'ordinateur de l'accueil (~25 $), ou utiliser la tablette.
8. Envoyer un message « bienvenue sur l'appli » aux 20 membres les plus actifs (profil → *Give app access*).
9. Revenir après une semaine : regarder les chiffres ensemble, régler ce qui gêne.

## Suivi

Mettre à jour la colonne *Status* du fichier de prospects ; l'onglet *Pipeline* se met à jour seul,
y compris le revenu mensuel signé.
