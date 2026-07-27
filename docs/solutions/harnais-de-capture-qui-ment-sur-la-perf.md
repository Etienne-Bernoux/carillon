# Un harnais de capture peut mentir sur la performance

> Issu de l'US1. Symptôme : `pnpm shoot` annonçait **20 fps** avec 200 billes, très loin du critère
> d'acceptation (≥ 45). Le produit tournait en réalité à **121 fps**. Le fautif était le harnais.

## Le piège

Le harnais lançait Chrome avec `--use-gl=swiftshader`, un flag ajouté « pour la fiabilité du canvas
en headless ». Ce flag force le **rendu logiciel** : plus de GPU du tout, y compris en mode headed.
Le harnais mesurait donc une machine que personne n'utilise, et son verdict de perf était sans
rapport avec l'expérience réelle.

Coût du piège : il pousse à « optimiser » un code qui n'a aucun problème. C'est la pire dette qu'un
outil de vérification puisse créer — il oriente le travail vers un faux problème avec l'autorité
d'une mesure.

## La méthode qui a démasqué le faux problème

Ne pas optimiser au flair. **Bissecter la dépense** avant de toucher une ligne de code :

1. **Mesurer le cœur pur, hors navigateur.** 120 pas de simulation à 200 billes / 25 barres, chronométrés
   en Vitest : **1,62 ms par frame** sur un budget de 16,7 ms. La physique était donc innocente —
   information obtenue en 2 minutes, sans navigateur, parce que le noyau est pur et sans DOM.
   *C'est le vrai retour sur investissement de la frontière noyau pur / adaptateur.*
2. **Mesurer le dessin dans la page.** Instrumentation temporaire de `renderer.draw` par phase
   (voile, ondes, barres, billes) : **0,23 ms par frame** au total. Le dessin était innocent aussi.
3. **En déduire où le temps se cache vraiment.** Si ni la simulation ni les appels de dessin ne
   coûtent, la dépense est en **rastérisation / composition** — hors des `performance.now()` de la
   page, puisque le canvas enregistre des commandes et les rastérise plus tard. C'est exactement la
   signature d'un rendu logiciel.
4. **Suspecter la configuration du harnais**, pas le produit. Comparaison A/B des flags de lancement
   → le coupable tombe.

L'étape 3 est celle qu'on saute : une mesure in-page à 0,23 ms « prouve » que le rendu va bien, alors
qu'elle ne mesure que l'**enregistrement** des commandes de dessin, jamais leur exécution.

## Le deuxième mensonge : l'intitulé d'une assertion n'est pas son contrat

Le même harnais affichait, vert, `assert OK — fps >= 45 avec 200 billes / 12 barres`. Trois
mensonges dans une seule ligne, tous découverts en revue :

1. **Il n'y avait pas 200 billes.** Elles étaient lâchées en haut à vitesse nulle et sortaient par
   le bas en ~1,2 s ; la mesure avait lieu à 2 s. Il en restait 82. Le nombre réel était *loggé*
   mais **jamais asserté** — un chiffre affiché n'est pas un garde-fou.
2. **L'audio ne tournait pas.** Le scénario pilotait l'app par son API de debug, sans geste
   pointeur ; or l'`AudioContext` ne se crée qu'au premier geste. Le convolveur de réverbe — le
   nœud le plus cher du graphe — n'a jamais tourné sous charge. Le risque principal listé au plan
   n'était pas exercé, et le scénario s'appelait `stress`.
3. **Le seuil ne correspondait pas au critère.** Le plan et la stratégie disent 60 fps, le harnais
   assertait 45.

Règle qui en sort : **tout ce qui est nommé dans l'intitulé d'une assertion doit être asserté dans
la même assertion, sur le même relevé.** « avec 200 billes » impose `balls >= 200`. Sinon l'intitulé
est un commentaire optimiste, et il survivra à la disparition de ce qu'il décrit.

Corollaire : quand un scénario pilote l'app par une API de debug, il court-circuite les chemins que
seuls de vrais gestes déclenchent (déverrouillage audio, focus, `pointerdown`). Il faut **au moins un
vrai geste** dans tout scénario censé exercer la chaîne complète.

## Un compteur pour ce que le framerate ne voit pas

Une boucle à pas fixe avec accumulateur écrête son retard pour ne pas spiraler. Si la simulation
ralentit, elle **jette du temps simulé** : le monde tourne au ralenti, et les fps restent excellents.
Aucune mesure de framerate ne peut révéler cette panne. Le seul remède est d'exposer le compteur de
pas abandonnés (`droppedSteps`) et de l'asserter à 0.

Même logique pour la géométrie : `scrollWidth <= innerWidth` est une métrique **DOM**, aveugle à ce
qui se passe dans un canvas plein écran. C'est ainsi que des barres 133 px hors champ ont traversé
trois exécutions vertes du harnais *et* le jeu de preuves accepté. Il faut asserter la géométrie là
où elle vit : un compteur `barsOutOfBounds` côté application.

## Règles à garder

- **Un flag de navigateur dans un harnais est une hypothèse de perf**, pas un détail de confort.
  `--use-gl=swiftshader`, `--disable-gpu`, `--single-process` invalident toute assertion de fps.
- **Une assertion de fps doit tourner sur la même classe de machine que l'utilisateur**, sinon elle
  ne mesure rien d'exploitable. Si le CI n'a pas de GPU, il faut y asserter le **coût du cœur pur**
  (déterministe, reproductible) et laisser l'assertion de fps au poste de dev.
- **Le voile de traînée est indépendant du framerate à écrire, pas à mesurer** : à 120 Hz il y a deux
  fois plus de fondus qu'à 60 Hz, donc des traînées deux fois plus courtes. Ne pas conclure « les
  traînées ne marchent pas » depuis une capture où les billes sont lentes (cf. `docs/proofs/us1/`,
  où la scène d'accueil ne montre pas de traînée alors que le scénario `stress` en montre de très nettes).
- **Toujours instrumenter avant d'optimiser** — et retirer l'instrumentation avant le commit
  (Definition of Done §5).

## Voir aussi

- `CLAUDE.md` §4 — le harnais et les pièges déjà payés
- `docs/plans/us1-le-premier-rebond.md` — critère A8 et sa preuve
