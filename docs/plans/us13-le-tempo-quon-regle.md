# US13 — Le tempo qu'on règle

> Statut : **en cours** · Branche `feat/us13-tempo`

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

13. `pnpm check` vert, les 18 scénarios verts, et le garde-fou de perf dans son budget.

## Risques

- **Voler le geste du bouton.** Un bouton qui glisse ne doit pas cesser d'être cliquable, et le clic ne
  doit pas partir en glissement au moindre tremblement. Seuil de tap à respecter, comme sur le canvas.
- **Un tempo qui saute.** Si la valeur suit la position absolue au lieu du déplacement, le premier pixel
  téléporte la pulsation. C'est la décision ci-dessus, et le critère 1 la garde.
- **Une scène qui crache une rafale.** Changer le tempo pendant que des sources tournent est exactement
  le cas que l'horloge de l'US7 a été écrite pour absorber — mais rien ne l'a encore exercé **depuis
  l'interface**. Critère 8.
