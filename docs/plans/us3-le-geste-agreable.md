# US3 — Le geste agréable

> Statut : **livrée** · Branche `feat/us3-le-geste-agreable`

## Intent

Aujourd'hui une barre est **définitive**. Mal placée, trop longue, mauvaise note : le seul recours est
« Tout effacer » et tout recommencer. C'est la frustration numéro un du produit en l'état, et elle
casse le critère de succès n°2 de `STRATEGY.md` (« on modifie une barre juste pour entendre ce que ça
change ») — on ne *peut pas* modifier une barre.

Cette US rend l'instrument **accordable à la main**. C'est plus qu'une commodité d'édition : faire
glisser l'extrémité d'une barre en entendant la note monter, c'est le geste qui donne son sens au
produit.

## Périmètre

**Dedans** :
- **Attraper** une barre par son corps et la déplacer.
- **Attraper une extrémité** et l'étirer : la longueur change, donc la note change — le nom de la
  note suit pendant le geste.
- **Taper** une barre pour l'entendre, sans rien modifier.
- **Supprimer** une barre.
- **Annuler** le dernier geste.
- Tactile réel (événements `touch`, pas seulement une émulation de viewport).

**Dehors** :
- **Types de barres** (mur / trampoline / disparaissante) : reportés. Le YAGNI du dépôt dit de ne pas
  généraliser sur une seule instance, et nous n'avons qu'un type. Ce sera pertinent quand un
  deuxième type sera réellement demandé par le jeu, pas avant.
- Sélection multiple, copier-coller, calques : pas de besoin constaté.
- Émetteurs et partage d'URL : US4.

## Décisions de conception (les gestes)

Le pari est de **ne pas introduire de mode**. Aucun bouton « gomme » ou « sélection » : c'est ce qui
tue les outils de dessin tactiles. Le geste se désambiguïse par **où il commence**.

| Geste | Effet | Pourquoi ce choix |
|---|---|---|
| glisser depuis le vide | dessine une barre | inchangé, c'est l'acquis de l'US1 |
| glisser depuis le **corps** d'une barre | la déplace | direct, c'est le geste attendu |
| glisser depuis une **extrémité** (rayon de préhension) | l'étire, la note suit en direct | le geste qui *accorde* — cœur du produit |
| taper une barre | joue sa note | non destructif, et ça apprend la correspondance couleur ↔ hauteur |
| taper le vide | lâche une bille | inchangé |
| lâcher une barre **hors de la zone de jeu** | la supprime | pas de mode, pas de bouton, réversible par annulation |
| bouton **Annuler** (et `Cmd/Ctrl+Z`) | annule le dernier geste destructif ou modifiant | filet de sécurité qui rend la suppression sans risque |

Conséquence assumée : le rayon de préhension d'une extrémité doit être généreux au doigt (~22 px) et
plus petit à la souris. Une barre très courte n'a alors quasiment plus de « corps » — dans ce cas la
préhension par extrémité gagne, parce qu'accorder est plus utile que déplacer sur une barre courte.

## Critères d'acceptation

| # | Critère | Preuve attendue | Résultat |
|---|---|---|---|
| C1 | `hitTestBars` retourne la barre la plus proche, et distingue corps / extrémité A / extrémité B | test unitaire avec les cas limites | ✅ 10 tests, dont barres superposées (déterminisme), barre plus courte que le rayon, barre dégénérée |
| C2 | Déplacer une barre **conserve sa longueur et sa note** | test unitaire | ✅ vérifié aussi dans le navigateur : longueur 300 → 300, note 76 → 76 |
| C3 | Étirer une extrémité recalcule la note, l'autre extrémité **ne bouge pas** | test unitaire | ✅ navigateur : longueur 300 → 100, note 76 → 88 (plus court = plus aigu), extrémité A intacte |
| C4 | Annuler restaure l'état exact sur 20 gestes enchaînés | test unitaire sur l'historique | ✅ 11 tests d'historique, dont l'isolation des copies |
| C5 | Historique borné, annuler sur pile vide sans casse | test unitaire | ✅ |
| C6 | À la souris : déplacer, étirer, supprimer par le bord, annuler | scénario navigateur + captures | ✅ vérifié bout en bout (suppression 1 → 0 barre, annulation 0 → 1 avec longueur et note restaurées) |
| C7 | Au **doigt** (`touch` réels, pas une émulation de viewport) | scénario navigateur `page.touchscreen` | ✅ déplacement exact au pixel avec note inchangée (67 → 67), étirement qui allonge de la distance parcourue (160 → 240 px) et fait descendre la note (67 → 57), extrémité non attrapée immobile |
| C8 | Aucune régression sur les assertions existantes | sortie du harnais | ✅ **7 scénarios, 66 assertions**, `barsUnderHud` et `barsOutOfBounds` à 0 partout |
| C9 | `pnpm check` vert, captures **regardées**, archivées dans `docs/proofs/us3/` | sorties de commande | ✅ 107 tests, build 21 ko (9 ko gzip) |

### Ce que la machine à gestes a appris

Le refactor a fait échouer trois assertions du harnais — et c'était la **bonne** nouvelle : deux clics
du scénario tombaient sur des barres de la scène d'accueil (donc jouaient leur note au lieu de lâcher
une bille) et un glisser démarrait sur une barre (donc la déplaçait). Le produit faisait exactement
ce que l'US3 décrit ; c'étaient les assertions qui datent de l'US1. Un harnais qui rougit sur un
changement de sémantique volontaire fait son travail.

