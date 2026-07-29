# US4 — La scène qui tourne

> Statut : **livrée** · Branche `feat/us4-la-scene-qui-tourne`

## Intent

La scène **meurt**. Les billes tombent, sortent par le bas, et il ne reste qu'un décor immobile
jusqu'à ce qu'on retape. Toutes les vérifications des trois premières US l'ont montré sans que ce
soit jamais formulé : le scénario nominal doit relâcher cinq billes à la main pour produire trois
secondes de musique.

Un **émetteur** — une source qui lâche une bille à intervalle régulier — change la nature du produit :
la scène joue toute seule, en boucle, et on l'accorde en direct pendant qu'elle tourne. C'est ce que
`STRATEGY.md` appelle « la scène qui finit par tourner et devenir un motif ».

## Périmètre

**Dedans** : les émetteurs. Leur création par un geste, leur déplacement et leur suppression avec les
mêmes gestes que les barres, leur présence dans la scène d'accueil, leur intégration à l'historique
d'annulation, et un plafond de billes qui protège le budget de perf.

**Dehors** :
- **Partage par URL** : reporté à l'US5. C'était dans le même lot au départ ; mais un lien qui
  ouvrirait une scène inerte n'a pas d'intérêt, et l'encodage a besoin des émetteurs dans le modèle.
  L'ordre est donc : rendre la scène vivante, puis la rendre partageable.
- Galerie de presets : « Scène surprise » plus le partage par URL couvriront le besoin.
- Réglage fin de la période par émetteur : on commence avec une période par défaut. On généralisera
  au deuxième besoin concret, pas avant.

## Décisions de conception

**Le geste de création : appui long dans le vide** (500 ms). C'est le seul idiome qui n'introduit pas
de mode et ne vole pas un geste existant : le tap lâche une bille, le glisser dessine, l'appui long
pose une source. Il est aussi standard au doigt, où il n'y a pas de clic droit.

**Un émetteur s'attrape et se jette comme une barre.** L'US3 a établi qu'on édite sans mode ; une
entité qu'on ne pourrait pas déplacer ni supprimer réintroduirait exactement la frustration qu'elle a
corrigée. Conséquence : la préhension doit devenir **générique** — elle retourne « ce qu'on attrape »,
barre ou émetteur, au lieu de ne connaître que les barres.

**Émission déterministe.** L'émetteur porte le temps de simulation de son prochain lâcher, jamais un
`Date.now()` ni un compteur de frames. Deux exécutions à graine égale doivent produire la même
musique — c'est l'invariant du noyau depuis l'US1, et c'est ce qui rendra l'US5 (partage) possible.

**Plafond de billes.** Une source qui tourne sans fin remplit la scène ; au-delà d'un plafond, la
plus ancienne bille disparaît. Sans ça, laisser l'onglet ouvert dégrade la perf sans que rien ne le
signale.

## Critères d'acceptation

| # | Critère | Preuve attendue |
|---|---|---|
| D1 | Un émetteur lâche une bille exactement tous les `period` secondes de simulation, ni plus ni moins | test unitaire, sur 30 s simulées |
| D2 | L'émission est **déterministe** : deux mondes identiques produisent la même trace d'impacts sur 30 s | test unitaire |
| D3 | Le plafond de billes est respecté même après 5 minutes simulées, et c'est la plus ancienne qui part | test unitaire |
| D4 | La préhension générique distingue barre (corps / extrémité) et émetteur, et l'émetteur gagne quand on le vise | test unitaire |
| D5 | Un émetteur se déplace, se supprime au bord, et l'annulation le restaure — position et période | test unitaire + scénario navigateur |
| D6 | L'appui long crée un émetteur ; un tap au même endroit lâche toujours une bille | scénario navigateur, souris **et** doigt |
| D7 | La scène d'accueil contient au moins un émetteur, et joue sans intervention : impacts > 0 après 3 s sans aucun geste | scénario navigateur |
| D8 | Aucune régression : les 66 assertions existantes restent vertes, `barsUnderHud` et `droppedSteps` à 0 | sortie du harnais |
| D9 | Budget de perf tenu avec le plafond de billes atteint | scénario `stress`, fps ≥ 60 |
| D10 | `pnpm check` vert, captures **regardées** et **postérieures au code**, archivées dans `docs/proofs/us4/` | sorties de commande + horodatages |

