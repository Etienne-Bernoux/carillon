# Une mutation qui survit ne veut pas dire « le test est faible »

> Tiré de l'US7 (grille rythmique). La leçon la plus utile du lot, parce qu'elle corrige la façon même
> de lire un test de mutation.

## Le fait

L'échéance d'une source est **recalculée depuis la grille** à chaque émission :

```ts
emitter.nextAt = gridTimeAfter(emitter.nextAt, division, world.bpm)
```

Je l'ai mutée en accumulation, la forme naïve que le recalcul est censé remplacer :

```ts
emitter.nextAt += divisionSeconds(division, world.bpm)
```

**19 tests sur 19 sont restés verts** — y compris celui qui s'appelle « deux sources de même division
émettent exactement en phase, sur 200 mesures », écrit précisément pour cette propriété.

## Le réflexe qui aurait été faux

Le réflexe est de conclure « mon test est creux, il faut le durcir ». C'était faux ici, et le durcir
n'aurait rien donné : à partir d'une échéance **déjà alignée sur la grille**, ajouter le pas retombe
exactement sur les mêmes instants. Les deux versions sont *mathématiquement identiques* sur toute la
trajectoire que ce test parcourt. Aucun renforcement de ce test-là ne pouvait les distinguer.

## La bonne question

> **Sous quelle condition les deux versions diffèrent-elles ?**

Pas « qu'est-ce que mon test ne couvre pas », mais « où ces deux codes cessent-ils d'être le même
code ». Ici, la réponse est nette : au **changement de tempo**. Le pas change, donc l'accumulation
continue sur l'**ancienne** grille pour toujours, tandis que le recalcul se raccroche à la nouvelle.

L'assertion manquante ne portait donc pas sur la phase — elle portait sur le tempo. Une fois écrite,
elle tue la mutation immédiatement.

Corollaire : une mutation survivante est une **question sur le domaine**, pas un verdict sur la suite de
tests. Parfois la réponse est « elles ne diffèrent jamais » — et alors la mutation était équivalente, le
code a une redondance, et c'est le *code* qu'il faut simplifier, pas le test qu'il faut gonfler.

## Deux autres pièges du même run, plus classiques

**Une chaîne de mesure doit être la chaîne réelle.** Pour vérifier l'écrêtage audio, la salve est rendue
hors ligne — mais avec les *mêmes* voix, les *mêmes* gains nommés, la *même* réverbe et le *même*
limiteur. Le limiteur en particulier : l'omettre aurait mesuré un signal que personne n'entend. C'est ce
qui a permis de trouver que les quatre timbres écrêtaient (crête 1,38 à 1,45) parce que le compresseur,
présent depuis l'US1, n'avait jamais été réglé.

**Un plafond se dérive du bon domaine.** La vitesse maximale rendue par un trampoline a d'abord été
dérivée de la hauteur de **scène**, comme si tout impact avait lieu au ras du bas. Mesuré sur une barre
à mi-hauteur : la bille culminait à y = −236, hors champ. La grandeur qui compte est la hauteur
**au-dessus du point d'impact**. Et le test qui l'a attrapé comparait lui aussi à la mauvaise borne —
donc une assertion plus faible que son nom.

## Le même réflexe, réponse inverse (US16)

La méthode ne conclut pas toujours « le code a une redondance ». Sur la roue de sélection, retirer le
centrage `- step / 2` de `sectorStartAngle` — donc faire commencer le premier secteur au **haut** au lieu
de l'y centrer — laissait vert le test nommé « centre le premier secteur sur le haut ».

Condition de divergence, cherchée avant de toucher au test : elle **existe**, et elle est étroite. Le
point posé pile sur la verticale tombe dans le premier secteur dans les deux versions — dans un cas parce
qu'il en est le milieu, dans l'autre parce qu'il en est la frontière de début. Les deux codes ne cessent
d'être le même code qu'**à côté** de la verticale : d'un degré à gauche, la version non centrée bascule
dans le dernier secteur.

Cette fois, c'est donc bien le test qui était faux — il visait l'unique point où les deux versions
coïncident. Et la propriété produit est celle du voisinage, pas du point : si le haut est une frontière,
« je vise en haut » est un tirage au sort entre deux options, ce qu'une roue doit précisément éviter. Le
test asserte maintenant un voisinage angulaire, et la mutation meurt.

À retenir : la question « sous quelle condition ces deux codes diffèrent-ils » est la bonne dans les deux
cas ; ce qui change est la réponse. Et un test qui vise un point **singulier** — une frontière, un zéro,
un extremum — a de bonnes chances d'être exactement le point où la mutation ne se voit pas.

## Ce que ça change dans la méthode

- Devant une mutation survivante, chercher **la condition de divergence** avant de toucher au test.
- Quand la condition existe, l'assertion à écrire porte sur *elle*, souvent dans une autre dimension que
  celle qu'on croyait tester.
- Quand elle n'existe pas, c'est le code qui porte une redondance.
- Une mesure n'a de valeur que si son chemin est **identique** au chemin réel.
- Un seuil ou un plafond se dérive d'une grandeur du domaine, nommée dans le commentaire, jamais d'une
  intuition — et il faut vérifier que le **test** utilise la même grandeur que le code.

## Voir aussi

- `tester-la-propriete-pas-son-proxy.md` — l'étiquette d'une assertion n'est pas son contrat
- `effet-present-dans-letat-invisible-a-lecran.md` — une métrique peut récompenser le défaut
- `un-recadrage-deplace-le-repere-dinteraction.md` — le défaut de l'US16 que douze assertions vertes ne
  voyaient pas, et que la capture a montré
