# CLAUDE.md — carillon

> Projet **autonome** : Etienne a délégué la construction de bout en bout (choix du produit inclus).
> Ce fichier décrit **ma méthode de travail** ici. Il prime sur la posture pédago de
> `~/Perso/projets/CLAUDE.md` (« Etienne écrit le code d'abord », « tu écris ou je propose ? »)
> **pour ce repo uniquement** — c'est le sens explicite de la délégation.
> Les universels du global (`~/.claude/CLAUDE.md`) restent en vigueur : langue, sécurité git,
> qualité de code, contrat de sortie de tour.

## 1. Ce qu'on construit

Voir [`STRATEGY.md`](./STRATEGY.md). En une phrase : **Carillon**, un bac à sable musical
physique — on dessine des obstacles, on lâche des billes, chaque rebond joue une note.

## 2. Boucle de travail — compound engineering

Une **US = une boucle complète**. Jamais de big-bang non vérifiable.

```
intent  →  plan  →  work  →  verify  →  review  →  compound  →  commit
```

| Phase | Artefact | Règle |
|---|---|---|
| **intent** | une ligne dans `STRATEGY.md` (backlog) | pourquoi c'est fun / ce que ça débloque |
| **plan** | `docs/plans/us<N>-<slug>.md` | découpage en tâches, critères d'acceptation **testables**, risques |
| **work** | code | slices courtes, cœur métier **pur** (testable sans DOM) séparé du rendu |
| **verify** | `pnpm check` vert **+ screenshot** | cf. §4 — pas de preuve, pas de « fait » |
| **review** | passe `ce-code-review` | corrections avant commit, pas après |
| **compound** | `docs/solutions/**.md` | seulement si le problème résolu était **non évident** et **réutilisable** |
| **commit** | conventional commit | une US = une branche `feat/us<N>-<slug>`, mergée en `--no-ff` sur `main` |

**Itérer, pas planifier loin** : le plan de l'US N+1 s'écrit *après* la review de l'US N, avec ce
qu'on vient d'apprendre. C'est tout l'intérêt du compound : chaque tour rend le suivant meilleur.

## 3. Definition of Done (bloquant)

Une US n'est « done » que si **tout** est vrai :

1. `pnpm check` vert = **typecheck strict + tests unitaires**. Pas de linter : `strict`,
   `noUnusedLocals`, `noUncheckedIndexedAccess` et `exactOptionalPropertyTypes` couvrent déjà
   l'essentiel, et une dépendance de plus demanderait sa justification (§7). Cette ligne doit
   décrire ce que `check` fait **réellement** — une DoD qui promet plus que la commande est un
   contrôle qui ment.
2. Les critères d'acceptation du plan sont cochés un par un, chacun avec sa preuve.
3. **Preuve visuelle** : au moins un screenshot du chemin nominal dans `docs/proofs/us<N>/`.
4. **Responsive vérifié** : viewport ~375px, zéro débordement horizontal (`scrollWidth <= innerWidth`),
   tous les contrôles atteignables.
5. Aucune constante de debug / de balance laissée dans le code (grep avant commit).
6. Zéro `as any`, `@ts-ignore`, `as unknown as` non justifié en commentaire.

## 4. Vérifier — preuve, pas conviction

Pas de suite e2e lourde. Le harnais : **`scripts/shoot.mjs`** (puppeteer-core piloté sur le Chrome
système, aucun téléchargement de navigateur) → sert le build, ouvre la page, joue un scénario,
écrit des PNG que je **regarde** vraiment.

Pièges déjà connus (issus des règles cortex, à ne pas réapprendre) :

- **Lire le DOM après le re-render**, pas synchroniquement après un `.click()`.
- **Vrai reload** = redémarrer le serveur, pas un `location.reload()` téléguidé.
- **Exercer les deux chemins** quand ils existent (temps réel *et* rattrapage).
- Grid CSS : `minmax(0, 1fr)` évite le blowout de la piste flexible — **et autorise son écrasement**.
  Une piste `auto` voisine se dimensionne à son max-content et peut réduire le `1fr` à 0 px : il faut
  alors un **plancher** (`minmax(min-content, 1fr)`). Déjà payé, en production
  (`docs/solutions/blowout-de-grille-sur-la-piste-auto.md`).
- Booster une constante pour exercer un chemin lent → **revert avant commit**, systématiquement.
- **Un flag de navigateur dans le harnais est une hypothèse de perf.** `--use-gl=swiftshader`,
  `--disable-gpu` et compagnie forcent le rendu logiciel et invalident toute assertion de fps
  (déjà payé : facteur 6 sur les fps mesurés, cf.
  `docs/solutions/harnais-de-capture-qui-ment-sur-la-perf.md`).
- **Avant d'optimiser, bissecter la dépense** : coût du noyau pur en Vitest d'abord, coût du dessin
  in-page ensuite, et se rappeler qu'une mesure in-page ne voit **pas** la rastérisation.
- Dans cet environnement, le lancement de Chrome exige de désactiver le sandbox de l'outil Bash.
  Ce n'est pas un défaut du code : ne pas « corriger » le harnais pour ça.
- **Toute assertion « ça a changé » se valide par un test de mutation** : neutraliser le comportement,
  vérifier que l'assertion rougit, restaurer. Déjà payé — une comparaison de captures plein cadre
  passait au vert grâce à l'état `:hover` du bouton cliqué
  (`docs/solutions/tester-la-propriete-pas-son-proxy.md`).
- **Une assertion écrite pour un correctif doit exercer le chemin que le correctif a ajouté.** Déjà
  payé (US16) : le garde « la zone morte se mesure depuis l'origine du geste » vivait dans `aimWheel`,
  et l'assertion censée le prouver ne bougeait jamais le pointeur — donc n'appelait jamais `aimWheel`.
  Remettre le bug laissait les **douze** assertions vertes. Aucune relecture du test ne montre ce trou ;
  une mutation le montre en une exécution. Corollaire : après avoir corrigé un défaut, **muter le
  correctif** et pas seulement vérifier que le scénario passe.
- **Un signal qui ne passe que le test n'est pas un signal.** Même US : le liseré d'annulation était
  mesurable (251 pixels rouges contre 0) et parfaitement invisible en regardant la capture. Un effet
  destiné à l'œil se dimensionne en le regardant, puis se mesure — dans cet ordre. Et sa mesure exige un
  **contrôle propre** : les premiers pixels « rouges » comptés venaient d'une barre grave à l'écran, pas
  du liseré.
- **Une sonde à un seul point mesure une position, pas une grandeur.** Trois fois le même piège dans la
  même US, chaque fois trouvé par la review : compter l'encre à **un** rayon laissait passer un trait
  deux fois plus fin qu'il suffisait de déplacer ; pousser le pointeur de 8 px en dur épinglait
  l'*existence* d'un seuil dont la valeur pouvait tomber de 26 à 10 ; mesurer les libellés dans **une**
  police laissait l'autre déborder. Quand la propriété porte sur une épaisseur, un seuil ou une plage,
  la sonde doit **encadrer** — deux côtés de la frontière, plusieurs rayons, toutes les polices — et le
  paramètre doit être **lu dans l'app**, jamais recopié dans le test.
- **Un signal a un sens, pas seulement une présence.** Vérifier que l'alarme d'annulation s'affiche ne
  dit pas qu'elle veut dire « annuler » : sans un contrôle exigeant son **absence** quand on vise un
  secteur, elle pouvait signifier « une visée existe » et l'assertion restait verte.
- **Le seuil d'une mesure se dérive du tracé, et l'assertion doit exclure la version rejetée.** Suite du
  point précédent, et c'est la review qui l'a trouvé : après avoir jugé une version invisible « à
  refaire », l'assertion écrite ensuite portait un seuil rond (`> 100`) que cette version passait
  largement (251). Un seuil rond est un nombre déguisé. Le bon réflexe : poser la sonde là où **seule**
  la version acceptée arrive (rayon atteint par un trait de 5 px et pas par un de 2 px) et déduire
  l'attendu de la géométrie du tracé (épaisseur, motif de tirets). Corollaire : mesurer **chaque**
  composante de l'effet — le voile n'était compté par rien, donc le retirer passait.
- **Une liste de cas qui s'allonge à chaque support est un aveu.** Une roue épinglée captait d'abord les
  gestes « décisifs », puis le survol pour viser à la souris, puis le tracé pour viser au doigt, puis le
  glisser — parce qu'un glisser commencé sur une barre émet `drag` et déplaçait la barre **sous** la
  roue. Le troisième ajout aurait dû être le signal : la bonne règle n'était pas une liste mais une
  propriété (le sélecteur est **modal**, il consomme tout jusqu'à décision). Quand un troisième cas
  particulier arrive, chercher l'invariant qui les remplace tous.
- **Une mutation se restaure depuis une copie, jamais par `git checkout`, et jamais avant d'avoir
  commité.** Les deux moitiés de la règle ont été payées dans le même tour (US16) : sur un fichier
  **neuf**, `git checkout -- <fichier>` échoue (« pathspec did not match ») et les mutations
  s'**accumulent** en silence — les trois suivantes ne prouvent alors plus rien, et le fichier reste
  corrompu ; sur un fichier **suivi**, il réussit trop bien et **efface le travail non commité** — une
  US entière de `main.ts` perdue, à reconstituer. Donc : commiter d'abord, `cp` vers le scratchpad,
  restaurer par `cp`, et vérifier qu'une mutation non appliquée (motif qui ne matche pas) est signalée
  comme telle plutôt que comptée comme tuée.
- **Après un test de mutation, `git diff` sur le fichier touché doit être vide**, et les preuves
  doivent être **postérieures** au code (comparer les horodatages avant de clôturer). Déjà payé : un
  résidu `void dx` a survécu à `pnpm check`, parce que c'est justement la forme qui fait taire
  `noUnusedLocals`.
- **Ce qui vit dans le canvas ne se vérifie pas depuis le DOM.** `scrollWidth` est aveugle aux barres
  qui débordent ou passent derrière le HUD : il faut un compteur exposé par l'app
  (`barsOutOfBounds`, `barsUnderHud`) et l'asserter à 0.
- **Une propriété qui vit dans `main.ts` n'est pas démontrable.** Extraire la logique dans un module
  pur n'est pas du style : c'est ce qui permet de l'asserter. Déjà payé — cinq fonctions de géométrie
  sans aucun test unitaire, dont la seule preuve était un scénario navigateur à un viewport et une
  graine, avec un défaut logé exactement là.
- **Une assertion exacte plutôt qu'un quota.** « Au plus une note décalée » laisse passer une
  déformation réelle sur une scène plus dense ; « toute barre au-dessus de ce seuil garde sa note »
  ne laisse rien passer.
- **Un seuil de test se pose sur le domaine, pas sur les cas déjà regardés.** Deux largeurs vérifiées
  laissaient un trou sur toutes les autres : la richesse musicale y valait 40 % de sa valeur desktop.
- **« Présent dans l'état » ≠ « visible à l'écran ».** Deux propriétés distinctes : la première
  s'asserte, la seconde ne se juge qu'en regardant. Les étincelles de l'US6 étaient comptées par
  `stats()`, bornées, couvertes par 10 mutations tuées — et parfaitement invisibles. Un effet qu'on ne
  voit pas se dimensionne ou se retire ; le garder invisible, c'est un test vert qui protège du vide.
- **Un effet transitoire se photographie à un instant choisi**, et le scénario dit lequel et pourquoi.
  Une gerbe capturée à l'âge 0 est invisible **par construction** — rien n'a encore bougé. Ce faux
  négatif ressemble trait pour trait à un rendu cassé.
- **La sonde jetable doit devenir un scénario.** Une preuve qui vit dans un fichier supprimé en fin de
  tour n'est pas une preuve. Si elle a servi une fois à trancher, elle sert au prochain run.
- **Pour toute métrique « moins, c'est mieux », chercher ce qui l'optimiserait le plus.** Une assertion
  peut *récompenser* le défaut : vider cinq boutons de la barre d'outils **améliorait** la densité du
  HUD (26 % contre 29 %). Vérifier qu'un contrôle vide, une page blanche ou une scène gelée n'obtiennent
  pas la meilleure note.
- **Une mesure de pixels exige un contrôle** : deux états qui ne diffèrent que par la chose mesurée.
  Sur une scène figée elle est exacte (poignées : 0 → 845 pixels blancs) ; sur une scène vivante elle est
  noyée par le décor (étincelles : 15 364 → 13 751, elle *baisse*). Dans le second cas, chercher la
  propriété exacte ailleurs — souvent une grandeur géométrique assertable dans le cœur pur.
- **Un seuil se dérive du code, pas de l'intuition.** « Quitter le halo » estimé à 30 px faisait échouer
  le code correct ; le vrai nombre était 28 (`ball.radius * 7 / 2`, la demi-taille du sprite de lueur).
- **Une mutation qui survit ne condamne pas le test.** La bonne question est « **sous quelle condition
  ces deux codes cessent-ils d'être le même code** », pas « qu'est-ce que mon test ne couvre pas ».
  L'accumulation d'échéance passait 19 tests sur 19 parce qu'elle est *mathématiquement identique* au
  recalcul depuis la grille — sauf au changement de tempo. Quand aucune condition de divergence
  n'existe, c'est le **code** qui porte une redondance
  (`docs/solutions/mutation-survivante-nest-pas-test-faible.md`).
- **Un test qui neutralise le mécanisme qu'il surveille ne prouve rien.** Mettre la gravité à zéro « pour
  isoler le rebond » désactivait aussi le plafond de vitesse, qui en dépend : la mutation passait.
  Vérifier que la grandeur testée est encore **active** dans les conditions du test.
- **Une borne se pose dans le repère que l'œil juge.** Le plafond d'un trampoline, posé sur le point de
  contact, laissait la bille à moitié hors de l'écran au sommet — le point de contact est sous le centre
  de la bille. C'est le **bord** de l'objet visible qui compte.
- **Un seuil de mise en page se vérifie de part et d'autre de sa bascule, et sur les deux axes.** Une
  media query réglée sur la largeur seule a fait passer une barre derrière le HUD sur un téléphone en
  paysage. La largeur et la hauteur posent deux problèmes différents.

Une US n'est close qu'après avoir **regardé** les captures. Le jeu accepté est archivé dans
`docs/proofs/us<N>/` ; `docs/proofs/<scénario>/` ne contient que l'état courant, écrasé à chaque run.

Le cœur simulation/audio est **pur et déterministe** (seed explicite, pas de `Math.random()` caché,
pas de `Date.now()` dans la boucle) → testable en Vitest sans navigateur. C'est ce qui rend la
vérification bon marché.

## 5. Orchestration des agents

Un agent par **tâche indépendante et cadrée**, jamais pour gonfler le parallélisme.

| Type de tâche | Modèle / effort | Pourquoi |
|---|---|---|
| Design, archi, arbitrage, synthèse, juge | Opus / high | coût d'une erreur élevé |
| Implémentation cadrée par un plan écrit | Sonnet / medium | le plan porte la réflexion |
| Mécanique, scaffolding, recherche, lint-fix | Haiku·Fable / low | volume, pas de jugement |

Règles dures d'orchestration :

- **Contrat écrit** : chaque agent reçoit son périmètre de fichiers, ses interfaces d'entrée/sortie
  et son critère de succès. Pas de « débrouille-toi ».
- **Pas deux agents sur le même fichier** en parallèle. Le découpage se fait par frontière de module.
- **Toute déviation du modèle de session est annoncée** avec sa raison (règle du global).
- La **review est faite par un autre agent** que celui qui a écrit le code.
- Je ne prends **jamais** le rapport d'un agent pour argent comptant : je vérifie le diff et je
  relance la commande moi-même.

## 6. Structure

```
CLAUDE.md            méthode (ce fichier)
STRATEGY.md          produit, backlog, non-buts
docs/plans/          un plan par US
docs/solutions/      learnings compoundés
docs/proofs/         screenshots de preuve, par US
scripts/shoot.mjs    harnais de capture headless
src/core/            simulation + musique — pur, testé, zéro DOM
src/ui/              rendu canvas, contrôles, interactions
```

## 7. Conventions

- Prose (README, docs, commits body, PR) : **français**. Code, identifiants, types : **anglais**.
- Commits : **conventional commits**, impératif (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Pas de commentaires décoratifs : on commente le **pourquoi** non évident (invariant, workaround),
  jamais le quoi.
- Pas de dépendance runtime sans justification : le navigateur sait déjà faire (canvas, Web Audio).
  Les seules deps acceptées sont de **dev** (Vite, TypeScript, Vitest, puppeteer-core).
- Pas de push (aucun remote configuré à ce stade). Le jour où il y en a un : branche + PR, jamais
  `main` en direct.