### Résultats

| # | Résultat |
|---|---|
| D1 | ✅ 4 périodes testées sur 30 s simulées. La première attente était fausse : additionner 3 600 pas de 1/120 donne 29,999999999999996, donc une échéance tombant pile sur 30 n'est pas franchie. L'attente se calcule depuis le temps **réellement** simulé. |
| D2 | ✅ deux mondes identiques donnent la même suite d'instants d'émission sur 30 s |
| D3 | ✅ plafond de 320 billes tenu après 5 minutes simulées avec 3 sources ; les survivantes sont bien les plus récentes (vérifié par identifiants) |
| D4 | ✅ 6 tests de préhension générique, dont « une source lointaine ne bat pas le corps sous le doigt » — le défaut inter-catégories jumeau de celui corrigé en US3 |
| D5 | ✅ navigateur : déplacement à période conservée, suppression au bord, annulation qui restaure la position |
| D6 | ✅ appui long pose une source ; un tap court lâche toujours une bille. 5 tests unitaires sur le geste (seuil, tremblement, glisser franc, appui long sur une barre) |
| D7 | ✅ **19 impacts après 3,2 s sans le moindre geste**, 2 sources dans la scène d'accueil |
| D8 | ✅ 7 scénarios / 66 assertions vertes |
| D9 | ✅ fps ≥ 60 avec le plafond de billes |
| D10 | ✅ 141 tests ; preuves postérieures au code (horodatages comparés) |

### Ce que l'US4 a appris

**Une scène vivante rend creuses les assertions par comparaison d'images.** Le risque était écrit au
plan ; le test de mutation l'a confirmé : avec les sources qui émettent, deux captures diffèrent de
toute façon, donc l'assertion « les barres sont réaccordées » passait au vert **alors que le
réaccordage était neutralisé**. Corrigé en assertant la propriété elle-même — les hauteurs exposées
par l'API de debug — au lieu du proxy pixel : 8 barres sur 15 changent de hauteur, et 0 sur 15 quand
on neutralise. Deux assertions par pixels ont été remplacées, et le helper de capture devenu inutile
supprimé.

**Un test de mutation ne se défait pas avec `git checkout --`.** Le fichier portait tout le travail
non commité de l'US4 : la restauration l'a ramené à `HEAD`, effaçant le câblage complet de `main.ts`.
Les autres fichiers étaient intacts, le socle a été réappliqué, mais la règle est désormais explicite —
copier le fichier avant de le muter, restaurer depuis la copie.

## Suites de la revue

Verdict initial : **non livrable**. Trois bloquants, tous réels, tous reproduits avant correction.

