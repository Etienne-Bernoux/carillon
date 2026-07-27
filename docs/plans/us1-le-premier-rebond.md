# US1 — Le premier rebond

> Statut : livrée · Branche `feat/us1-premier-rebond`

## Intent

Le noyau du produit : on dessine une barre, on lâche une bille, elle rebondit et **ça joue une
note**. Si ce moment n'est pas satisfaisant, rien d'autre ne compte. On vise le « ah, ça marche »
en une seule séance.

## Périmètre

**Dedans** : physique déterministe (gravité, collision cercle/segment sans tunneling), rendu canvas
(barres, billes, traînées, ondes d'impact), audio (une voix synthétisée par impact, gamme
pentatonique), interaction souris (glisser = dessiner une barre, clic = lâcher une bille).

**Dehors** : choix de gamme dans l'UI (US2), édition/suppression (US3), presets et URL (US4),
particules et post-traitement (US5), tactile (US3 — mais on ne casse pas la piste : `pointerdown`
plutôt que `mousedown`).

## Architecture — contrats de modules

Frontière nette entre le **noyau pur** (testable en Vitest, zéro DOM, déterministe) et l'**adaptateur
navigateur**. C'est ce qui rend la vérification bon marché pour toutes les US suivantes.

```
src/core/types.ts     types partagés (écrit en premier, lu par tous, modifié par personne d'autre)
src/core/vec.ts       arithmétique 2D pure
src/core/rng.ts       mulberry32 seedé
src/core/physics.ts   stepWorld() → ImpactEvent[]   ← le morceau difficile
src/core/music.ts     géométrie → hauteur de note ; vélocité d'impact → gain
src/audio/budget.ts   politique de polyphonie (pure, testable)
src/audio/engine.ts   Web Audio (mince, non testé unitairement — vérifié à l'oreille/au scope)
src/ui/renderer.ts    dessin du monde
src/ui/input.ts       pointeur → intentions
src/main.ts           boucle RAF, câblage, API de debug window.__carillon
```

### `physics.stepWorld(world, dt): ImpactEvent[]`

Pas **fixe** (`DT = 1/120`) avec accumulateur côté boucle de rendu. Aucun appel à `Date.now()` ni
`Math.random()` dans le noyau.

Algorithme, par bille et par pas :

