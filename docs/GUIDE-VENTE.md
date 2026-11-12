# GMS — guide de vente : tout ce que fait le système, et comment le présenter

Version du 12 novembre 2026. À relire avant chaque démo. Tout ce qui est écrit ici existe dans le produit, sauf la section « Ce qui n'existe pas encore ».

## 1. GMS en trente secondes

GMS est le logiciel de l'accueil d'une salle de sport. Il répond à trois questions que le gérant se pose chaque jour : qui est entré, qui a payé, qui ne vient plus. Il fonctionne sur un téléphone, en arabe et en anglais, encaisse en dollars ou en livres, et prépare les rappels WhatsApp.

Prix : Essential 19 $, Studio 29 $, Complete 49 $ par mois. Installation gratuite, premier mois offert, sans contrat. Deux mois offerts pour un paiement à l'année. Paiement par Whish, OMT ou espèces.

## 2. Le site public, section par section

Adresse actuelle : https://d1vxjmc9mgsjjb.cloudfront.net (le nom de domaine viendra plus tard).

| Section | Ce qu'elle montre | Ce que tu dis |
|---|---|---|
| Haut de page | Le titre « Know who's in, who paid and who stopped coming », deux boutons, et un check-in animé avec de faux membres | « Voilà ce que voit ton accueil : vert il entre, jaune son abonnement finit, rouge il doit de l'argent. » |
| What the desk does all day | Trois cartes (la porte, la caisse, les rappels) et une capture de l'écran « Today » | « Chaque matin, le logiciel te donne trois listes avec des noms, et un bouton WhatsApp à côté de chaque nom. » |
| Three plans | Les trois formules et leurs prix | Voir section 4 |
| Up and running in a week | Trois étapes : on importe les membres, on forme l'accueil, un mois gratuit | « Tu ne retapes rien, on prend ton Excel ou ton cahier. » |
| Questions | Quatre objections courantes | Voir section 8 |
| Try GMS free | Un formulaire en cinq questions (type de salle, nombre de membres, ville, nom, WhatsApp) | La demande arrive sur ta page Plateforme, et sur ton Telegram si le bot est branché |
| Pied de page | Prix, confidentialité et conditions, WhatsApp, connexion | |

Le bouton « العربية » bascule toute la page en arabe sans recharger. La page « Log in » est réservée aux salles clientes ; elle renvoie les autres vers l'essai gratuit.

## 3. Le système, écran par écran

### Ce que voit le gérant (propriétaire ou manager)

- **Today.** Une phrase (« 15 check-ins so far today and $218 collected »), puis trois tâches avec des noms : encaisser ce qui est dû, relancer les abonnements qui finissent cette semaine, écrire à ceux qui ne viennent plus. Chaque nom ouvre WhatsApp avec le message déjà écrit. En dessous : membres actifs, argent dû, encaissé ce mois. Une nouvelle salle voit aussi « Getting started », les cinq étapes de mise en route.
- **Check-in.** On tape un nom ou un numéro, ou on scanne le QR code du membre. Grand écran vert, jaune ou rouge, avec la raison. Règles réglables : jours de grâce, refus si le membre doit de l'argent, heures réservées aux femmes, anti double-scan. Continue de marcher si internet coupe, et se synchronise au retour.
- **Members.** Liste avec recherche, filtres (« Owe money », « Stopped coming »), import et export Excel. La fiche d'un membre : abonnement, paiements, visites, gel, messages, accès à l'application, lien Telegram.
- **Money.** Paiements avec reçu numéroté, en dollars ou en livres au taux de la salle (espèces, Whish, OMT, carte). Caisse du jour séparée en dollars et en livres. Dépenses (loyer, salaires, générateur, mazout) et rapport avec le bénéfice réel, exportable en Excel ou PDF.
- **Messages.** Les rappels du jour et les messages de groupe. Par défaut, un clic ouvre WhatsApp sur le téléphone de la salle avec le texte prêt : rien à configurer, rien à payer.
- **Settings.** La salle, les formules et leurs prix, l'équipe et les rôles, les horaires et règles, le niveau (Essential, Studio, Complete), et les réglages avancés (rappels, WhatsApp, Telegram, application, journal d'activité).

### En plus, à partir de Studio

- **Classes.** Planning hebdomadaire, capacité, réservations, liste d'attente, présences.
- **Personal training.** Forfaits de séances, horaires des coachs, réservation par le membre, commissions calculées.
- **Member app.** Une application au nom et à la couleur de la salle, installée depuis un lien, sans App Store. Le membre y trouve son QR d'entrée, ses jours restants, les cours, ses séances, les offres, la boutique, ses badges et les défis du mois.
- **Follow-up.** La liste des membres qui risquent de partir, avec la raison en clair, et une question libre sur les chiffres de la salle.

### En plus, avec Complete

- **Shop.** Vente à l'accueil, stock, commandes passées depuis l'application.
- **Interested people.** Les personnes qui ont demandé des renseignements, à relancer jusqu'à l'inscription.
- **Rappels automatiques et assistant.** Les rappels partent seuls et un assistant répond aux membres, jour et nuit. Aujourd'hui cela passe par le bot Telegram de GMS ; WhatsApp automatique viendra quand la salle fournira un numéro WhatsApp Business.
- **Résumé du lundi.** Le gérant reçoit sur Telegram les chiffres de sa semaine et peut poser des questions.

### Les rôles

| Rôle | Ce qu'il voit |
|---|---|
| Propriétaire | Tout |
| Manager | Tout, sauf le journal d'activité |
| Accueil | Check-in, membres, ventes, paiements du jour, cours, messages. Pas les chiffres globaux |
| Coach | Ses cours, ses clients, ses séances et sa commission |
| Membre | L'application de sa salle |

