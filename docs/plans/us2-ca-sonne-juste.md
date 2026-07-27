# US2 — Ça sonne juste

> Statut : en cours · Branche `feat/us2-ca-sonne-juste`

## Intent

L'US1 fait sonner une note à chaque rebond, mais elle sonne **mal cadrée** : la hauteur dérive d'une
longueur en **pixels absolus**, si bien qu'un téléphone ne joue que deux hauteurs sur toute la scène
(limite mesurée et consignée dans le plan de l'US1, preuve `docs/proofs/us1/06-resize.png`). Et les
cinq gammes du catalogue sont inatteignables : une seule est câblée en dur.

Cette US règle les deux : la hauteur devient **relative à la scène**, et le choix de gamme devient un
geste. C'est ce qui transforme « ça sonne » en « ça joue » — et surtout ce qui crée la boucle
*je change une chose, j'entends la différence*, qui est le cœur du plaisir d'un instrument.

## Périmètre

**Dedans** : mapping longueur → hauteur relatif à la largeur de la scène ; sélecteur de gamme dans
l'UI ; **réaccordage des barres existantes** au changement de gamme ; couverture de hauteurs vérifiée
par test sur tous les viewports.

**Dehors** : choix de la tonique (US ultérieure — une gamme suffit à créer la boucle) ; émetteurs
périodiques et partage d'URL (US4) ; vernis visuel (US5) ; édition/suppression de barres (US3).

## Décision de conception

`midiForLength(lengthPx, tuning, sceneWidth)` borne la longueur en **fraction de la largeur de scène**
(3 % → 55 %) plutôt qu'en pixels (40 → 700 px). À 1280 px, ces bornes valent 38 → 704 px : le
comportement desktop est donc préservé quasi à l'identique, ce qui évite de casser ce qui marche
déjà. À 375 px, elles valent 11 → 206 px, et les barres du téléphone (80 → 165 px) couvrent enfin
l'essentiel de l'étendue.

La hauteur d'une barre reste **figée à sa création** : redimensionner la fenêtre ne réaccorde pas les
barres déjà posées. C'est volontaire — une note qui change parce qu'on a élargi la fenêtre serait
déroutante. Seul un changement de gamme réaccorde, parce que là l'utilisateur le demande.

## Critères d'acceptation

| # | Critère | Preuve attendue | Résultat |
|---|---|---|---|
| B1 | `midiForLength` est strictement décroissante en longueur, pour **chacune** des 5 gammes | test unitaire | ✅ balayage de 667 longueurs × 5 gammes |
| B2 | Invariance d'échelle : à ratio `longueur / largeur` égal, la hauteur est la même à 375 px et à 1920 px | test unitaire | ✅ 5 gammes × 7 ratios × 5 largeurs (320 → 3840) |
| B3 | La scène d'accueil couvre **≥ 5 hauteurs distinctes à 375 px** (2 avant) et ≥ 8 à 1280 px | test unitaire croisant génération de scène et mapping | ✅ et **11 hauteurs** mesurées à 1280 px |
| B4 | Le comportement desktop n'est pas cassé : à 1280 px, la plage utile couvre tous les degrés | test unitaire | ✅ les 15 degrés atteints, aucun sauté |
| B5 | Changer de gamme réaccorde **toutes** les barres existantes, sans en déplacer aucune | test unitaire sur la fonction de réaccordage | ✅ + non-dérive après réaccordages en boucle |
| B6 | Le sélecteur de gamme est utilisable et lisible à 375 px, libellé à jour, et change réellement les hauteurs | scénario navigateur + capture | ✅ 4 assertions dans `controls`, dont une comparaison **pixel** avant/après (la couleur encode la hauteur) |
| B7 | `pnpm check` vert, `pnpm shoot` vert, captures **regardées** et archivées | sorties de commande | ✅ 67 tests · 5 scénarios / 28 assertions · `docs/proofs/us2/` |

### Ce que l'US2 a réellement appris

Le critère B3 a **échoué au premier essai, y compris sur desktop** : 4 hauteurs distinctes seulement,
alors que le mapping relatif était en place. Le mapping n'était pas le coupable — le **générateur**
produisait toutes ses longueurs dans une plage de 1,6:1, donc aucune fonction de projection ne
pouvait en tirer de la richesse. Deux corrections ont suivi :

1. **Plage de longueurs élargie** (0,3 → 1,8 fois le pas de la rangée), les barres de bord restant
   ancrées au bord pour ne pas rouvrir de couloir vertical.
2. **Échantillonnage stratifié** plutôt que tirages indépendants : chaque barre reçoit une longueur
   cible répartie sur toute l'étendue, puis l'ordre est mélangé. La richesse devient une propriété
   *par construction* et non *en moyenne* — avec 9 barres sur un téléphone, le tirage indépendant
   descendait à 3 hauteurs sur les graines malchanceuses.

Effet de bord mesuré et bienvenu : sur le chemin nominal, les impacts passent de **16 à 71** en
1,8 s. Des barres plus longues se chevauchent davantage, donc les billes rebondissent plus — la
scène joue une phrase au lieu de trois notes.

Le défaut de fond venait d'un **test qui mesurait un proxy** (« les longueurs varient ») au lieu de
la propriété annoncée (« les hauteurs varient »). Capitalisé dans
`docs/solutions/tester-la-propriete-pas-son-proxy.md`.

## Risques

- **Casser le desktop en corrigeant le mobile.** Mitigation : B4 verrouille la plage à 1280 px ; les
  bornes relatives ont été choisies pour retomber sur les anciennes valeurs à cette largeur.
- **Un 4ᵉ bouton qui déborde à 375 px.** Le scénario `mobile` asserte déjà que tout `[data-control]`
  est entièrement dans le viewport : le harnais le verra.
- **Réaccordage incohérent** si la longueur est recalculée depuis des coordonnées déjà arrondies.
  Mitigation : le réaccordage repart toujours de la géométrie de la barre, seule source de vérité.

## Orchestration

Petite US, majoritairement écrite par moi (mapping musical + câblage UI : c'est du jugement de
conception, pas du volume). La **review est déléguée à un agent qui n'a pas écrit le code**, comme
l'exige `CLAUDE.md` §5 — c'est le point de contrôle qui a rapporté trois bloquants en US1.
