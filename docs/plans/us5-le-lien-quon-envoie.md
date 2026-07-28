# US5 — Le lien qu'on envoie

> Statut : livrée · Branche `feat/us5-le-lien-quon-envoie`

## Intent

Une scène qui tourne bien n'existe que dans l'onglet de celui qui l'a faite. Fermer la page la détruit ;
la montrer à quelqu'un est impossible. C'est ce que `STRATEGY.md` appelle « transformer un jouet en
chose qu'on montre », et c'est le dernier verrou entre Carillon et le fait d'être **partagé**.

Un lien suffit. Pas de compte, pas de serveur, pas de base : la scène **est** l'URL.

## Périmètre

**Dedans** : encoder une scène (barres, sources, gamme) dans l'URL ; la restaurer au chargement ; un
bouton qui copie le lien ; la robustesse d'un lien tronqué ou trafiqué ; et l'invariance : un lien
fabriqué sur un grand écran doit s'ouvrir correctement sur un téléphone.

**Dehors** :
- Raccourcisseur de liens, stockage serveur : contraire au non-but « pas de backend » de la stratégie.
- Galerie de presets : « Scène surprise » plus le partage couvrent le besoin ; on y reviendra si un
  besoin concret apparaît.
- Enregistrement audio ou vidéo : toujours hors sujet (non-but explicite).

## Décisions de conception

**Coordonnées relatives, pas des pixels.** C'est la leçon de l'US2, qui avait coûté une US entière : un
lien encodant des pixels absolus s'ouvrirait de travers sur un autre écran. On encode des fractions de
la zone de jeu, donc un lien fabriqué en 1280 px s'ouvre juste en 375 px — et comme la hauteur d'une
note dérive déjà de la longueur **relative**, le lien joue *les mêmes notes* partout. C'est cette
propriété qui rend le partage intéressant plutôt que fragile.

**On encode la géométrie, jamais les notes.** La hauteur se recalcule depuis la longueur et la gamme.
Encoder les deux ouvrirait la porte à un lien incohérent — une barre dont la note ne correspond pas à
sa longueur.

**Dans le fragment (`#`), pas dans la query.** Le fragment ne part jamais au serveur, et le modifier ne
recharge pas la page : on peut donc tenir l'URL à jour en continu sans casser la scène en cours.

**Format versionné et quantifié.** Un caractère de version en tête ; coordonnées sur 12 bits (soit
deux caractères base64url), ce qui donne une précision de 1/4096 — 0,3 px sur un écran de 1280. Un
lien d'une version inconnue est **ignoré**, jamais une erreur : on retombe sur la scène d'accueil.

**Un lien trafiqué ne doit jamais casser l'app.** C'est la seule entrée non maîtrisée du produit. Tout
décodage échoue en silence et retombe sur la scène d'accueil.

## Critères d'acceptation

| # | Critère | Preuve attendue |
|---|---|---|
| E1 | Aller-retour fidèle : encoder puis décoder une scène rend la même géométrie, à la précision de quantification près (< 0,5 px sur 1280) | test unitaire |
| E2 | **Invariance d'écran** : un lien fabriqué en 1280×800 rouvert en 375×740 donne la même disposition relative **et les mêmes notes** | test unitaire |
| E3 | Robustesse : chaîne vide, tronquée, caractères invalides, version inconnue, milliers de barres → jamais d'exception, retour à la scène d'accueil | test unitaire (balayage d'entrées hostiles) |
| E4 | Budget de taille : une scène de 60 barres et 8 sources tient sous 1 500 caractères d'URL | test unitaire |
| E5 | Dans le navigateur : le bouton met le lien à jour, l'ouvrir dans une page neuve restaure barres, sources et gamme, **et la scène joue** | scénario navigateur + capture |
| E6 | Aucune régression : les 72 assertions existantes restent vertes | sortie du harnais |
| E7 | `pnpm check` vert, captures **regardées** et **postérieures au code** | commandes + horodatages |

### Résultats

| # | Résultat |
|---|---|
| E1 | ✅ aller-retour fidèle à 1/4096 de la plage, angle à 0,04° près |
| E2 | ✅ la longueur reste une fraction de la **largeur**, donc la note est préservée par construction — vérifié sur 6 largeurs de 320 à 3840 px |
| E3 | ✅ 15 entrées hostiles (vide, tronquée, version inconnue, alphabet invalide, 1 000 caractères) : aucune exception, repli sur la scène d'accueil. Vérifié aussi dans le navigateur |
| E4 | ✅ **161 caractères** d'URL pour la scène d'accueil ; 60 barres + 8 sources tiennent sous 1 500 ; au-delà des plafonds, troncature propre |
| E5 | ✅ un lien fabriqué en 1280×800 rouvert en 375×740 : 15 barres sur 15, sources et gamme restaurées, **44 impacts** donc la scène joue, rien derrière le HUD |
| E6 | ✅ 9 scénarios / 84 assertions |
| E7 | ✅ 167 tests ; preuves regardées et postérieures au code |

### Trois formats, et ce que chacun a appris

Le format a été **mesuré** trois fois, pas choisi une fois :

1. **Chaque extrémité normalisée par sa propre dimension.** Un écran d'un autre rapport d'aspect
   déforme les barres diagonales : **13 notes sur 15 décalées, jusqu'à 5 demi-tons**. La mélodie
   partagée n'était plus la même.
2. **Tout normalisé par la largeur.** Les notes redeviennent quasi exactes (1 sur 15), mais une scène
   de bureau s'ouvre sur téléphone en un **bandeau écrasé dans le tiers haut**, deux tiers d'écran
   vides. Fidèle et laid — et un lien qui s'ouvre comme ça ressemble à un produit cassé.
3. **Milieu + longueur + angle.** Le milieu suit l'écran (la scène le remplit : 48 à 85 % selon le
   viewport), la longueur reste une fraction de la largeur (la note est préservée), l'angle est
   conservé. On **repositionne sans déformer**, et les deux propriétés tiennent ensemble.

C'est la capture d'écran du destinataire — pas le test unitaire — qui a disqualifié le format n°2.

### Limites assumées

- **Une note sur quinze** peut se décaler sur un très petit écran : celle d'une barre dont la longueur
  tombe sous le minimum jouable et qu'on allonge plutôt que de la perdre. Perdre une barre d'un lien
  reçu serait pire.
- Une barre dont le milieu est près d'un bord est **translatée** pour rentrer dans la zone, jamais
  raccourcie — raccourcir changerait sa note. Sans cette translation, deux barres passaient derrière
  le HUD en paysage.

## Risques

- **Un lien qui restaure une scène morte** (sans source) : l'US4 vient d'établir que c'est la
  régression la plus silencieuse du produit. Le scénario devra vérifier que la scène restaurée **joue**.
- **La quantification déplace les barres** juste assez pour changer une note (une longueur à la
  frontière de deux degrés). E1 et E2 doivent asserter les **notes**, pas seulement les positions.
- **L'URL grossit sans limite** si on encode 300 barres : E4 borne, et l'encodage devra tronquer
  proprement plutôt que produire un lien inutilisable.
- **Écrire l'URL en continu** peut polluer l'historique du navigateur (une entrée par modification) :
  utiliser `history.replaceState`, jamais `pushState`.

## Orchestration

Écrit par moi : le module d'encodage est court et c'est le cœur du sujet. Trois agents ont calé
(watchdog) plus tôt dans la session — relancer un fan-out ici coûterait plus qu'il ne rapporte.
La **review reste déléguée** à un agent qui n'a pas écrit le code : sur quatre US, elle a trouvé
respectivement 3, 2, 3 et 3 bloquants réels.