### Ta page « Platform »

Toi seul la vois. « Needs you today » liste les salles à relancer (paiement, fin du mois gratuit, mise en route incomplète, plus de check-in depuis une semaine). Tu y crées une salle en deux minutes, tu l'ouvres comme si tu étais le gérant, tu l'archives avec une raison, tu la restaures ou tu la supprimes. Les demandes d'essai du site arrivent ici.

## 4. Les trois formules

| | Essential 19 $ | Studio 29 $ | Complete 49 $ |
|---|---|---|---|
| Pour qui | Salle de musculation | Salle avec cours ou coachs | Salle chargée qui manque de temps pour le suivi |
| Membres, check-in, paiements $ et LBP, reçus | oui | oui | oui |
| Rappels WhatsApp envoyés par la salle | oui | oui | oui |
| Dépenses et rapport mensuel | oui | oui | oui |
| Cours, coaching, application membre | | oui | oui |
| Membres qui risquent de partir | | oui | oui |
| Rappels automatiques, assistant | | | oui |
| Boutique et stock | | | oui |

Une salle peut changer de formule n'importe quel mois, sans rien perdre.

## 5. Comptes de démonstration

| Salle | Connexion | Sert à montrer |
|---|---|---|
| Halba Gym (Essential) | owner@demo-halba.gms / demo12345 | Une petite salle de musculation, six entrées de menu |
| Cedar Fitness (Studio) | owner@demo.gms / demo12345 | Cours, coaching, application membre |
| Application membre | /m/demo, téléphone +9613972985, PIN 1234 | Ce que voit un membre |

## 6. La démo en dix minutes

1. Ouvre Halba Gym sur ton téléphone, pas sur un ordinateur : c'est ce que le gérant utilisera.
2. **Today** : « Voilà ce que tu vois en arrivant le matin. 634 $ te sont dus, par ces personnes. » Appuie sur un nom : WhatsApp s'ouvre avec le message.
3. **Check-in** : tape un prénom, montre l'écran vert, puis un membre expiré, écran rouge.
4. **Paiement** : encaisse un renouvellement en livres, montre le reçu.
5. **Arabe** : bascule la langue.
6. Si la salle a des cours : ouvre Cedar Fitness, le planning, puis l'application membre.
7. Termine par : « On importe tes membres cette semaine et tu l'essaies un mois gratuitement. »

Ne montre pas tout. Trois écrans bien compris valent mieux que douze survolés.

## 7. Ce qui n'existe pas encore (à ne pas promettre)

- Le site web de la salle (prévu, inclus dans Complete, personnalisation en option).
- Le programme de points de fidélité (les badges et les défis existent déjà).
- La version installée sur le PC de la salle, sans internet (abandonnée pour l'instant ; seul le check-in marche hors ligne).
- WhatsApp automatique : il faut un numéro WhatsApp Business par salle. En attendant, Telegram.
- Paiement en ligne des abonnements, tourniquets et contrôle d'accès.
- Un nom de domaine propre à GMS.

## 8. Les objections

| On te dit | Tu réponds |
|---|---|
| « Mon accueil n'est pas à l'aise avec l'informatique. » | L'accueil fait deux choses : taper un nom, enregistrer un paiement. On le forme sur place en trente minutes. |
| « Et si internet coupe ? » | Le check-in continue sur l'appareil de l'accueil et se rattrape au retour. Les paiements se notent et se saisissent après. |
| « J'ai déjà mon Excel et WhatsApp. » | Tu gardes WhatsApp. GMS te dit chaque matin à qui écrire et combien on te doit, ce qu'Excel ne fait pas tout seul. |
| « C'est cher. » | 19 $ par mois, c'est moins qu'un abonnement non renouvelé. Et le premier mois est gratuit. |
| « Mes membres ne vont pas installer une application. » | Ils n'ont rien à installer. L'accueil les trouve par leur nom. |
| « Et mes données si j'arrête ? » | Tu exportes tes membres en Excel quand tu veux, et c'est sans engagement. |

## 9. Le plan de campagne

1. **Avant de contacter qui que ce soit.** Déployer la nouvelle identité, relire tous les textes anglais et arabes, brancher le bot Telegram, refaire l'affiche et une vidéo de 30 secondes avec le nouveau logo.
2. **Semaines 1 et 2 : trois à cinq salles pilotes** au Akkar et à Tripoli, par relation directe. Objectif : de vrais membres importés et un gérant qui ouvre « Today » chaque matin.
3. **Semaines 3 à 6 : le fichier de 265 salles.** Commencer par celles qui ont un Instagram actif, pas de site, 100 à 300 membres, dans le Nord. Dix messages par jour, pas plus, pour pouvoir répondre à chacun.
4. **Ensuite : Beyrouth et le Mont-Liban**, avec les témoignages des pilotes.

Chiffres à suivre chaque semaine : messages envoyés, réponses, démos faites, essais démarrés, salles encore actives après 30 jours.

### Premier message WhatsApp (à adapter avec le nom de la salle)

> Hello, this is Charbel. I built GMS, a simple tool for gym front desks in Lebanon: check-in, payments in dollars or lira, and renewal reminders on WhatsApp. It costs $19 a month and the first month is free. Can I show you in ten minutes this week?

Pour l'arabe, écris le message toi-même, dans tes mots : un message de prospection en libanais doit venir d'un Libanais.

### Relance, trois jours après

> Hello, Charbel again from GMS. Here is a 30-second video of the front desk screen. If it looks useful for your gym, tell me a time that suits you.