Un vrai défaut en revanche : déplacer une barre pouvait l'envoyer **derrière le HUD** (le compteur
`barsUnderHud` de l'US2 l'a attrapé immédiatement). Correction : on borne le **déplacement**, pas les
extrémités — borner chaque extrémité indépendamment raccourcirait la barre contre un bord, donc
changerait sa note, ce qui viole C2. La barre butte, le pointeur continue, et c'est le **pointeur**
qui décide de la suppression : on peut donc encore jeter une barre par le bord.

## Suites de la revue

Verdict initial de la revue indépendante : **non livrable**. Trois bloquants, tous réels, tous
vérifiés contre le code avant correction.

| Point | Défaut réel | Correctif | Preuve |
|---|---|---|---|
| **B1** — les preuves ne prouvaient pas le code présent | les captures archivées étaient **antérieures** aux deux dernières éditions du code. Pire : un résidu de test de mutation (`void dx`) survivait à `pnpm check` **par construction**, puisque c'est exactement l'écriture qui fait taire `noUnusedLocals` | harnais relancé et preuves ré-archivées **après** la dernière édition | horodatages comparés : code 21:34, preuves 21:45 |
| **B2** — écouter une barre consommait une annulation | l'instantané était pris au `pointerdown`, avant de savoir si le geste modifie quoi que ce soit ; et `barEqual` comparait `lastHitAt`, qui bouge à chaque rebond, donc la déduplication ne se déclenchait **jamais** dans une scène vivante. Quarante taps évinçaient l'instantané d'une vraie suppression — le filet de sécurité de la suppression n'existait plus | instantané pris à la préhension mais **validé seulement à la première mutation réelle** ; `lastHitAt` retiré de la copie et de l'égalité (c'est de l'état de rendu, pas d'édition) | navigateur : 4 écoutes → `undoDepth` reste à 0 |
| **B3** — annuler un changement de gamme faisait mentir l'interface | `undo` ne restaurait que les barres : les hauteurs redevenaient pentatoniques mais le libellé restait sur « Dorien », et la barre suivante était accordée en dorien | l'historique porte désormais `{ bars, tuningId }` | navigateur : gamme **et** libellé restaurés ensemble |
| **I4** — on éditait un autre objet que celui visé | l'arbitrage « toute extrémité bat tout corps » était **global** : l'extrémité d'une autre barre à 23 px gagnait contre le corps de la barre visée à 0 px. Au doigt (rayon 24 px), appuyer au milieu d'une barre étirait la voisine | un seul barème de distance avec un biais borné (`ENDPOINT_BIAS`), et le corps évalué **même** si une extrémité est à portée | 3 tests, dont celui qui oppose corps et extrémité voisine |
| **I5** — les poignées restaient éteintes après un geste | `hoveredKey` n'était pas réinitialisé : le pointeur resté sur la barre recalculait la même clé, donc aucun survol n'était réémis | remise à zéro dans `finish()` | test dédié : 2 survols au lieu d'1 |
| **I6** — mon test du second pointeur ne pouvait pas échouer | avec `harness(null)` le premier `down` n'émet rien, donc supprimer la garde ne changeait aucun compte | réécrit avec une barre sous le pointeur, plus un test sur l'origine du tracé | — |
| **I7** — l'étirement pouvait annuler une barre | aucun plancher : amener une extrémité sur l'autre donnait une barre de longueur nulle, invisible, dont l'étiquette annonçait « — » pendant qu'une note était jouée | extrémité repoussée sur le cercle de rayon `MIN_BAR_LENGTH` | navigateur : longueur plancher à 24 px |
| **I8** — une barre plus large que la zone se figeait | quand la barre dépassait des deux côtés, le bornage imposait un déplacement dans un sens **quel que soit le geste**, puis la collait au bord | on ne borne pas l'axe où la barre est plus grande que la zone | — |
| **I9** — une interruption système pouvait supprimer | un `pointercancel` près d'un bord émettait un `release` traité comme une intention de jeter | le `release` porte un drapeau `cancelled` ; interrompu, il ne supprime rien et remet l'état d'interaction à zéro | 2 tests |

**Ce que cette revue apprend sur la vérification** : `pnpm check` a laissé passer un résidu de test de
mutation *parce que* ce résidu était écrit dans la forme qui satisfait le linter de variables inutilisées.
Un gate ne protège que de ce qu'il regarde — et l'horodatage des preuves est une donnée de vérification
à part entière.

## Risques

- **Ambiguïté du geste** : un glisser qui démarre à 3 px d'une barre doit-il la déplacer ou en créer
  une nouvelle ? Mitigation : un seul rayon de préhension explicite, testé, et la barre visée est
  mise en évidence **avant** que le geste ne commence à agir (retour visuel au survol).
- **Suppression accidentelle** en sortant de la zone : mitigée par l'annulation, et par le fait que la
  suppression ne se déclenche qu'au **relâchement** hors zone, pas au passage.
- **L'annulation et le réaccordage de gamme se marchent dessus** : changer de gamme réaccorde toutes
  les barres. Décision : le changement de gamme est un geste comme un autre, donc annulable.
- **Coût de l'historique** : des instantanés complets de scène à chaque geste. Avec quelques dizaines
  de barres et une pile bornée, c'est négligeable — et bien plus simple à rendre correct qu'un journal
  de commandes inversibles. On assume la simplicité.

## Orchestration

| Agent | Périmètre exclusif | Modèle / effort |
|---|---|---|
| `history` | `src/core/history.ts` + tests | Sonnet / medium |
| moi | `src/core/hit-test.ts`, `src/ui/input.ts`, `src/main.ts`, rendu du survol | Opus / high — c'est la conception d'interaction, le point le plus coûteux à rater |
| `harness` | `scripts/shoot.mjs` (scénarios `edit` et `touch`) | Sonnet / medium, après stabilisation de l'API de debug |

La review sera faite par un agent qui n'a écrit aucune de ces lignes.
