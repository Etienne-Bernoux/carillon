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

## Voir aussi

- [tester-la-propriete-pas-son-proxy.md](tester-la-propriete-pas-son-proxy.md) — l'étiquette d'une
  assertion n'est pas son contrat
- [harnais-de-capture-qui-ment-sur-la-perf.md](harnais-de-capture-qui-ment-sur-la-perf.md) — quand
  c'est le harnais lui-même qui fabrique le symptôme
