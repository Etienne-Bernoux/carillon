# STRATEGY.md — Carillon

## Le produit

**Carillon** — un bac à sable où la **physique fait la musique**.

On dessine des barres sur une toile, on lâche des billes. La gravité fait le reste : chaque
collision joue une note et allume une onde de lumière. Une scène qui semblait aléatoire finit par
tourner en boucle et devenir un motif. On déplace une barre d'un degré, la mélodie change.

**Pourquoi c'est fun** : la boucle est *dessiner → écouter → ajuster*, avec moins d'une seconde
entre le geste et la récompense. On ne compose pas, on **découvre** — c'est un instrument qu'on
accorde par la géométrie. Le retour est double, visuel **et** sonore, donc chaque essai est lisible
même sans oreille musicale.

**Pourquoi c'est visuel** : tout est à l'écran en permanence — trajectoires, traînées, impacts,
ondes. Aucun état caché, aucun menu à explorer pour comprendre.

## Non-duplication

Le voisinage (`~/Perso/projets/`) couvre déjà : simulation émergente serveur (`neural-garden`,
Rust), arcade (`space-breakout`), pédagogie enfants (`loto-histoire`, `apprendre-heure`,
`math-learner`), idle game (`croisade`). **Rien n'utilise l'audio comme matière première.**
Carillon prend cet angle : la Web Audio API est le cœur du produit, pas un habillage.

## Ce que ça n'est pas (non-buts)

- Pas de backend, pas de compte, pas de persistance serveur. Tout est local + URL.
- Pas un DAW : pas de piste, pas de partition, pas de MIDI. La géométrie **est** la partition.
- Pas d'export audio/vidéo (le partage se fait par URL de scène).
- Pas de dépendance runtime : canvas 2D + Web Audio natifs.

## Critères de succès

1. **10 secondes** : un nouvel arrivant lâche une bille et entend une note sans lire de mode d'emploi.
2. **On veut recommencer** : on modifie une barre juste pour entendre ce que ça change.
3. **60 fps** avec 200 billes actives sur un laptop, sans crachotement audio.
4. **Tactile** : jouable au doigt sur un viewport 375px, zéro débordement horizontal.

## Backlog

Une US = une boucle compound complète (plan → work → verify → review → compound → commit).
Le plan de chaque US est écrit **au moment de l'attaquer**, pas maintenant.

| US | Titre | Intent |
|----|-------|--------|
| **US1** ✅ | Le premier rebond | *Livrée.* Dessiner des barres, lâcher des billes, une note par impact. Le noyau : physique déterministe + audio + rendu. |
| **US2** ✅ | Ça sonne juste | *Livrée.* Hauteur relative à la largeur de la scène (un téléphone ne jouait que 2 hauteurs, il en joue 5+), sélecteur de gamme qui **réaccorde** l'instrument, longueurs stratifiées : 11 hauteurs sur desktop, et 71 impacts par scène au lieu de 16. |
| **US3** | Le geste agréable | Éditer sans frustration : sélection, déplacement, suppression, undo. Types de barres (mur / trampoline / disparaissante). Tactile + responsive. |
| **US4** ✅ | La scène qui tourne | *Livrée.* Sources périodiques posées à l'appui long, déplaçables et jetables comme des barres, émission déterministe, plafond de billes. La scène d'accueil joue **19 impacts en 3,2 s sans aucun geste**. |
| **US5** ✅ | Le lien qu'on envoie | *Livrée.* La scène **est** l'URL — 161 caractères pour la scène d'accueil, aucun serveur. Le format encode milieu, longueur et angle : un lien ouvert sur un autre écran remplit la page **et** rejoue les mêmes notes. |
| **US6** | Le vernis | Glow, particules d'impact, `prefers-reduced-motion`, densité du HUD sur petit écran (il mange 44 % d'un 320×568). |

**Ordre non négociable** : US1 avant tout le reste. Si le noyau physique+audio n'est pas
satisfaisant, aucune quantité de vernis ne sauve le produit — et on préférera revoir US1 plutôt
qu'empiler US2.

**Ce que les deux premières US ont changé au backlog** : la limite qui a déclenché l'US2 (hauteur en
pixels absolus) n'était pas dans le plan initial — elle est sortie d'une **capture d'écran de
téléphone**. C'est le mécanisme attendu : chaque US révèle le vrai contenu de la suivante, et le
backlog ci-dessus reste une intention, pas un engagement.

## Décisions techniques (et pourquoi)

| Décision | Raison | Alternative écartée |
|---|---|---|
| Vite + TypeScript, zéro framework UI | l'UI est un panneau de contrôles ; un framework coûterait plus qu'il n'apporte | Svelte (déjà utilisé sur `croisade`, mais inutile ici) |
| Canvas 2D | 200 billes + traînées passent largement ; le code reste lisible | WebGL — à garder si le budget perf casse en US5 |
| Pas step-fixe → **oui**, pas fixe à 1/120 s avec accumulateur | la physique doit être reproductible pour tester et pour partager une scène par URL | intégration au `deltaTime` brut : non déterministe |
| Collisions cercle/segment analytiques | ~50 segments × 200 billes tient sans broadphase ; simple et exact | moteur physique tiers (matter.js) : dépendance runtime, overkill |
| Seed explicite, RNG maison | déterminisme = testabilité + reproductibilité d'une scène partagée | `Math.random()` |
