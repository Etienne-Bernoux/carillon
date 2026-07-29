# US6 — Le vernis

> Statut : **livrée** · Branche `feat/us6-le-vernis` · PR #5 · 199 tests unitaires, 141 assertions navigateur

## Intent

Le produit est complet et en ligne. Ce qui reste n'est pas une fonctionnalité manquante mais trois
défauts d'usage, tous **mesurés** au fil des cinq US précédentes :

1. **Le HUD mange l'écran d'un téléphone** : 44 % d'un 320×568, 36 % en paysage, contre 18 % sur un
   grand écran. Sur le plus petit écran courant, plus de deux cinquièmes de la surface servent à
   afficher cinq boutons.
2. **L'accordage est invisible au doigt.** Les poignées d'extrémité n'apparaissent qu'au survol — et
   il n'y a pas de survol tactile. Le geste central du produit, étirer une barre pour monter sa note,
   n'est donc **découvrable que sur ordinateur**. C'est un angle mort qu'aucune US n'avait vu parce
   que les scénarios tactiles pilotent des gestes déjà connus.
3. **Aucun respect de `prefers-reduced-motion`.** Traînées, ondes et pulsations tournent toujours, y
   compris pour qui a demandé au système de réduire les animations.

## Périmètre

**Dedans** : la densité du HUD sur petit écran, la découvrabilité de l'accordage au doigt, le respect
de `prefers-reduced-motion`, et des particules d'impact — le seul vrai « vernis » du lot, et le moins
important des quatre.

**Dehors** :
- **Accessibilité clavier de la scène** : le canvas n'est pas pilotable au clavier du tout. C'est un
  vrai manque, mais c'est une US entière (modèle de focus, sélection, gestes au clavier), pas du
  vernis. À écrire comme telle si le besoin est confirmé.
- Thème clair : le produit est nocturne par conception, et rien ne demande le contraire.
- Enregistrement audio/vidéo : non-but explicite depuis la stratégie.

## Décisions de conception

