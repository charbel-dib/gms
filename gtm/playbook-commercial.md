# Playbook commercial GMS

Objectif : **valider dans quelques salles avant de vendre**. Trois salles pilotes qui utilisent GMS tous les jours
pendant un mois gratuit, puis on élargit.

La liste est dans `GMS-prospects-Lebanon.xlsx` (onglet *Gyms*) : 265 salles dans tout le Liban, triées par région
(Akkar et le Nord en premier), dont 203 avec un numéro de portable. Chaque ligne a deux liens, « Send in Arabic » et
« Send in English » : WhatsApp s'ouvre avec le message déjà écrit et le nom de la salle dedans.

## Ordre

1. **Akkar : 3 à 5 pilotes gratuits**, là où tu connais quelqu'un. C'est le terrain d'essai (coupures, téléphone,
   espèces), pas la source de revenu. Google Maps n'y montre que 7 salles : les autres se trouvent par le bouche à
   oreille, sur Instagram et Facebook, ou en passant à Halba, Minyara, Bebnine et Kobayat.
2. **Tripoli, Zgharta, Koura** : 40 salles dans la liste, dont plusieurs grandes (plus de 100 avis).
3. **Batroun, Jbeil, Keserwan, Metn, Beyrouth**, puis le Sud et la Bekaa.
4. Chaînes : cycle long, une seule succursale pilote, plus tard.

## Le premier message

Un message, une relance trois jours plus tard, puis on arrête. Quelques messages par jour, envoyés à la main :
beaucoup de messages identiques en peu de temps peuvent faire restreindre un numéro WhatsApp.

**Arabe**
> مرحبا! أنا شربل، مهندس من لبنان. عملت GMS، برنامج بسيط للنوادي الرياضية: مين جوّا، مين دفع، وتذكير التجديد عالواتساب، بالعربي والإنكليزي. بحب قدّم لناديكم شهر ببلاش مع مشتركينكم. بتسمحولي بـ 15 دقيقة هالجمعة لفرجيكم؟

**English**
> Hello! I'm Charbel, an engineer from Lebanon. I built GMS, a simple program for gyms: who's in, who paid, and renewal reminders on WhatsApp, in Arabic and English. I'd like to offer your gym one month free, with your own members. Could I show you in 15 minutes this week?

Joindre la vidéo courte (`gtm/video/GMS-1-meet-ar.mp4` ou `-en`). Quand la personne répond, envoyer la deuxième
(`GMS-2-how-we-start`), qui montre comment on démarre, puis l'affiche (`GMS-one-pager.pdf`).

**Relance (trois jours après)**
> مرحبا، بس حبّيت اتأكد إنو وصلتكم رسالتي عن GMS. إذا مش وقته هلأ، ما في مشكلة أبداً.
> Hello, just checking that my message about GMS reached you. If now is not the time, no problem at all.

## La démo (15 minutes)

Petite salle : se connecter en `owner@demo-halba.gms` (« Halba Gym », niveau Essential, 6 entrées de menu), en arabe.
Salle avec cours : `owner@demo.gms` (« Cedar Fitness », tout activé).

| Temps | Montrer | Phrase clé |
|---|---|---|
| 0–2 | Leur situation : « Comment vous savez qui doit renouveler cette semaine ? » | Laisser parler. Noter les douleurs. |
| 2–4 | **Today** : la phrase du jour et les trois choses à faire, avec les noms | « Ça, c'est votre matinée en 10 secondes. » |
| 4–6 | **Check-in** : taper un prénom, voir le disque vert, puis un membre expiré en rouge | « Plus personne n'entre avec un abonnement fini, et pas besoin de carte. » |
| 6–8 | **Vente/renouvellement** en dollars puis en livres, reçu imprimé | « Le taux du jour, le reçu, et la caisse du soir est juste. » |
| 8–10 | Sur **Today**, toucher l'icône WhatsApp à côté d'un nom : le message est écrit | « Vous gardez votre WhatsApp, GMS écrit le message. » |
| 10–12 | Couper le wifi, faire une entrée, le remettre | « Même sans internet, l'entrée continue. » |
| 12–14 | Seulement si la salle a des cours : **Settings → What you use**, passer en Studio, montrer les cours et l'application membre | « Le jour où vous en avez besoin, c'est un bouton. » |
| 14–15 | Proposition | « J'importe votre Excel ou votre cahier et vous l'utilisez un mois, gratuitement. Si ça ne vous fait pas gagner de temps, vous arrêtez. » |

Avant la démo : `node seed-demo.js` (ou Platform → New gym → *Fill with demo data*), et se connecter en `owner@demo.gms`.

## Objections fréquentes

| Objection | Réponse |
|---|---|
| « J'ai déjà Excel / WhatsApp. » | GMS garde WhatsApp. Ce qu'Excel ne fait pas : bloquer l'entrée d'un abonnement fini, rappeler tout seul, montrer qui va partir. |
| « C'est cher. » | Le premier mois est gratuit. Ensuite, regardez la ligne « Collect » sur Today : ce que GMS vous aide à encaisser chaque mois. |
| « Mes employés ne savent pas utiliser un logiciel. » | La réception fait deux gestes : taper un nom et encaisser. En arabe, sur un téléphone si besoin. Formation sur place de 30 minutes incluse. |
| « Et si internet coupe ? » | L'entrée continue sur le poste et se synchronise au retour de la connexion. Les paiements se notent et se saisissent après. |
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
