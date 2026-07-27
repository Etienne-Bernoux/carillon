# US1 — Le premier rebond

> Statut : en cours · Branche `feat/us1-premier-rebond`

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

| # | Critère | Preuve attendue |
|---|---|---|
| A1 | Une bille lâchée sur une barre horizontale rebondit à `e²·h` (±5 %) | test unitaire |
| A2 | À 5000 px/s, aucune bille ne traverse une barre de 4 px | test unitaire (balayage d'angles/positions) |
| A3 | Angle d'incidence = angle de réflexion sur barre inclinée | test unitaire |
| A4 | Collision sur l'**extrémité** d'une barre traitée (pas de trou aux bouts) | test unitaire |
| A5 | Deux exécutions à seed égal produisent une trace d'impacts identique | test unitaire |
| A6 | Glisser à la souris crée une barre ; cliquer lâche une bille | screenshot `docs/proofs/us1/` |
| A7 | Chaque impact déclenche une note audible et une onde visible | screenshot (onde) + inspection du graphe audio |
| A8 | Boucle stable à 60 fps avec 200 billes | mesure loggée depuis le harnais |
| A9 | `pnpm check` vert | sortie de commande |

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