**Icônes sous 640 px, texte au-delà.** Le seuil existe déjà dans `style.css` (c'est là que la barre
d'outils passe en bas). Chaque bouton garde son libellé accessible (`aria-label`) et son `title` ; seul
le texte visible est remplacé par un pictogramme. On ne cache aucun contrôle derrière un menu : cinq
boutons tiennent sur une rangée en icônes, et un menu ajouterait un mode — ce que les US3 et US4 ont
refusé par principe.

**Les poignées apparaissent au doigt après le premier contact.** Pas en permanence (ce serait du bruit
visuel sur quinze barres), pas au survol (il n'existe pas). Au premier `pointerdown` tactile, toutes les
barres montrent leurs poignées pendant quelques secondes : le temps de comprendre qu'on peut les
attraper. C'est la même logique que l'indice du bas, qui s'estompe après le premier geste.

**`prefers-reduced-motion` raccourcit, il ne supprime pas.** Une scène figée ne serait plus un
instrument : on garde le mouvement des billes (c'est la simulation) mais on supprime les traînées, on
raccourcit les ondes et on fige la pulsation des sources. Le média-requête est lue **une fois au
démarrage et à chaque changement**, pas à chaque frame.

## Critères d'acceptation

| # | Critère | Résultat mesuré |
|---|---|---|
| F1 | Sur un 320×568, le HUD occupe **≤ 30 %** de la hauteur (44 % avant), les contrôles restent dans le viewport | **29 %** après le premier geste (37 % au chargement, indice encore affiché) — scénario `vernis` |
| F2 | Le libellé accessible de chaque contrôle est préservé en mode icône | 6/6 `aria-label` non vides et **distincts**, 6/6 libellés visibles masqués (style **calculé**, pas `textContent`) |
| F3 | Au doigt, les poignées sont visibles après le premier contact, puis s'estompent | `revealHandles` vrai après un `tap`, faux 6 s plus tard, **faux** après un clic souris — capture `01-petit-ecran-poignees.png` |
| F4 | `prefers-reduced-motion: reduce` supprime les traînées et fige la pulsation, **sans** figer les billes | 542 points de traînée → **0**, étincelles 37 → **0**, billes **22 dans les deux cas** |
| F5 | Les étincelles n'apparaissent que sur les impacts audibles, et sont bornées en nombre | 15 tests unitaires, **10 mutations sur 10 tuées** ; seuil identique à celui du son ; plafond 240 tenu sur 1000 impacts |
| F6 | Aucune régression | 10 scénarios verts, 105 assertions, 0 erreur console, `barsUnderHud` et `droppedSteps` à 0 |
| F7 | fps ≥ 60 au plafond de billes, particules incluses | **120 fps à 312 billes**, 6 sources, audio actif, **240 étincelles allumées** (plafond atteint) |
| F8 | `pnpm check` vert, captures **regardées** et postérieures au code | 194 tests verts ; 5 captures archivées dans `docs/proofs/us6/`, toutes regardées — deux défauts n'ont été trouvés que là |

### Ce que les captures ont attrapé, et rien d'autre

1. **Le bouton « son » orphelin sur une deuxième rangée.** Les six contrôles ne tiennent pas sur une
   ligne à 320 px, donc le dernier passait dessous, seul : lisible comme un bug de mise en page. La
   gamme a désormais **sa propre rangée**. Aucune assertion ne pouvait voir ça — 29 % restait 29 %.
2. **Les étincelles étaient invisibles.** Présentes dans l'état (`stats().particles` > 0), absentes de
   l'écran : 2 px ternes nées au centre du halo blanc de la bille, et un freinage qui les empêchait
   d'en sortir avant de mourir. Corrigé en les faisant **quitter le halo** et en les dessinant comme de
   **courtes traînées** orientées par la vitesse.

### Ce que la review a attrapé, et que les captures ne pouvaient pas voir

La review indépendante a trouvé **deux bloquants, trois points à corriger et un défaut produit** que
ni les assertions ni les captures ne montraient. Tous vérifiés contre le code avant correction.

| | Défaut | Preuve qu'il était réel |
|---|---|---|
| **B1** | « le mode icône est actif » ne regardait que le **libellé masqué**, jamais le pictogramme affiché | En cassant la spécificité du sélecteur d'icône : cinq boutons **parfaitement vides**, 15/15 assertions vertes — et la métrique de densité *s'améliorait* (26 % au lieu de 29 %), donc l'assertion récompensait le bug |
| **B2** | « les billes continuent de tomber » = `balls > 0`, incapable de distinguer une scène vivante d'une scène **gelée** | En figeant entièrement le monde en mouvement réduit : les quatre assertions de la branche passaient |
| **C1** | rien ne mesurait la **visibilité** de la gerbe | En restaurant le réglage « invisible » : 15/15 tests et 15/15 assertions verts |
| **C2** | « un impact violent projette plus loin » était financé par l'écart de **cardinal** (9 étincelles contre 1), pas de vitesse | En supprimant `* strength` : 15/15 verts, ratio 1,73 pour un seuil à 1,5 |
| **C3** | **défaut produit** : de 641 à ~860 px, la colonne du titre tombait à **0 px** — « Carillon » tronqué en « Caril », passant sous les boutons, tagline à un mot par ligne | Mesuré à sept largeurs ; aucun scénario du harnais n'entrait dans la bande |
| **R1** | la révélation tactile était **à la limite du visible** : un disque de 4,5 px à 22 % d'opacité sur un bout de barre déjà rond et lumineux | 570 pixels de différence sur 181 760, dont l'essentiel venait du liseré de la barre |
| **R2** | le commentaire du seed **surpromettait** : flux unique jamais rembobiné | Deux exécutions identiques : signatures de pixels à 36 % d'écart |
| **R3** | `strength` et `midi` d'une étincelle n'étaient couverts par rien | Les remplacer par des constantes : 15/15 verts |
| **R4** | `stats().reducedMotion` lisait la média-requête, donc **s'auto-confirmait** | — |

**Corrections apportées, chacune re-vérifiée par la mutation qui l'avait révélée** :

- B1 → le pictogramme doit être **calculé visible**, et chaque bouton doit avoir un descendant visible
  non vide. La mutation qui vidait cinq boutons échoue désormais.
- B2 → deux relevés à 350 ms d'écart : **déplacement moyen** des billes et croissance des `impacts`.
  Le seuil (20 px) vient du domaine — 350 ms de chute libre couvrent ~86 px, un monde figé donne 0.
  Déplacement *moyen* et non « toutes les billes », parce qu'une bille au sommet de son rebond parcourt
  légitimement moins d'un pixel (mesuré : 21 sur 22).
- C1 → la propriété exacte est **géométrique et pure** : la gerbe doit quitter le halo de la bille
  (28 px = `ball.radius * 7 / 2`, le rayon du sprite de lueur) en 70 ms. Mesuré 29,4 px : marge mince
  **voulue**, le cœur étant déterministe. La mesure en pixels a été essayée et **abandonnée avec ses
  chiffres** : une couronne de 26 à 80 px donne 15 364 pixels clairs à l'impact et 13 751 après 70 ms —
  elle *baisse*, dominée par le halo de la barre qui s'éteint et par l'onde qui la traverse.
- C2 → règle exacte sur le domaine : la vitesse d'une étincelle est bornée par
  `SPEED_MIN + (SPEED_MAX − SPEED_MIN) × strength`, quel que soit le nombre d'étincelles.
- C3 → cause racine : `minmax(0, 1fr) auto` laissait la piste `auto` se dimensionner à son max-content.
  Plancher `min-content` sur la colonne du titre **et** empilement jusqu'à 860 px — mais **conditionné à
  la hauteur** (`min-height: 481px`), sans quoi un téléphone en paysage empilait sa barre d'outils en bas
  et faisait passer une barre derrière le HUD (attrapé par le scénario `share`, en régression).
  Couverture ajoutée à 641, 700, 859 et 861 px : elles échouent toutes sur l'ancien CSS.
- R1 → un **anneau** qui dépasse du bout de barre, plus un point vif, au lieu d'un disque pâle ; et le
  survol retrouve son rayon d'origine (5,5 px), que le `5,5 × strength + 2` avait porté à 7,5 px en
  silence. Assertion en pixels aux extrémités : **0 → 845** pixels blancs. C'est le cas où la mesure de
  pixels *fonctionne*, parce que la scène est figée et que la seule différence **est** la poignée.
- R2 → RNG rembobiné à chaque `clear()`, et le commentaire dit désormais exactement ce qui est garanti.
- R3 → `strength` et `midi` assertés contre `gainForImpact` et la note passée.
- R4 → `stats()` rapporte ce que le **rendu** croit (`renderer.isReducedMotion()`).

Bilan : **141 assertions navigateur** (105 avant la review) et **199 tests** (194).

## Risques

- **Les icônes rendent les contrôles illisibles.** Un pictogramme mal choisi est pire qu'un mot. On
  garde le `title` (infobulle au survol) et l'`aria-label`, et on regarde les captures : si un bouton
  n'est pas identifiable, le mot revient.
- **Les poignées au doigt ajoutent du bruit** plutôt que de la clarté sur une scène dense. Le rendu
  doit rester discret ; la capture tranchera.
- **Les particules coûtent de la perf** au plafond de billes. F7 est là pour ça, et le budget a déjà
  été mesuré à 315 billes / 120 fps : la marge existe, mais elle n'est pas infinie.
- **Émuler `prefers-reduced-motion`** dans le harnais demande `page.emulateMediaFeatures` : si l'API
  ne fait pas ce qu'on croit, l'assertion serait creuse. À vérifier par test de mutation.
  → **Levé** : l'app rapporte elle-même ce qu'elle lit (`stats().reducedMotion`), et l'assertion porte
  sur des grandeurs qui **changent** (traînées 542 → 0, étincelles 37 → 0) tout en en gardant une qui
  ne doit **pas** changer (22 billes vivantes). Une émulation sans effet ferait tomber les trois.
- **Piège de preuve rencontré, à retenir** : une gerbe photographiée à l'âge 0 est **invisible par
  construction** — toutes les étincelles sont encore au point de contact. La première capture ne
  montrait rien et laissait croire à un rendu cassé ; c'était l'instant de la capture. Le scénario
  attend maintenant 70 ms après l'impact, et le commentaire dit pourquoi.

## Orchestration

Écrit par moi. La **review reste déléguée** à un agent qui n'a pas écrit le code : sur cinq US, elle a
trouvé 3, 2, 3, 3 et 1 bloquants réels — c'est de très loin l'étape la plus rentable du cycle, et les
deux dernières fois le bloquant était un test incapable d'échouer.
