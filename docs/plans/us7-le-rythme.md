# US7 — Le rythme

> Statut : **première tranche livrée** · Branche `feat/us7-le-rythme` · 225 tests, 152 assertions navigateur

## Intent

Carillon sonne joli et ne sonne **jamais en rythme**. Deux causes distinctes, et elles n'ont pas le
même remède :

1. **Rien ne se répète.** Une bille lâchée à la main joue trois notes puis sort de l'écran et
   disparaît. Sans source, la scène meurt ; avec des sources, elle bruisse en continu mais sans
   période audible. Il n'existe aucun objet « motif ».
2. **Les périodes des sources sont libres** (en secondes : 0,15 à 2,4). Deux sources à 0,9 s et 0,7 s
   dérivent l'une par rapport à l'autre indéfiniment — c'est mathématiquement un battement de 8,2 s
   que l'oreille entend comme du désordre.

## Le désaccord à poser d'abord : on ne quantifie pas les notes

La solution réflexe serait de **quantifier les notes à l'attaque** : retarder chaque note jusqu'au
prochain pas de grille (1/8 à 120 BPM = 250 ms au pire). Ça donnerait un groove immédiat.

**Je suis contre, et c'est un refus de conception, pas une réserve de perfectionniste.** La promesse du
produit tient en une phrase — « la physique fait la musique » — et sa vérification est *oculaire* : on
**voit** la bille toucher la barre au moment où on **entend** la note. Décaler le son de 250 ms casse
exactement ce lien : on verrait un impact silencieux, puis on entendrait une note venue de nulle part.
Le produit deviendrait un séquenceur avec une animation décorative.

**Ce qu'on quantifie, c'est la cause, pas l'effet** : l'instant d'**émission**. Une bille émise sur la
grille frappe sa première barre à `grille + temps_de_chute`, et le temps de chute est une constante de
la géométrie. Donc deux sources à la même hauteur frappent **en phase**, et le motif se répète à chaque
mesure — sans qu'aucune note ne mente sur ce qu'on voit.

## Périmètre

**Dedans**

- Une **horloge musicale** : tempo (BPM) et une grille de subdivisions. Pure, dans le cœur.
- Les périodes de sources s'expriment en **divisions** (1, 1/2, 1/3, 1/4, 2/3 de mesure) au lieu de
  secondes libres, et les émissions tombent **sur la grille**, pas sur une échéance dérivante.
- Le **recyclage des billes** : une bille qui sort par le bas **revient** à son point d'origine, au
  prochain temps de la grille. Une bille lâchée à la main devient un élément rythmique permanent, sans
  avoir à poser une source. C'est le seul mécanisme de l'US qui crée un motif à partir d'un seul geste.
- **« Ça sonne bien », mesuré** : rendu **hors ligne** (`OfflineAudioContext`) d'une scène dense, et
  assertion sur la **crête** et l'énergie du signal. Aujourd'hui la seule preuve audio est
  `notes > 0` — un compteur d'appels, qui ne dit rien de ce qui sort des haut-parleurs.

**Dehors**

- **Les kits d'instruments** → US8. C'est une US entière (descripteur de voix, variation par registre,
  format de partage v2 pour transporter le kit) et elle se juge à l'oreille sur une base rythmique
  stable. Faire les deux d'un coup, c'est ne pouvoir juger ni l'un ni l'autre.
- Quantification des notes à l'attaque : refusée ci-dessus, définitivement.
- Métronome audible, clic de décompte : ce n'est pas un DAW (non-but de la stratégie).

## Décisions de conception

**L'horloge est une fonction, pas un état qui tourne.** `gridTimeAfter(time, division, tempo)` rend le
prochain instant de grille. Aucun compteur à faire avancer, donc rien à resynchroniser après un `undo`,
un changement de tempo ou un rechargement depuis un lien. C'est la leçon de l'US4 : `nextAt` copié dans
un instantané avait provoqué une rafale de billes à l'annulation, parce qu'un compteur d'échéance est un
état transitoire déguisé en donnée.

**Le tempo est global, la division est par source.** Un tempo par source serait polyrythmique et
inaudible ; une division par source suffit à construire un motif (une source à la mesure, une à la
croche). Le tempo voyage dans le lien de partage, les divisions aussi.

**Le recyclage est un attribut de la bille, pas un mode global.** Une bille recyclée garde son point
d'origine ; une bille née d'une source retourne à sa source. Pas de bouton « mode boucle » : le
recyclage est **l'attribut par défaut des billes lâchées à la main**, et l'US6 a établi qu'on
n'introduit pas de mode quand on peut s'en passer.

**Le plafond de billes ne bouge pas** (320). Le recyclage ne crée aucune bille : il en ressuscite une
qui vient de mourir. Le nombre de billes vivantes est donc borné par construction — et c'est exactement
ce qu'il faut asserter, parce qu'un recyclage mal fermé est une fuite infinie.

## Critères d'acceptation

