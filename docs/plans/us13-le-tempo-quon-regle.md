# US13 — Le tempo qu'on règle

> Statut : **livrée** · Branche `feat/us13-tempo` · 328 tests unitaires, 19 scénarios navigateur
> (248 assertions), 10 mutations tuées sur 10 · une passe de review adverse déléguée, qui a trouvé
> **deux bloquants** et six assertions creuses

## Intent

La grille existe depuis l'US7 : les sources s'expriment en divisions de mesure, deux sources de même
division restent en phase indéfiniment, une bille lâchée à la main revient sur le temps. **Rien ne
l'expose.** Le tempo est figé à 96 BPM depuis la première ligne du projet.

Un réglage la rend tangible — et c'est surtout le seul moyen de l'**entendre**. Aujourd'hui on peut
croire que les billes tombent au hasard : rien ne permet de vérifier qu'elles suivent une pulsation.

L'US7 avait laissé ouverte la périodicité du motif, en notant qu'elle deviendrait assertable « une fois
qu'on peut changer de tempo sans rafale ». C'est ici.

## La décision : une glissière, pas des préréglages

Le tempo est **continu** dans le modèle de données : il voyage dans le lien de partage depuis le format
v2 (`encodeTempo`, 60 à 168 BPM sur une échelle fine). Une roue de préréglages — le réflexe après les
US16 et 17 — le discrétiserait, et un lien reçu à 103 BPM deviendrait **inaffichable** : la roue
marquerait 96 en mentant sur la valeur réelle.

Le bouton de tempo devient donc une **glissière** : on appuie dessus, on glisse horizontalement, le tempo
suit le doigt et s'annonce en continu. Trois raisons :

1. **Ça respecte le modèle.** Une valeur continue se règle continûment ; aucune conversion ne perd
   d'information, et un lien reçu s'affiche tel qu'il est.
2. **Ça coûte zéro espace de HUD.** L'US6 a ramené le HUD de 44 % à 29 % d'un 320×568 ; y ajouter une
   piste de glissière rendrait ce combat. Le bouton existe déjà et affiche la valeur.
3. **C'est le vocabulaire en place.** Depuis l'US16, un geste maintenu qui suit le pointeur et décide au
   relâchement est l'idiome du produit. La glissière en est le cas continu.

Un tap sans glisser **ré-annonce** le tempo courant plutôt que de le changer : c'est utile au lecteur
d'écran, et surtout ça évite qu'un geste bref modifie la pulsation de toute la scène par accident.

## La décision : la valeur suit la **distance**, pas la position

Le geste part du bouton, qui n'est pas au milieu de l'écran : mapper la position absolue du pointeur sur
l'étendue 60–168 ferait sauter le tempo dès le premier pixel, à une valeur qui dépend de l'endroit où le
bouton se trouve. La glissière lit donc un **déplacement depuis l'origine du geste**, converti en BPM par
une sensibilité fixe — le même raisonnement que la zone morte de l'US16, où mesurer depuis le centre du
dessin au lieu de l'origine du geste appliquait une option que personne n'avait visée.

## Périmètre

**Dedans** : `bpmForDrag` dans `src/core/clock.ts` (pur, testé), les écouteurs de glissement sur le
bouton, le libellé qui suit la valeur, l'annonce, l'undo, le transport dans le lien (déjà en place), et
un scénario navigateur.

**Dehors**

