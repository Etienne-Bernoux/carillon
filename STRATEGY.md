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
| **US3** ✅ | Le geste agréable | *Livrée.* Éditer sans frustration : survol, déplacement, accordage par les extrémités, suppression par le bord, undo. Les **types de barres** ont été reportés — ils font l'objet du plan du 2026-07-29. |
| **US4** ✅ | La scène qui tourne | *Livrée.* Sources périodiques posées à l'appui long, déplaçables et jetables comme des barres, émission déterministe, plafond de billes. La scène d'accueil joue **19 impacts en 3,2 s sans aucun geste**. |
| **US5** ✅ | Le lien qu'on envoie | *Livrée.* La scène **est** l'URL — 161 caractères pour la scène d'accueil, aucun serveur. Le format encode milieu, longueur et angle : un lien ouvert sur un autre écran remplit la page **et** rejoue les mêmes notes. |
| **US6** ✅ | Le vernis | *Livrée.* Le HUD passe de 44 % à **29 %** d'un 320×568, les poignées se révèlent au premier contact tactile, `prefers-reduced-motion` raccourcit sans figer, et les impacts font des étincelles. La review y a trouvé un défaut produit qu'aucune assertion ne voyait : la colonne du titre s'écrasait à 0 px entre 641 et 860 px de large. |
| **US7** | Le rythme | *Première tranche livrée.* Les sources s'expriment en **divisions de mesure** sur une grille commune, donc deux sources restent en phase indéfiniment ; une bille lâchée à la main **revient** sur le temps de la mesure. Restent la périodicité du motif et le tempo dans l'URL. |
| **US8** ✅ | Les instruments | *Livrée.* Quatre timbres, chacun **combinant une voix grave et une voix aiguë** selon le registre de la barre. La mesure hors ligne a révélé que les quatre écrêtaient à 24 voix : le limiteur de sortie n'avait jamais été réglé depuis l'US1. |
| **US9** ✅ | Les natures de barres | Mur, trampoline, éphémère — pour qu'un motif **évolue** au lieu de se répéter à l'identique. *Livrée.* Mur, trampoline, éphémère — un motif **évolue** au lieu de se répéter. Les cinq états se lisent sans texte ni survol (mesuré en pixels : 11 348 unités de matière pour un mur, 6 580 pour une éphémère, 2 128 usée, 0 absente). L'appui long change la nature **sans** voler le geste d'écoute. Le **format de partage v2** porte la nature, le tempo et l'instrument, et un lien v1 continue de s'ouvrir. Requirements : `docs/plans/2026-07-29-001-feat-natures-de-barres-plan.md`. |
| **US10** ✅ | Un air connu | *Livrée.* « Scène surprise » place les barres pour qu'une bille joue l'**ouverture d'un air du domaine public** — un problème inverse résolu par placement, simulation et vérification par rejeu. Trois sondes ont été nécessaires : un modèle balistique écrit à la main donnait 0 réussite sur 510. Requirements : `docs/plans/2026-07-29-002-feat-air-connu-plan.md`. |
| **US11** ✅ | Le point de lâcher | *Livrée.* Une bille lâchée créait une source de son **permanente et invisible** : rien ne la montrait, rien ne permettait de la déplacer ni de la supprimer, alors que ce fichier interdit l'état caché. C'était un défaut de principe. Le point est désormais un objet de scène — visible, déplaçable, jetable — et il **voyage dans le lien** (format v3) : une scène partagée perdait ses billes, donc un air composé arrivait silencieux. |
| **US12** ✅ | Les percussions | *Livrée.* Une percussion est **non accordée**, alors que tout le produit repose sur la hauteur venue de la géométrie. On ne renonce pas au mapping : c'est le **type de fût** qui suit le registre — grosse caisse sous la note de bascule, cymbale au-dessus — et la hauteur continue de moduler l'instrument. Le descripteur de voix gagne trois champs optionnels (bruit, chute de hauteur, filtre passe-haut) dont l'absence signifie le comportement historique. |
| **US13** | Le tempo qu'on règle | La grille existe depuis l'US7 et **rien ne l'expose** : le tempo est figé à 96 BPM. Un réglage rend la grille tangible — c'est aussi le seul moyen d'entendre qu'elle est là. Emporte la périodicité du motif (le G5 laissé ouvert à l'US7), qui devient assertable une fois qu'on peut changer de tempo sans rafale. |
| **US14** | Le clavier | La toile n'est **pas pilotable sans pointeur**, du tout. Reporté à l'US6 comme « une US entière » (modèle de focus, sélection, gestes au clavier), et c'est vrai. C'est aussi le seul manque du produit qui exclut des gens plutôt que de limiter une fonction. |
| **US18** | L'air qui s'entend | **Verdict d'Etienne à l'oreille, 2026-08-04 : l'air composé n'est pas reconnaissable — « pas assez de notes et rythme pas bon ».** Les deux causes sont dans le catalogue : « Ode à la joie » et « Frère Jacques » n'y tiennent que sur **4 notes**, « Au clair de la lune » 5. Un incipit tronqué à quatre notes ne se reconnaît pas, quelle que soit la justesse des hauteurs — et l'US10 prouvait l'ordre des hauteurs, jamais la durée : le rythme n'était contraint que « dans une fenêtre ». Il faut donc des incipits assez longs pour être identifiables **et** faire du rythme une propriété assertée, pas une tolérance. C'est la seule US du backlog qui corrige une fonction que l'oreille a déjà recalée. |
| **US15** | L'harmonie qui avance | La tonique se déplace sur une progression, sur la grille. **Plus gros gain musical du backlog** — ça ferait passer de « jolie texture » à « ça sonne composé ». Placée après les autres parce qu'elle se paie sur la lisibilité : une même barre jouerait des notes différentes selon le moment, ce qui entame « la géométrie **est** la partition ». À concevoir de façon à ce que ce soit un choix visible, pas un effet de bord. |
| **US16** ✅ | La roue | *Livrée.* Le cyclage cachait l'ensemble des options : revenir d'un cran sur cinq timbres coûtait **quatre clics**, et rien n'annonçait ni combien d'options existaient ni laquelle était en place. Une **roue radiale** les montre — une seule géométrie pure, câblée sur deux réglages (nature d'une barre, instrument), et un aller-retour entre deux timbres coûte deux gestes au lieu de huit. Relâcher au centre **épingle** plutôt que d'annuler, parce que le geste de la découverte est « j'appuie long et je relâche sans bouger ». Le défaut trouvé en regardant les captures : recadrée près d'un bord, la roue s'ouvre loin du doigt, et le relâchement appliquait alors une option que personne n'avait visée. Requirements : `docs/plans/us16-la-roue.md`. |
| **US17** ✅ | La roue sur les sources | *Livrée.* Le **dernier cyclage** du produit : taper une source avançait d'un cran de division à l'aveugle, sur cinq valeurs. Le geste ne change pas — c'est celui des sources depuis l'US4 — mais il **ouvre le choix** au lieu d'avancer. Les phrases (« une par demi-mesure ») ne tenaient pas dans un secteur : les noms courts comptent les billes par mesure, `1× 2× 3× 4× 8×`, ce qui se lit comme une échelle et dit la seule chose qu'on veut savoir en visant. `cycleDivision` est remplacée par `setDivision`, qui porte la remise en phase sur la grille. Requirements : `docs/plans/us17-la-roue-sur-les-sources.md`. **Copie tranchée par Etienne (2026-08-04) : on garde les matières** — « Bois », « Verre », « Corde » — plutôt que les noms d'instruments. La review jugeait que la roue nommait des matériaux et non des timbres ; c'est un choix de vocabulaire, et il est fait. |

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
