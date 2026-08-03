# Un recadrage déplace aussi le repère d'interaction

**Payé le** 2026-07-30, US16 (la roue de sélection). Trouvé en **regardant une capture** : les douze
assertions du scénario étaient vertes.

## Le symptôme

Une roue radiale s'ouvre à l'appui long, avec trois issues au relâchement : dans un secteur elle
applique, au-delà de l'anneau elle annule, dans la **zone morte centrale** elle s'épingle. La zone morte
existe pour le geste le plus probable de quelqu'un qui découvre — appuyer long, relâcher sans bouger.

Près d'un bord de l'écran, ce geste **appliquait une option**. Pas celle qu'on voulait : celle vers
laquelle le hasard de la géométrie pointait.

## La cause

La roue est recadrée pour tenir entièrement dans la scène (`fitWheel`) : ouverte à 90 px du bord gauche
alors qu'elle a 104 px de rayon, elle est poussée vers l'intérieur. Son centre n'est **plus sous le
doigt** — il est à 62 px de lui.

Or « la zone morte » était calculée depuis le centre du **dessin**. Le doigt immobile, à 62 px du centre
recadré, tombait donc dans l'anneau, à l'intérieur d'un secteur. Le relâchement lisait un choix.

Tant que la roue s'ouvre **sous** le doigt, « centre du dessin » et « origine du geste » sont le même
point. Deux notions distinctes, confondues par un cas particulier — et qui divergent exactement là où le
recadrage agit, c'est-à-dire là où on ne regarde pas.

## Le correctif

La zone morte se mesure depuis l'**origine du geste**, pas depuis le centre du dessin :

```ts
// Un geste qui n'a jamais quitté son origine n'a rien visé : il épingle.
const aim = openWheel.committed ? sectorAt(openWheel.wheel, point) : { kind: 'pin' } as const
```

`committed` devient vrai dès que le pointeur s'est éloigné de son origine de plus que le rayon
intérieur. Tant qu'il ne l'est pas, rien n'est visé — **et rien ne s'affiche comme visé**, sinon la roue
annoncerait un choix que le relâchement ne ferait pas.

## Ce que ça généralise

**Un widget qu'on repositionne pour qu'il tienne à l'écran garde un repère d'interaction ancré sur le
geste, pas sur le dessin.** La règle vaut au-delà d'une roue : menu contextuel poussé pour ne pas
déborder, infobulle retournée près d'un bord, popover recadré. Dès qu'un recadrage existe, se demander
**quelles distances et quels seuils étaient mesurés depuis un point qui vient de bouger**.

Corollaire de vérification : le cas nominal (au centre) et le cas recadré (au bord) sont **deux
comportements**, pas un comportement à deux positions. Un scénario qui n'exerce que le centre ne dit
rien du bord — et l'assertion « la roue tient dans l'écran », qui elle passait, ne dit rien de ce que le
geste **décide** dans cette position.

## L'assertion qui manquait — et la première version, creuse

Premier jet, écrit juste après le correctif :

```js
// Le doigt est resté au milieu de la barre, que `fitWheel` a laissée hors du centre de la roue.
const pointerInSector = Math.abs(wheel.centerX - 90) > 26
await page.mouse.up()   // ← aucun mouvement de pointeur
// La roue doit être épinglée, et la nature inchangée.
```

**Elle ne testait rien.** Une review adverse l'a montré en remettant le bug : remesurer la zone morte
depuis le centre du dessin laissait les **douze** assertions vertes. Parce que sans mouvement de
pointeur, `aimWheel` — la fonction qui porte le garde — n'est **jamais appelée** : `committed` reste
faux, et `resolveWheel` épingle quoi qu'il arrive. L'assertion testait la conséquence par un chemin qui
contourne la cause.

Version qui tient :

```js
// Un micro-mouvement SOUS le seuil : c'est lui qui fait passer par le garde.
await page.mouse.move(90 + 8, 300, { steps: 2 })
const aim = await page.evaluate(() => window.__carillon.stats().wheel?.aimKind)
// Rien n'est visé — alors que le point est géométriquement dans un secteur.
await page.mouse.up()
```

Mutation qui la valide : remesurer depuis le centre du dessin → l'assertion rougit, `visée=sector` puis
`nature=wall->ephemeral`, soit exactement le défaut d'origine.

**Règle générale : une assertion écrite pour un correctif doit exercer le chemin que le correctif a
ajouté.** Ici le correctif vivait dans `aimWheel` et l'assertion n'appelait jamais `aimWheel` — le genre
de trou qu'aucune relecture du test ne montre, et qu'une mutation montre en une exécution.

## Voir aussi

- `docs/solutions/tester-la-propriete-pas-son-proxy.md` — la même famille : l'assertion mesurait un
  proxy (la roue est visible) plutôt que la propriété (le geste décide ce qu'il annonce).
- `docs/solutions/effet-present-dans-letat-invisible-a-lecran.md` — l'autre sens du même écart entre
  l'état et ce que l'œil constate.