- **La périodicité du motif** (le G5 de l'US7) : elle devient *assertable* grâce à cette US, mais la
  mesurer est un travail à soi seul — il faut définir ce qu'est « le motif se répète » sur une scène où
  les billes meurent et reviennent.
- **Un tempo par source** : ce serait polyrythmique, donc une autre musique. La grille est commune, c'est
  ce qui met les sources en phase.
- **Une roue de préréglages** : écartée ci-dessus, avec sa raison.

## Critères d'acceptation

Chacun avec sa preuve, chacun validé par mutation.

### Cœur pur (Vitest)

1. **Un déplacement nul ne change rien** : `bpmForDrag(bpm, 0)` rend exactement `bpm`. Sinon le simple
   fait de toucher le bouton déplacerait la pulsation.
2. **Le sens est celui qu'on attend** : glisser à droite accélère, à gauche ralentit, pour tout tempo de
   départ dans l'étendue.
3. **La valeur reste dans l'étendue** : pour tout déplacement, même absurde (±10 000 px), le résultat est
   entre `MIN_BPM` et `MAX_BPM` — et atteint ces bornes, sinon une partie de l'étendue serait
   inaccessible.
4. **Le geste est réversible** : revenir à l'origine rend le tempo de départ, au flottant près. Une
   glissière qui dérive au va-et-vient est inutilisable.
5. **La sensibilité est dérivée, pas choisie** : traverser l'étendue complète demande une distance
   nommée, et le test la relie à `MIN_BPM`/`MAX_BPM` plutôt que de recopier un nombre.

### Produit (harnais navigateur)

6. **Glisser sur le bouton change le tempo**, et le libellé visible suit la valeur.
7. **Le tempo change la cadence réelle** : à tempo doublé, une source de même division émet deux fois
   plus sur la même fenêtre — mesuré, pas déduit du libellé.
8. **Ni rafale ni silence au changement** : l'échéance de chaque source reste devant nous et à moins
   d'une période, pendant et après le glissement. C'est la propriété que l'US7 a payée.
9. **Un tap ne change pas le tempo** — il annonce.
10. **Annulable**, comme toute modification de scène.
11. **Le tempo voyage dans le lien** : une scène réglée à un tempo non-défaut se rouvre au même tempo.
12. **375 px** : le bouton reste atteignable et le glissement fonctionne au doigt.

### Non-régression

13. `pnpm check` vert, les **19** scénarios verts — les 18 d'avant plus `tempo` —, et le garde-fou
    de perf dans son budget.

## Risques

- **Voler le geste du bouton.** Un bouton qui glisse ne doit pas cesser d'être cliquable, et le clic ne
  doit pas partir en glissement au moindre tremblement. Seuil de tap à respecter, comme sur le canvas.
- **Un tempo qui saute.** Si la valeur suit la position absolue au lieu du déplacement, le premier pixel
  téléporte la pulsation. C'est la décision ci-dessus, et le critère 1 la garde.
- **Une scène qui crache une rafale.** Changer le tempo pendant que des sources tournent est exactement
  le cas que l'horloge de l'US7 a été écrite pour absorber — mais rien ne l'a encore exercé **depuis
  l'interface**. Critère 8.

## Ce que la vérification a trouvé

Deux **vrais défauts** de la première implémentation, tous deux trouvés par les critères 8 et 11 et
invisibles autrement.

**Une source gardait une échéance périmée après un changement de tempo.** Mesuré : 0,9 s d'attente pour
une période de 0,714 s, soit un silence audible. L'US7 promet qu'un changement de tempo raccroche la
source à la nouvelle grille — mais elle ne le fait qu'à l'**émission suivante**, et l'échéance en attente,
calculée sur l'ancienne grille, peut se retrouver plus loin qu'une période neuve. La promesse ne tenait
donc qu'après la première émission, et personne ne l'avait vu parce qu'aucune interface ne pouvait
changer le tempo. `applyBpm` réarme désormais les sources, comme le fait l'annulation.

**Un lien reçu affichait 96 BPM alors que l'état valait 144.** `applyShared` écrivait `world.bpm`
directement, sans passer par le libellé. C'est mot pour mot la faute de l'US2 — « l'interface annonçait
une gamme que l'instrument ne jouait plus » — et elle s'est reproduite dès qu'un second réglage a eu un
libellé à tenir à jour. Le correctif est de n'avoir **qu'un** chemin d'écriture du tempo.

**Et deux assertions à moi qui ne prouvaient pas ce qu'elles annonçaient.** La première comptait les
billes **vivantes** pour mesurer une cadence : une bille tombe hors champ en moins de deux secondes et le
plafond écrête, donc elle rendait 1 quel que soit le tempo. Elle lit maintenant le compteur de billes
créées. La seconde exigeait « l'échéance est strictement devant nous » : c'était une course, le temps
avançant entre le calcul et la lecture, et la borne juste est symétrique — au plus une période d'écart
dans un sens comme dans l'autre.

**Une assertion voisine cassée par ce travail, et qui avait raison de casser.** Le scénario `timbres`
vérifiait que « les **sept** contrôles tiennent sur deux rangées » : le huitième bouton l'a fait rougir
alors que la mise en page tenait toujours. Une assertion qui compte au lieu de vérifier ce qu'elle
annonce. Le nombre vient maintenant du DOM.

**Une mutation qui a survécu, et le trou qu'elle a révélé.** Retirer le seuil de tap laissait le scénario
vert : `page.click` n'émet aucun mouvement entre l'appui et le relâchement, donc l'assertion ne traversait
jamais le seuil. Le cas réel — un clic avec un tremblement de 5 px — est désormais joué, et la mutation
meurt. (Premier verdict faussé au passage : le scénario plantait sur une erreur de syntaxe, ce qui compte
comme un échec sans rien prouver. Une mutation « tuée » par un plantage de compilation n'est pas tuée.)

### Les cinq mutations

Cœur pur : la valeur suit la position absolue au lieu du déplacement.
Produit : `applyBpm` ne réarme plus les sources · le libellé ne suit plus la valeur · un lien reçu écrit
le tempo sans passer par le libellé · le seuil de tap retiré.

## Ce que la review adverse a trouvé, et que la vérification n'avait pas vu

**Deux bloquants, tous deux invisibles à mes dix assertions.**

*Régler le tempo figeait la scène.* Le glissement posait `userOwnsScene = true`, ce qui désactive la
régénération au redimensionnement — alors que le tempo ne touche **aucune géométrie**. Mesuré : après un
glissement puis un passage de 900 à 375 px, **8 barres sur 9 hors champ** et une sous le HUD, exactement
ce que `barsOutOfBounds` existe pour interdire. Le bouton de gamme, le réglage le plus proche, ne
revendique rien. Correctif : ne rien revendiquer, et tenir la scène liée à jour pour qu'un
redimensionnement ne réapplique pas le tempo du lien par-dessus le réglage.

*La glissière ne marchait pas au doigt.* `touch-action: none` n'existait que sur le canvas, donc le
navigateur reprenait le geste horizontal après une vingtaine de pixels et envoyait `pointercancel` : un
geste de 70 px déplaçait le tempo de 96 à 86 au lieu de 65 — quatre mouvements sur six perdus. Le critère
G12 était donc faux, et l'assertion qui le couvrait (`phoneAfter < phoneBefore`) était un **quota** qui se
contentait d'un tiers du geste. Elle exige maintenant la valeur dérivée de `TEMPO_DRAG_SPAN_PX`.

**Et six assertions qui ne prouvaient pas ce qu'elles annonçaient.**

- « Le geste est réversible » était `f(x, 0) === x` écrit deux fois — le test 1, recopié. Il n'appelait
  jamais la fonction avec un déplacement non nul. Remplacé par la **pureté** (deux moitiés de geste valent
  le geste entier), et la vraie réversibilité — l'origine fixe, qui vit dans `main.ts` — est passée au
  scénario, par un aller-retour.
- Rien ne gardait cette non-dérive : recaler l'origine à chaque mouvement passait **328 tests et 7
  assertions**, alors qu'un aller-retour de 200 px faisait 152 → 78 BPM.
- « Ni rafale ni silence » mesurait 150 ms **après** le relâchement, quand la source a déjà ré-émis et
  raccroché la grille toute seule : retirer le réarmement la laissait verte. Un relevé se fait maintenant
  pointeur **encore enfoncé**, à cinq étapes du geste.
- `period + 0.05` était un nombre déguisé côté large, et `ahead <= 0` était la course que ce même travail
  venait de corriger dans `sources` — deux assertions voisines, traitements opposés. Borne symétrique.
- `slow*2 ± 1` laissait passer une erreur de cadence de 12,5 %. La mesure est déterministe et entière :
  égalité exacte.
- « Annuler restaure le tempo précédent » ne vérifiait que « ça a changé » : restaurer 96 au lieu de la
  bonne valeur passait.

**Un aller-retour consommait une place d'annulation morte** — la régression trouvée en revue de l'US3.
L'instantané est désormais empilé **à la fin**, et seulement si la valeur a changé.

**Et deux commentaires qui affirmaient le contraire du code** : le docblock d'`applyBpm` disait « rien à
resynchroniser » treize lignes au-dessus du code qui resynchronise, et celui de l'assertion du HUD
prétendait que le compte « ne conditionne plus rien » alors que le 7 y était resté en borne basse.

### Les dix mutations

Cœur pur : position absolue au lieu du déplacement.
Produit : `applyBpm` ne réarme plus · le libellé ne suit plus · un lien reçu contourne le libellé · seuil
de tap retiré · scène revendiquée au glissement · origine recalée à chaque mouvement · instantané empilé
sans changement · annulation qui restaure le défaut · `touch-action` retiré du bouton.
