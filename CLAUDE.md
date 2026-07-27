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
- Grid CSS : `minmax(0, 1fr)` pour éviter le blowout au min-content.
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
- **Après un test de mutation, `git diff` sur le fichier touché doit être vide**, et les preuves
  doivent être **postérieures** au code (comparer les horodatages avant de clôturer). Déjà payé : un
  résidu `void dx` a survécu à `pnpm check`, parce que c'est justement la forme qui fait taire
  `noUnusedLocals`.
- **Ce qui vit dans le canvas ne se vérifie pas depuis le DOM.** `scrollWidth` est aveugle aux barres
  qui débordent ou passent derrière le HUD : il faut un compteur exposé par l'app
  (`barsOutOfBounds`, `barsUnderHud`) et l'asserter à 0.
- **Un seuil de test se pose sur le domaine, pas sur les cas déjà regardés.** Deux largeurs vérifiées
  laissaient un trou sur toutes les autres : la richesse musicale y valait 40 % de sa valeur desktop.

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