| Point | Défaut réel | Correctif | Preuve |
|---|---|---|---|
| **B1** — annuler crachait une rafale | l'instantané recopiait `nextAt`, donc annuler restaurait une échéance **dans le passé** : la source rattrapait un retard fictif en lâchant 4 billes dans une seule frame, et la phase du motif était perdue. Le clone était incohérent avec sa propre doctrine — `lastHitAt` était déjà exclu pour cette raison exacte | `nextAt` sort de l'instantané ; `undo` réarme depuis le temps courant | test de mutation : **écart de 8 billes** sur la frame d'annulation sans le correctif, 0 avec |
| **B2** — D9 coché sans preuve | le scénario de charge faisait `reset()`, donc **zéro source** et 220 billes sur un plafond de 320 : la charge propre à l'US4 (émission, anneaux, traînées au plafond) n'était pas dans le budget mesuré, et « fps ≥ 60 au plafond » était indéfendable | 6 sources à cadence minimale, cible de billes lue depuis `maxBalls`, et deux assertions nouvelles | **315 billes sur 320**, 6 sources, 120 fps, 0 pas jeté |
| **B3** — assertion creuse réintroduite | la comparaison de géométrie incluait les `id`, et `clearAll` ne remet pas `nextBarId` à zéro : deux scènes portaient toujours des identifiants différents, donc l'assertion était vraie quoi qu'il arrive. Exactement le défaut que ce commit prétendait corriger, réintroduit dans le même commit | comparaison sur la géométrie seule | test de mutation : rougit avec la graine figée |
| **I1** — D2 ne prouvait rien | le test de déterminisme comparait deux mondes **sans barres** et **sans appeler `stepWorld`** : deux fois le même calcul arithmétique pur, vrai par construction | il compare désormais la **trace d'impacts** (barre, instant, vitesse) sur 30 s avec barres et sources | ✅ |
| **I2** — source posée sous le HUD | l'appui long ne bornait rien, et l'overlay est en `pointer-events: none` : un appui long sur le titre posait une source derrière lui. Les deux compteurs de garde n'itéraient que `world.bars`, donc l'assertion `barsUnderHud === 0` était structurellement aveugle à la nouvelle entité | position bornée à la création comme au déplacement ; les compteurs voient les sources | assertions vertes dans `alive`, `mobile`, `resize` |
| **I3** — aperçu mensonger | après un appui long, continuer à glisser affichait un aperçu de barre avec son étiquette de note, alors que le relâchement ne créait rien | le mouvement ne produit plus d'aperçu une fois l'appui long déclenché | ✅ |
| **I4** — l'US4 n'était couverte par aucune assertion | 66 assertions avant, 66 après : deux remplacées, aucune ajoutée. D5, D6 et D7 étaient annoncés « scénario navigateur » sans scénario — la vérification avait eu lieu à la main, donc n'était pas rejouable | nouveau scénario `alive` : source présente, impacts sans aucun geste, rien sous le HUD, pas de rafale à l'annulation | 8 scénarios, **72 assertions** |
| Mineurs | rayon de préhension d'une source non adapté au doigt (la plus petite cible était la seule à ne pas grossir) ; `SceneSink.emitter` optionnel, donc une scène morte par simple oubli ; formule de score dupliquée ; seuil de réaccordage à une barre de marge ; quatre exports sans consommateur | tous traités | ✅ |

**Ce que cette revue apprend** : une assertion creuse peut être réintroduite **dans le commit même qui
en corrige deux autres**. Le seul garde-fou qui l'attrape est le test de mutation, systématiquement,
sur chaque assertion de type « ça a changé » — pas la relecture.

## Risques

- **L'appui long entre en conflit avec le glisser** : un doigt qui tremble pendant 500 ms ne doit pas
  annuler la création, et un glisser franc ne doit pas la déclencher. Mitigation : la création n'a
  lieu que si le pointeur n'a pas bougé de plus que le seuil de tap, et le compte à rebours est
  annulé au premier vrai mouvement.
- **La généralisation de la préhension casse l'US3.** Mitigation : les tests de `hit-test` et de la
  machine à gestes existants doivent rester verts sans être affaiblis ; c'est le filet.
- **Une scène vivante rend les captures non déterministes** : deux exécutions du harnais ne donneront
  plus la même image. Conséquence directe sur les assertions par comparaison de pixels — il faudra
  vérifier qu'aucune ne repose sur l'immobilité de la scène.
- **L'audio saturé** par une source qui tourne : le budget de polyphonie de l'US1 est là pour ça, mais
  il n'a jamais été exercé sur une durée longue.

## Orchestration

| Agent | Périmètre exclusif | Modèle / effort |
|---|---|---|
| `emit` | `src/core/emitter.ts` + tests (émission déterministe, plafond) | Sonnet / medium |
| moi | `src/core/types.ts`, `hit-test.ts`, `src/ui/input.ts`, `src/main.ts`, rendu | Opus / high — conception d'interaction et frontières de modules |
| `harness` | `scripts/shoot.mjs` | Sonnet / medium, après stabilisation de l'API de debug |

Review par un agent qui n'a écrit aucune de ces lignes. Les trois revues précédentes ont trouvé
respectivement 3, 2 et 3 bloquants réels : c'est l'étape la plus rentable du cycle.
