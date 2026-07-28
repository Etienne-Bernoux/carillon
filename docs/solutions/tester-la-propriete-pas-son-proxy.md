# Tester la propriété produit, pas son proxy technique

> Issu de l'US2. Un test vert intitulé « fait varier les longueurs, **sinon tout l'écran sonnerait la
> même note** » couvrait une scène qui ne jouait que **4 hauteurs sur 15 possibles**. Le test n'était
> pas faux : il mesurait juste autre chose que ce que son nom promettait.

## Le mécanisme du piège

Le test assertait `new Set(longueurs.map(l => Math.round(l / 10))).size >= 5` : cinq longueurs
distinctes au pixel près. Vrai, et sans rapport avec la propriété visée. Entre la longueur et la
hauteur, il y a un **mapping non injectif** : `midiForLength` projette une plage continue de
longueurs sur ~15 degrés de gamme. Cinq longueurs différentes peuvent parfaitement tomber dans le
même degré.

Le proxy (« les longueurs varient ») était **corrélé** à la propriété (« les hauteurs varient») sans
lui être équivalent. C'est exactement la condition pour qu'un test rassure sans protéger.

Coût réel : le défaut a survécu à une US complète, à une revue de code indépendante, et il a fallu
**regarder une capture d'écran de téléphone** — deux couleurs seulement, la couleur encodant la
classe de hauteur — pour le voir.

## La règle

**Un test doit asserter la propriété nommée dans son intitulé, en passant par le vrai chemin de
calcul.** Si l'intitulé parle de notes, l'assertion doit appeler la fonction qui produit les notes.

Le test correct fait exactement ça — il traverse la génération de scène *et* le mapping musical :

```ts
const midis = collect(bounds, seed).map(([a, b]) =>
  midiForLength(Math.hypot(b.x - a.x, b.y - a.y), tuning, bounds.w),
)
expect(new Set(midis).size).toBeGreaterThanOrEqual(5)
```

Deux modules traversés, donc ce n'est plus un test « unitaire » au sens strict. C'est le prix, et il
est dérisoire : c'est le seul endroit où la propriété existe. Une propriété qui n'émerge que de la
composition de deux modules ne peut pas être vérifiée en les testant séparément.

## Signaux pour repérer un proxy

- L'intitulé contient un **« sinon… »** ou un **« donc… »** : la conséquence énoncée n'est
  généralement pas ce qui est asserté. C'était le cas ici mot pour mot.
- L'assertion porte sur une grandeur **intermédiaire** (pixels, octets, nombre d'appels) alors que
  l'intitulé parle du **résultat** (note, couleur, texte affiché).
- Le test ne référence aucune fonction du domaine dont il parle. Un test qui prétend parler de
  musique et n'importe rien de `music.ts` est suspect par construction.

## Corollaire : ne pas se contenter de renommer

Quand on trouve un proxy, il y a deux gestes, et il faut faire **les deux** :
1. écrire le test qui vérifie vraiment la propriété (ici le bloc `B3`) ;
2. **renommer** l'ancien test pour qu'il décrive ce qu'il mesure réellement (« fait varier les
   longueurs au pixel »), et dire en commentaire pourquoi.

Sans le point 2, le prochain lecteur croira la propriété couverte deux fois.

## Et le correctif produit, tant qu'on y est

