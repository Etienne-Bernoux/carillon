# Un effet peut être présent dans l'état et invisible à l'écran

> Tiré de l'US6 (étincelles d'impact). Deux pièges distincts, découverts dans cet ordre, et le second
> déguisé en le premier.

## Le symptôme

Les étincelles d'impact étaient terminées : 15 tests unitaires verts, 10 mutations sur 10 tuées,
`stats().particles` > 0 dans le navigateur, plafond respecté à pleine charge. Toutes les assertions
disaient « ça marche ».

Sur la capture, **on ne voyait rien**.

## Piège 1 — la capture au mauvais instant

La première sonde capturait à la frame exacte du premier impact. Or à l'âge 0, **toutes** les
étincelles sont encore au point de contact : elles n'ont pas eu un seul pas d'intégration. Une gerbe
photographiée à sa naissance est invisible **par construction**, quel que soit le rendu.

C'était donc un faux négatif de la preuve, pas un défaut du code — mais impossible à distinguer d'un
rendu cassé sans y regarder de plus près.

> **Règle** : un effet transitoire se photographie à un instant **choisi** de sa vie, et le scénario
> doit dire lequel et pourquoi. Ici : 70 ms après l'impact, sur une durée de vie de 450 ms.

## Piège 2 — le vrai défaut, une fois l'instant corrigé

À 70 ms, les étincelles apparaissaient enfin… sous forme de six points ternes de 2 px. Dans un décor
néon, ça ne se lit pas comme des étincelles mais comme des **pixels morts**. Trois causes cumulées :

1. Elles naissaient au centre du halo de la bille, déjà **blanc saturé** — un ajout additif sur du
   blanc ne se voit pas.
2. Le freinage (`DRAG = 3,4`) les empêchait de **quitter ce halo** avant de mourir : la portée totale
   valait ~20 px pour un halo de 30 px de rayon.
3. Un carré de 2 px ne porte aucune direction, alors que l'information d'une étincelle **est** sa
   direction.

Corrigé sur capture, pas au jugé : 9 étincelles par impact au lieu de 5, 150→520 px/s au lieu de
60→220, freinage 2,4, et surtout un rendu en **courtes traînées orientées par la vitesse** plutôt
qu'en points. Le commentaire du code garde les anciennes valeurs et la raison de leur abandon.

## Ce que ça change dans la méthode

- **« Présent dans l'état » et « visible à l'écran » sont deux propriétés distinctes.** La première
  s'asserte (et doit l'être : c'est elle qui est rejouable). La seconde ne se juge qu'en **regardant**.
  Aucune des deux ne remplace l'autre.
- **Un effet qu'on ne voit pas ne mérite pas sa place** : soit on le dimensionne pour qu'il se lise,
  soit on le retire. Le laisser tourner invisible, c'est du coût sans contrepartie — et un test vert
  qui protège du vide.
- **La sonde jetable doit devenir un scénario.** Ma seule preuve visuelle était une sonde locale
  supprimée juste après ; elle est désormais dans le harnais (`vernis` → `etincelles-gros-plan`), avec
  l'attente de 70 ms et son commentaire. Une preuve non rejouable n'est pas une preuve.
- Corollaire du même run : le passage du bouton « son » seul sur une deuxième rangée à 320 px n'a été
  vu **que** sur la capture. La métrique (29 % de HUD) était bonne avant comme après.

## Suite : ce que la review a ajouté à cette leçon

La leçon ci-dessus était **écrite** mais pas **gardée** : rien dans le harnais ne mesurait la
visibilité, et restaurer le réglage « invisible » repassait 15 tests sur 15 et 15 assertions sur 15.
Trois précisions en sont sorties.

### Une métrique peut *récompenser* le défaut

En cassant la spécificité du sélecteur d'icône, cinq boutons devenaient **parfaitement vides** — et la
métrique de densité du HUD **s'améliorait** (26 % au lieu de 29 %, pour un seuil à 30 %). L'assertion ne
se contentait pas de rater le défaut : elle le notait mieux que le code correct.

> **Règle** : pour toute métrique « moins, c'est mieux », se demander ce qui l'optimiserait *le plus* —
> et vérifier qu'un contrôle vide, une page blanche ou une scène gelée ne sont pas la meilleure note.

### La mesure de pixels ne marche que si le reste est figé

Deux tentatives, le même outil, deux résultats opposés :

| | Étincelles d'impact | Poignées de préhension |
|---|---|---|
| Scène | billes en vol, onde qui s'étend, halo de barre qui s'éteint sur 420 ms | une barre, zéro bille, zéro source |
| Mesure | couronne 26–80 px : **15 364 → 13 751** pixels clairs (elle *baisse*) | **0 → 845** pixels blancs |
| Verdict | inutilisable, noyée par le décor | exacte, la seule différence **est** la poignée |

> **Règle** : une mesure de pixels exige un **contrôle** — deux états qui ne diffèrent que par la chose
> mesurée. Sinon, chercher la propriété exacte ailleurs : pour les étincelles, c'était une grandeur
> **géométrique et pure** (quitter le halo de 28 px en 70 ms), assertable en test unitaire.

### Un seuil dérivé du rendu, pas estimé

« Quitter le halo » demandait un nombre. Estimé à 30 px, il faisait échouer le code correct (29,4 px
mesurés). Le vrai nombre est **28** : le sprite de lueur est dessiné sur `ball.radius * 7` px de côté,
donc 8 × 7 / 2, et son dégradé atteint alpha 0 exactement là. La marge de 1,4 px est mince et
**voulue** — le cœur est déterministe, donc la valeur est exacte et reproductible, et un seuil posé au
vrai bord du halo tombe au moindre affaiblissement du réglage.

## Voir aussi

- [tester-la-propriete-pas-son-proxy.md](tester-la-propriete-pas-son-proxy.md) — l'étiquette d'une
  assertion n'est pas son contrat
- [harnais-de-capture-qui-ment-sur-la-perf.md](harnais-de-capture-qui-ment-sur-la-perf.md) — quand
  c'est le harnais lui-même qui fabrique le symptôme
- [blowout-de-grille-sur-la-piste-auto.md](blowout-de-grille-sur-la-piste-auto.md) — le défaut produit
  trouvé dans la même review, invisible à onze largeurs de test
