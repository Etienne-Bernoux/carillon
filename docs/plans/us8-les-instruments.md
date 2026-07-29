# US8 — Les instruments

> Statut : **livrée** · Branche `feat/us7-le-rythme` (voir l'écart de process ci-dessous) · 238 tests,
> 162 assertions navigateur

## Écart de process, assumé

Ce plan a été écrit **pendant** le travail, pas avant. Ma propre boucle dit « plan → work », et je m'en
suis écarté : la demande d'instruments est arrivée en cours d'US7, et rythme et timbre se jugent
**ensemble à l'oreille** — un instrument ne s'évalue pas sur une scène qui ne se répète pas. Les deux
tranches partagent donc une branche et une PR, ce que je signale plutôt que de le maquiller en deux
histoires indépendantes.

## Intent

Le produit n'avait qu'**un** timbre depuis l'US1 : sinus plus triangle désaccordé, filtre passe-bas,
réverbe. Joli, et identique pour les vingt barres d'une scène comme pour les cinq gammes disponibles.
Changer de gamme changeait les hauteurs ; rien ne changeait la **couleur** du son.

## La décision structurante : un instrument est une paire de voix

Un carillon réel ne sonne pas pareil dans le grave et dans l'aigu. Et un instrument dont toutes les
barres partagent exactement la même enveloppe s'entend comme un synthétiseur monotone, quelle que soit
la beauté de l'enveloppe.

Chaque instrument porte donc **deux voix** — une grave, une aiguë — séparées par une note de bascule.
C'est la réponse à « combiner des types de sons » : la combinaison est **automatique**, chaque scène
mélange deux timbres selon le registre de ses barres, et aucun mode n'est ajouté. L'US6 avait établi ce
principe : on n'introduit pas de mode quand on peut s'en passer.

La bascule est exprimée en **MIDI**, pas en fraction de l'étendue : une gamme peut changer de tonique, et
le point de bascule doit rester une hauteur réelle plutôt qu'une position dans un tableau.

## Périmètre

**Dedans** : quatre instruments (carillon, bois, verre, corde), le descripteur de voix dans le cœur pur,
le moteur audio paramétré par ce descripteur, un bouton qui cycle, et l'annonce accessible.

**Dehors**

- **L'instrument dans le lien de partage** : demande un format v2. Le format v1 encode gamme, barres et
  sources ; y ajouter l'instrument et le tempo va ensemble, et c'est une US à soi seule (rétro-lecture
  des liens déjà émis comprise).
- **Un instrument par barre** : ce serait un vrai éditeur, avec une notion de sélection que le produit
  n'a pas. La bascule par registre donne déjà la combinaison sans ce coût.
- **Réverbe par instrument** : l'impulsion est procédurale et partagée. Une réverbe par timbre voudrait
  dire quatre convolveurs, pour un gain que rien ne démontre aujourd'hui.

## Décisions de conception

**Le timbre est un réglage de lecture, pas une donnée de scène.** Il ne touche aucune hauteur, donc il
vit **hors de l'historique** et hors du lien — exactement comme le silence. La gamme, elle, réaccorde
les barres : elle fait partie de l'état et elle est dans l'instantané. La ligne est là, et elle est
défendable : `undo` restaure une scène, pas un réglage de sortie.

**Le cœur ne décrit que des nombres.** `core/instruments.ts` ne connaît pas Web Audio ; il expose des
formes d'onde, des durées, des ratios de filtre. C'est ce qui rend un timbre assertable sans navigateur,
et ce qui empêche un réglage de se cacher dans l'adaptateur où rien ne peut le tester. Le moteur reste
mince : il **route**, il ne décide pas — la décroissance lui est même passée toute calculée.

**Les bornes de durée sont explicites par voix.** Le carillon historique bornait le rapport grave/aigu à
`[0,35 ; 1]`. Une cloche de verre doit pouvoir tenir plus longtemps dans le grave. Une borne commune
aurait soit changé le timbre de référence, soit bridé les nouveaux — et le premier serait passé
inaperçu, faute d'oreille dans une suite de tests.

## Critères d'acceptation

| # | Critère | Résultat |
|---|---|---|
| H1 | Le carillon sonne **exactement** comme avant l'US8 | ✅ test doré : l'ancienne formule de décroissance est reproduite en dur et comparée sur 69 notes (MIDI 40→108) |
| H2 | Un instrument combine deux voix, la bascule se fait sur une hauteur réelle | ✅ 3 tests ; les trois nouveaux instruments ont deux voix réellement différentes |
| H3 | Chaque instrument a un caractère **mesurable**, pas seulement un nom | ✅ le bois est plus court que le carillon, le verre plus long, et le rapport verre/bois dépasse 2 à note égale |
| H4 | Chaque instrument produit réellement du son (4 combinaisons de formes d'onde, dont une voix nue) | ✅ scénario `timbres` : 10 notes par instrument, vrai déverrouillage audio par geste |
| H5 | Aucune note n'est inaudiblement courte ni interminable, sur tout le catalogue | ✅ testé sur MIDI 24→120 pour les quatre instruments |
| H6 | Changer d'instrument ne change **aucune** hauteur | ✅ navigateur, sur six barres de longueurs variées (91, 88, 86, 84, 81, 79) |
| H7 | Le 7ᵉ contrôle ne dégrade pas la densité du HUD | ✅ **29 %** d'un 320×568, comme avec six — deux rangées, sept contrôles |
| H8 | Aucune régression | ✅ 12 scénarios verts, 162 assertions, 0 erreur console |

### Ce que le harnais a attrapé tout seul

Le septième bouton a fait passer le HUD de 29 % à **36 %** d'un 320×568, effaçant le gain de l'US6.
L'assertion de densité écrite à l'US6 l'a signalé au premier run — sans elle, la régression partait en
production, parce qu'un HUD un peu plus haut ne se remarque pas sur une capture.

Cause : les deux boutons porteurs d'état prenaient chacun une rangée entière (`flex-basis: 100%`).
Corrigé en les faisant **partager** la première rangée (`flex: 1 1 45%`) : ils occupent 90 % de sa
largeur, donc aucun pictogramme ne peut s'y glisser, et le regroupement se lit comme une intention.

### Une assertion que j'ai dû durcir

« Changer d'instrument ne change aucune hauteur » comparait d'abord six barres **de longueur
identique** : six fois la même note, donc deux listes constantes de part et d'autre. Vraie quoi qu'il
arrive. Les longueurs sont maintenant variées, et l'assertion exige au moins quatre hauteurs distinctes
avant de comparer.

## Risques

- **Quatre timbres, aucun jugé à l'oreille par un humain.** Les tests prouvent qu'ils *diffèrent* et
  qu'ils *sonnent*, pas qu'ils sont *beaux*. Le verre à `filterQ: 2,6` et la corde en dent de scie
  peuvent être agressifs à forte densité. C'est le seul critère de cette US qu'une machine ne peut pas
  trancher, et il reste ouvert.
- **L'écrêtage n'est toujours pas mesuré** (G6 de l'US7). Le verre a une décroissance de 2,6 s dans le
  grave contre 0,9 s au carillon : à densité égale, il y a donc bien plus de voix simultanées, et le
  risque de saturation augmente. À mesurer par rendu hors ligne avant d'aller plus loin sur les timbres.
