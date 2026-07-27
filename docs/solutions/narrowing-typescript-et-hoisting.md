# Le narrowing d'un `const` ne traverse pas une fonction déclarée

> Issu de l'US1 : **55 erreurs** `TS18047: 'ctx' is possibly 'null'` dans un seul fichier, alors que
> le `null` était déjà écarté trois lignes plus haut.

## Le symptôme

```ts
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('Canvas 2D indisponible')

function drawBars(world: World): void {
  ctx.lineCap = 'round' // TS18047: 'ctx' is possibly 'null'
}
```

Le garde est là, `ctx` est un `const`, et pourtant TypeScript le voit encore nullable — mais
uniquement **dans les fonctions déclarées** (`function foo() {}`), pas dans le code qui suit
directement le garde.

## La cause

Une **déclaration de fonction est hoistée** : elle peut être appelée avant la ligne du garde.
TypeScript ne peut donc pas supposer que le garde a déjà tourné au moment de l'appel, et il
réinitialise le narrowing à l'intérieur du corps. Ce n'est pas un bug d'inférence, c'est une
conséquence correcte du hoisting.

## Le mauvais réflexe

Ajouter `ctx!` sur 55 lignes, ou un `if (!ctx) return` dans chaque fonction de dessin. Les deux
traitent le symptôme : la variable **n'est pas** nullable à ce stade, c'est son *type* qui l'est.

## Le correctif à la source

Rendre le type honnête une fois pour toutes, avec un helper dont la signature de retour est
non-nullable :

```ts
function require2d(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponible')
  return ctx
}

const ctx = require2d(canvas) // CanvasRenderingContext2D, plus aucun narrowing à propager
```

Zéro assertion, zéro `!`, et le helper se réutilise pour chaque canvas hors-écran créé ensuite.

## Généralisation

Dès qu'un narrowing doit être **partagé par plusieurs fonctions**, ce n'est pas un narrowing qu'il
faut, c'est un **type d'entrée correct**. Le pattern s'applique tel quel à
`document.querySelector`, `process.env.X`, ou n'importe quel accès à une API qui retourne
`T | null` alors que l'absence est un cas d'échec fatal et non un cas métier.