Le défaut de fond n'était pas dans le mapping mais dans le **générateur** : ses longueurs tenaient
toutes dans une plage de 1,6:1, donc aucune fonction de mapping ne pouvait en tirer de la richesse.
Corrigé en **stratifiant** les longueurs (chaque barre reçoit une longueur cible répartie sur toute
l'étendue, puis on mélange) plutôt qu'en tirant chaque longueur indépendamment : la richesse devient
une propriété *par construction* et non *en moyenne*. Avec 9 barres sur un téléphone, le tirage
indépendant donnait 3 hauteurs sur les graines malchanceuses.

## Le piège se rejoue dans la preuve du correctif

Ironie mesurée : la preuve navigateur écrite pour valider ce correctif était **elle-même** un proxy
creux. Pour montrer qu'un changement de gamme réaccorde les barres, elle comparait deux captures
d'écran plein cadre :

```js
const avant = await page.screenshot()
await page.click('[data-control="tuning"]')
const apres = await page.screenshot()
rec.assert('les barres sont réaccordées', !avant.equals(apres))
```

Sauf que le clic laisse le bouton **survolé**, et `.toolbar button:hover` change sa couleur avec une
transition de 140 ms. Les deux captures diffèrent donc *toujours*, réaccordage ou pas. Une assertion
qui ne peut pas échouer est pire qu'absente : elle occupe la place d'un contrôle.

Deux gestes pour en sortir :

1. **Cadrer la capture sur ce qu'on prétend observer** — ici la seule zone de jeu, HUD exclu
   (`page.screenshot({ clip })`). Tout ce qui reste dans le cadre est une source de faux positif.
2. **Prouver que la preuve peut échouer** — test de mutation : neutraliser volontairement le
   comportement (`retuneBars` mis hors service), relancer, vérifier que l'assertion **rougit**, puis
   restaurer. Sans cette étape, on ne sait pas si l'assertion contraint quoi que ce soit.

Le point 2 est la seule façon de distinguer un test vert d'un test creux. Il coûte trois minutes et
devrait être systématique sur toute assertion de type « ça a changé » ou « ça diffère ».

## Le test de mutation laisse un résidu que le gate ne voit pas

Le test de mutation est indispensable (cf. section précédente), mais il crée un risque neuf : le code
neutralisé doit être restauré, et rien ne le garantit. Vécu en US3 — un résidu de la forme :

```ts
// MUTATION-TEST-TEMPORAIRE : neutralise le déplacement
void dx
void dy
```

a survécu à `pnpm check`. Non par malchance : `void x` est **exactement** l'écriture qui fait taire
`noUnusedLocals`. Le résidu était donc invisible au seul garde-fou automatique du projet, et les
captures de preuve archivées ensuite décrivaient un code qui n'existait plus.

Trois règles qui en découlent :

1. **Après tout test de mutation, `git diff` sur le fichier touché doit être vide.** C'est la seule
   vérification qui ne dépend pas de la forme du résidu.
2. **Les preuves doivent être postérieures au code.** Comparer les horodatages (`stat -f "%Sm %N"`)
   avant de clôturer une US coûte une commande et attrape la classe entière de ce défaut.
3. **Greper les marqueurs** (`MUTATION`, `TEMPORAIRE`, `void d`) avant commit — utile, mais c'est le
   filet le plus faible des trois, puisqu'il suppose qu'on a pensé à laisser un marqueur.

## Ce qui rend une comparaison d'images creuse évolue avec le produit

Une assertion par comparaison de captures peut être **valide un jour et creuse le lendemain**, sans
qu'une seule ligne du test ne change. Vécu deux fois sur le même projet :

1. d'abord l'état `:hover` du bouton cliqué faisait différer les deux images ;
2. puis, quand le produit a gagné des sources qui lâchent des billes en continu, **la scène elle-même
   bouge** : deux captures diffèrent toujours, quoi qu'on teste.

La leçon n'est pas « cadrer mieux la capture » — c'est que **comparer des pixels pour prouver un
changement d'état est fragile par nature**. Dès qu'une propriété est observable autrement, il faut
l'asserter directement. Ici l'API de debug exposait déjà les hauteurs des barres : l'assertion est
devenue « 8 barres sur 15 ont changé de hauteur » au lieu de « les deux images diffèrent », et le test
de mutation donne 0 sur 15 quand on neutralise le réaccordage.

Corollaire : **rejouer le test de mutation après chaque changement de produit qui rend la scène plus
vivante**. Le risque était écrit noir sur blanc dans le plan de l'US concernée, et c'est le test de
mutation — pas la relecture — qui a confirmé qu'il s'était réalisé.

## Restaurer une mutation : jamais avec `git checkout --`

Le fichier muté portait du travail **non commité**. `git checkout -- src/main.ts` l'a ramené à `HEAD`,
effaçant d'un coup tout le câblage de l'US en cours. Le bon geste :

```bash
cp src/main.ts "$TMPDIR/avant-mutation.ts"   # avant de muter
# ... muter, lancer, observer l'échec attendu ...
cp "$TMPDIR/avant-mutation.ts" src/main.ts    # restaurer depuis la copie
```

`git checkout --` ne restaure pas « l'état d'avant la mutation », il restaure « l'état du dernier
commit ». Les deux ne coïncident que si l'on vient de commiter.

## Voir aussi

- `docs/solutions/harnais-de-capture-qui-ment-sur-la-perf.md` — même famille de piège, côté harnais :
  l'intitulé d'une assertion n'est pas son contrat