1. Appliquer la gravité à la vitesse (Euler semi-implicite : vitesse d'abord, puis position).
2. Chercher le **premier** impact sur `[0, dt]` via `sweepCircleSegment` sur toutes les barres,
   parcourues dans l'ordre stable des `id` (déterminisme).
3. Avancer jusqu'à `t`, réfléchir la vitesse (`v' = v − (1+e)(v·n)n`, puis friction tangentielle),
   décrémenter le temps restant, recommencer — **max 4 impacts par pas** (garde-fou anti-boucle).
4. Sinon avancer du temps restant.
5. Sortie de scène (`pos.y > bounds.h + marge`) → `alive = false`.

`sweepCircleSegment(p0, v, r, a, b)` = intersection rayon/capsule (segment gonflé de `r`) :
teste les deux extrémités (cercles) **et** le flanc, retient le plus petit `t ≥ 0`. C'est ce qui
interdit le tunneling par construction, plutôt que de le rendre improbable en réduisant le pas.

### `music`

Hauteur dérivée de la **géométrie** : une barre courte sonne aigu, une longue sonne grave —
métaphore physique du carillon, apprise sans explication. `noteForBar(bar, tuning)` mappe la
longueur sur un degré de gamme, sur 3 octaves. Vélocité = vitesse normale à l'impact, courbée
(`sqrt`) et bornée, pour que les micro-rebonds ne saturent pas.

## Critères d'acceptation

| # | Critère | Preuve attendue | Résultat |
|---|---|---|---|
| A1 | Une bille lâchée sur une barre horizontale rebondit à `e²·h` (±5 %) | test unitaire | ✅ `physics.test.ts` « A1 — hauteur de rebond » |
| A2 | À 5000 px/s, aucune bille ne traverse une barre de 4 px | test unitaire (balayage d'angles/positions) | ✅ 220 tirs (20 vitesses × 11 angles), aucun franchissement |
| A3 | Angle d'incidence = angle de réflexion sur barre inclinée | test unitaire | ✅ chute verticale sur pente 45° → sortie horizontale (±12 px/s) |
| A4 | Collision sur l'**extrémité** d'une barre traitée (pas de trou aux bouts) | test unitaire | ✅ + un test de non-régression sur la bille en recouvrement qui s'éloigne |
| A5 | Deux exécutions à seed égal produisent une trace d'impacts identique | test unitaire | ✅ 10 barres, 5 billes, 600 pas, traces strictement égales |
| A6 | Glisser à la souris crée une barre ; cliquer lâche une bille | screenshot `docs/proofs/us1/` | ✅ scénario `sandbox` : +3 barres au glisser, 5 billes au clic — `01`, `02` |
| A7 | Chaque impact déclenche une note audible et une onde visible | screenshot (onde) + inspection du graphe audio | ✅ ondes visibles sur `02`/`03` ; 17 impacts en 1,8 s ; graphe audio relu |
| A8 | Boucle stable à 60 fps avec 200 billes | mesure loggée depuis le harnais | ✅ **120 fps** avec **214 billes vivantes et l'audio actif**, `droppedSteps = 0`, relevé unique ; coût physique 1,62 ms sur 16,7 ms |
| A9 | `pnpm check` vert | sortie de commande | ✅ typecheck strict 0 erreur + 59 tests |

Répartition des tests, par module — un total agrégé ne dit rien de la couverture :
`physics` 15 · `music` 31 · `scene` 5 · `budget` 8. Côté navigateur : 5 scénarios, 24 assertions.

### Où sont les preuves

`pnpm shoot` écrit l'état **courant** dans `docs/proofs/<scénario>/` — écrasé à chaque exécution.
Le jeu de captures **accepté** pour une US est archivé dans `docs/proofs/us<N>/`, qui ne bouge plus
après la clôture. Le harnais reste ainsi ignorant du découpage en US.

## Suites de la revue

La revue a été faite par un agent qui n'avait pas écrit le code, avec pour consigne de chercher les
défauts et de classer par gravité. Chaque point a été **vérifié contre le code** avant d'être traité —
un rapport d'agent n'est pas une source de vérité.

**Traités** :

| Point | Défaut réel | Correctif |
|---|---|---|
| A8 non prouvé | les fps étaient mesurés 2 s après le largage, quand la plupart des billes étaient déjà sorties, et **sans audio déverrouillé** : le convolveur de réverbe n'avait jamais tourné sous charge | scénario `stress` refait : audio déverrouillé par un vrai clic, population maintenue ≥ 200, seuil remonté à 60 fps, relevé unique |
| Scène hors écran | le garde de bord testait le **centre** de la barre : jusqu'à 133 px de barre invisible, sur laquelle les billes rebondissaient — et dont la longueur décidait la note | géométrie bornée par les extrémités + `scene.test.ts` (5 tests, dont l'invariant « aucun couloir vertical ») |
| DoD mensongère | `pnpm check` ne lançait pas de linter alors que la DoD en promettait un | la DoD décrit désormais ce que la commande fait vraiment (§3) |
| Tunneling de flanc | une bille dont le centre est **dans** la bande traversait la barre : cas atteint en dessinant une barre sur une bille en vol, soit la boucle centrale du produit | garde symétrique de celui des extrémités + balayage de 300+ tirs sur barres courtes et inclinées |
| Budget de polyphonie | durée de voix figée à 1 s alors qu'une note aiguë dure 0,37 s : le débit plafonnait à 24 notes/s et une scène dense se taisait pour rien | la durée réelle est passée au budget |
| État redondant | `barsById` doublait `world.bars` ; sa branche d'échec était inatteignable aujourd'hui et aurait avalé des impacts en silence dès la suppression de barres (US3) | index supprimé, résolution directe |
| Redimensionnement | la scène générée restait hors champ après rotation ; chemin jamais exercé | reconstruite à graine identique, sauf si la scène appartient à l'utilisateur ; exercée par le harnais |
| Angles morts | ni les boutons, ni le redimensionnement, ni la géométrie du canvas n'étaient vérifiés ; une simulation au ralenti aurait affiché des fps parfaits | `droppedSteps` et `barsOutOfBounds` exposés et assertés à 0 ; scénarios `controls` et redimensionnement |
| Divers | `Math.random()` dans l'impulsion de réverbe (contraire au déterminisme posé en stratégie), point d'impact décalé de 8 px sur les collisions de bout, épaisseur de barre non modélisée, ondes avançant en temps mural | corrigés ; `BAR_THICKNESS` devient la source de vérité unique, importée par le rendu |

**Écarté, avec argument** : la revue demande de réduire le catalogue de 5 gammes à une seule au nom
du YAGNI, puisqu'une seule est atteignable et que 20 des 49 tests portent sur les 4 autres. Le
YAGNI dit de ne pas abstraire **sur une seule instance** — or `TUNINGS` est déjà un catalogue
piloté par la donnée, pas une abstraction spéculative, et l'US2 (« Ça sonne juste ») est
précisément le branchement de ce catalogue sur l'UI. Supprimer puis réécrire ces 30 lignes de
données serait du churn. Ce qui est **juste** dans la remarque, en revanche, c'est que « 49 tests »
ne dit rien de la couverture : on compte désormais les tests par module, pas en total.

## Limite connue, léguée à l'US2

`midiForLength` mappe des **longueurs en pixels absolus** sur les degrés de la gamme (40 → 700 px
pour 3 octaves, soit ~44 px par degré). Sur un viewport de 375 px, toutes les barres de la scène
d'accueil tiennent dans une plage de ~80 à 165 px : elles ne couvrent que deux degrés, et la preuve
`06-resize.png` le montre — deux couleurs seulement, donc deux hauteurs.

Ce n'est pas un bug de l'US1 (A6 et A7 sont tenus, une note sonne bien à chaque rebond), c'est une
conséquence du mapping absolu. Le correctif appartient à l'US2 (« Ça sonne juste ») : la hauteur doit
dériver de la longueur **relative à la largeur de la scène**, pas d'une constante en pixels.

## Risques

- **Bille collée / jitter** sur une barre presque horizontale (rebonds infinis de plus en plus
  petits). Mitigation : seuil de vitesse normale sous lequel on annule la composante normale
  (repos), et pas d'événement audio sous un seuil de vélocité.
- **Crachotement audio** si 200 impacts tombent sur la même frame. Mitigation : `budget.ts` borne
  la polyphonie et ignore les impacts trop rapprochés sur la même barre (fenêtre de ~25 ms).
- **Audio bloqué** avant geste utilisateur : l'`AudioContext` n'est créé qu'au premier `pointerdown`.

## Orchestration

| Agent | Périmètre (fichiers exclusifs) | Modèle / effort |
|---|---|---|
| `phys` | `src/core/vec.ts`, `rng.ts`, `physics.ts` + tests | Sonnet / medium |
| `music` | `src/core/music.ts`, `src/audio/budget.ts`, `src/audio/engine.ts` + tests | Sonnet / medium |
| `shoot` | `scripts/shoot.mjs` | Sonnet / medium |
| moi | `src/core/types.ts` (avant le fan-out), `src/ui/**`, `src/main.ts`, `index.html` | Opus / high |

`types.ts` est écrit **avant** le fan-out et n'est modifié par personne : c'est le contrat.
La review est faite par un agent qui n'a pas écrit le code.