| # | Critère | Résultat |
|---|---|---|
| G1 | `gridTimeAfter` rend un instant strictement postérieur, aligné, sans dérive sur 10 000 pas | ✅ 13 tests d'horloge. L'`EPSILON` n'est pas décoratif : sans lui, un temps valant « exactement » 3 pas mais s'écrivant 2,9999999999999996 renvoie le pas 3 comme suivant — donc une boucle d'émission qui ne progresse jamais |
| G2 | Deux sources de même division émettent **exactement** en phase, indéfiniment | ✅ égalité exacte sur 200 mesures en unitaire, et `1.25 vs 1.25` puis `121.25 vs 121.25` dans le navigateur après 120 s simulées |
| G3 | Une bille lâchée à la main revient à son origine, sur un temps de la grille | ✅ 3 tests + scénario `rythme` |
| G4 | Le recyclage ne fuit pas | ✅ 4 tests + navigateur : 320 billes max, `droppedSteps` à 0 après 180 s et 60 billes recyclées |
| G5 | Le motif est périodique d'une mesure à la suivante | ⏳ **non fait** |
| G6 | Aucun écrêtage (rendu hors ligne) | ⏳ **non fait** — demande d'extraire la construction de voix sur `BaseAudioContext` |
| G7 | Un changement de tempo ne produit ni rafale ni silence | ✅ et c'est **la** propriété qui distingue une échéance recalculée d'une échéance cumulée (voir ci-dessous) |
| G8 | Aucune régression | ✅ 11 scénarios verts, 152 assertions, 0 erreur console, 120 fps à 316 billes |

### Ce que la mutation a appris ici

Remplacer `nextAt = gridTimeAfter(nextAt, …)` par `nextAt += période` passait **19 tests sur 19**, dont
celui qui s'appelle « deux sources émettent exactement en phase ». C'est mathématiquement normal :
depuis une échéance déjà alignée, l'accumulation retombe sur les mêmes instants. Les deux versions ne
divergent qu'au **changement de tempo**, où l'accumulation reste sur l'ancienne grille pour toujours.

L'assertion qui manquait ne portait donc pas sur la phase mais sur le tempo — et elle a demandé deux
tentatives, la première relevant l'échéance depuis le callback d'émission, appelé **avant** la mise à
jour, donc lisant l'ancienne valeur.

### Écarts au plan, assumés

- **Le tempo ne voyage pas encore dans le lien de partage.** Le format v1 encode une période libre en
  secondes ; elle est relue vers la division la plus voisine (`nearestDivisionIndex`), donc **aucun lien
  déjà émis n'est cassé**, mais un lien rejoué l'est à 96 BPM. Le tempo dans l'URL demande un format v2,
  qui va avec les instruments (US8).
- **Aucun réglage de tempo dans l'interface** : il est fixé à 96 BPM. La grille et les divisions sont ce
  qui rend le rythme audible ; un curseur de tempo sans instruments à écouter dessus serait prématuré.
- **`2/3` remplacé par `1/8`** dans le catalogue de divisions. La plus fine valait sinon 1/4 de mesure,
  soit 0,625 s à 96 BPM — quatre fois plus lent que la période minimale d'avant l'US7. Une scène a besoin
  d'au moins une source qui pulse vite. L'ordre n'était pas encore figé : rien n'avait été partagé avec.

### Un geste nouveau : taper une source

`cycleDivision` aurait été du code mort sans un geste pour l'atteindre. Taper une source change son
rythme, et l'annonce accessible le dit dans le vocabulaire de la mesure (« une par demi-mesure ») et non
en secondes. Deux découvertes en le câblant :

1. Un tap sur une source ne faisait **rien** jusqu'ici — l'entrée émettait un geste nommé `tap-bar` pour
   *toute* cible, sources incluses, et `main` ignorait le cas. Le geste s'appelle désormais `tap`.
2. Ma première assertion de grille était **tautologique** (`nextAt - période <= nextAt`, vraie par
   construction). Remplacée par « l'échéance est un multiple de la période » : écart mesuré 0,00e+0.

## Risques

- **Le tempo-verrouillage peut rendre le résultat mécanique** — le charme actuel vient précisément de
  l'irrégularité. Atténuation : la grille contraint l'**émission**, pas les rebonds ; la polyrythmie
  naturelle des rebonds successifs survit entièrement. À juger **à l'oreille**, pas sur les chiffres.
- **G5 (périodicité) peut être faux pour une bonne raison** : deux billes qui se croisent ne
  s'influencent pas (pas de collision bille-bille), mais une barre qui vient d'être frappée n'a pas
  d'état sonore persistant non plus. Si la périodicité échoue, c'est un vrai défaut à trouver, pas un
  critère à assouplir.
- **`OfflineAudioContext` mesure une autre chose que la sortie réelle** si la construction de voix
  diffère entre les deux contextes. Il faut donc que le **même** code construise la voix dans les deux
  cas (`BaseAudioContext`), sinon G6 est creux. À vérifier par mutation : dégrader le gain maître doit
  faire bouger la crête mesurée.
- **Le recyclage rend la scène perpétuelle**, donc les scénarios existants qui attendaient l'extinction
  des billes peuvent changer de sens. À relire un par un.

## Orchestration

Écrit par moi. Review déléguée à un agent qui n'a pas écrit le code — sur six US, elle a trouvé 3, 2,
3, 3, 1 puis (US6, en cours) des bloquants réels, et deux fois le défaut était un test **incapable
d'échouer**.
