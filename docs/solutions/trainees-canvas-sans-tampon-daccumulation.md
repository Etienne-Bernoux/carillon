# Traînées sur canvas : le tampon d'accumulation grave des fantômes

> Issu de l'US1. Symptôme : après quelques secondes d'utilisation, le décor gardait **définitivement**
> des étiquettes de notes fantômes (« Mi6 », « Ré5 »…), des anneaux d'ondes et un voile gris diffus.
> Deux implémentations à base de tampon ont été écrites et jetées avant de comprendre pourquoi.

## Le piège

La recette classique de la traînée de mouvement sur canvas 2D :

```ts
ctx.globalAlpha = 0.26
ctx.fillStyle = backdrop
ctx.fillRect(0, 0, w, h) // « efface » partiellement la frame précédente
```

Mathématiquement, `pixel ← pixel * 0.74 + fond * 0.26` converge vers `fond`. En pratique le canvas
stocke **8 bits par canal** : dès que l'écart au fond descend à un ou deux niveaux, l'arrondi renvoie
la même valeur, et le pixel **se bloque définitivement** quelques niveaux au-dessus du fond.

Conséquence : tout ce qui est dessiné une seule fois — une étiquette pendant un glisser, une onde
d'impact — reste gravé pour la durée de la session. Sur un fond très sombre, un résidu de deux
niveaux est parfaitement visible.

La variante « propre » ne sauve pas la mise : passer les traînées sur un calque transparent effacé
en `destination-out` déplace le problème sur le canal alpha, qui se bloque de la même façon à
`1/255`. Le voile gris revient, juste plus discret — et il continue de s'accumuler spatialement.

## Le vrai correctif : pas de tampon du tout

**Rendre la traînée explicite** : garder l'historique de trajectoire et le redessiner intégralement
à chaque frame, sur un canvas repeint en opaque.

```ts
// id de bille → suite de (x, y, temps de simulation)
const trails = new Map<number, number[]>()

// à chaque frame : on empile la position, on jette les points plus vieux que TRAIL_SECONDS,
// puis on trace une polyligne avec un dégradé transparent → opaque de la queue vers la tête.
```

Ce que ça règle d'un coup :

- **Aucun résidu possible** : rien ne persiste dans un pixel, tout est reconstruit depuis la donnée.
- **Indépendance au framerate** : la longueur s'exprime en *secondes de simulation*, donc identique
  à 60 Hz et à 120 Hz. Un voile à opacité fixe donne au contraire des traînées deux fois plus courtes
  sur un écran 120 Hz — piège dans le piège, qui fait croire que « les traînées ne marchent pas ».
- **Un seul calque** : le tampon imposait un canvas séparé pour isoler ce qui ne devait pas traîner.
- **Coût mesuré négligeable** : un `stroke` avec dégradé par bille, 200 billes, 123 fps tenus.

## Comment repérer le symptôme

Un fantôme de tampon d'accumulation se reconnaît à trois signes :
1. il est **faible mais parfaitement net** (le contour du texte reste lisible) ;
2. il ne disparaît **jamais**, même après plusieurs secondes sans rien dessiner ;
3. il **s'accumule** aux endroits les plus fréquentés de l'écran.

Une capture d'écran suffit à le voir — mais seulement si on **regarde vraiment** la capture au lieu
de se contenter du verdict vert du harnais. Ces fantômes sont passés à travers trois exécutions de
`pnpm shoot` toutes vertes : aucune assertion ne pouvait les attraper.

## Voir aussi

- `src/ui/renderer.ts` — l'implémentation et le commentaire d'invariant
- `docs/solutions/harnais-de-capture-qui-ment-sur-la-perf.md` — l'autre piège du même harnais
