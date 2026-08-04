import { MOUSE_RADII, TOUCH_RADII } from '../core/hit-test'
import type { Grab, HitRadii } from '../core/hit-test'
import type { Vec2 } from '../core/types'

/** En dessous de cette distance, le geste est lu comme un tap et non comme un glisser. */
/** Seuil partagé : au-delà, un geste est un glisser et non un tap. Exporté pour que la glissière de
 * tempo n'en invente pas un second — deux seuils divergeraient. */
export const TAP_RADIUS = 14
/**
 * Durée d'un appui long, en ms. C'est le seul idiome qui pose une source sans introduire de mode et
 * sans voler un geste existant : le tap lâche une bille, le glisser dessine.
 */
export const LONG_PRESS_MS = 500

/**
 * Intentions émises par la couche d'entrée. Le pari de l'US3 est de n'avoir **aucun mode** : ni
 * gomme, ni outil de sélection. Le geste se désambiguïse par *où il commence*, ce qui se lit
 * directement ici — `grab` n'existe que si le geste a démarré sur une barre.
 */
export type Gesture =
  | { type: 'hover'; hit: Grab | null }
  /**
   * Position du pointeur **libre** (aucun bouton enfoncé), à chaque mouvement.
   *
   * `hover` ne suffit pas : il n'est émis qu'au **changement de cible**, donc promener la souris dans
   * un choix radial ouvert ne produisait aucun événement et rien ne se mettait en évidence. Le coût
   * d'un événement par mouvement est assumé ici parce que son gestionnaire sort immédiatement quand
   * rien n'est ouvert — c'est `hover` qui reconstruit un état, pas celui-ci.
   */
  | { type: 'pointer-move'; point: Vec2 }
  | { type: 'draft'; a: Vec2; b: Vec2 }
  | { type: 'draft-cancel' }
  | { type: 'create-bar'; a: Vec2; b: Vec2 }
  | { type: 'drop-ball'; point: Vec2 }
  /**
   * Appui long. Dans le vide, il pose une source ; sur une barre, il change sa nature. `hit` dit sur
   * quoi, et c'est le gestionnaire qui décide — le calque d'entrée ne connaît aucun de ces deux
   * concepts.
   */
  | { type: 'long-press'; point: Vec2; hit: Grab | null }
  /**
   * Le pointeur bouge **après** qu'un appui long a agi. Émis pour qu'un choix radial puisse se viser
   * dans le même geste que l'ouverture, sans que ce calque sache qu'une roue existe : il ne dit que
   * « l'appui long continue, ici ». Jusqu'ici le mouvement était purement supprimé après un appui long.
   */
  | { type: 'long-press-move'; point: Vec2 }
  /**
   * Fin de cet appui long, avec **où** il se termine. C'est ce point qui décide, et lui seul —
   * `release` ne le porte que pour les barres, et `drop-ball` n'est pas émis dans ce cas.
   */
  | { type: 'long-press-end'; point: Vec2; cancelled: boolean }
  /**
   * Premier contact **tactile** de la session. Il n'existe pas de survol au doigt, donc les poignées
   * d'extrémité — la seule chose qui annonce qu'une barre s'attrape et s'accorde — n'apparaissaient
   * jamais sur téléphone. Le geste central du produit n'était découvrable qu'à la souris.
   */
  | { type: 'touch-hint' }
  | { type: 'grab'; hit: Grab }
  | { type: 'drag'; hit: Grab; point: Vec2; delta: Vec2 }
  /**
   * `cancelled` : le système a repris le pointeur, l'utilisateur n'a rien décidé.
   * `handled` : un geste a **déjà** agi pendant cet appui (un appui long), donc le relâchement ne doit
   * rien décider de plus. Distingué de `cancelled`, qui veut dire l'inverse — personne n'a décidé.
   */
  | { type: 'release'; hit: Grab; point: Vec2; cancelled: boolean; handled: boolean }
  /**
   * Relâchement sans mouvement sur une cible — barre **ou** source. Porte son point : un choix radial
   * épinglé se décide au tap, et le gestionnaire doit savoir **où**, pas seulement sur quoi.
   */
  | { type: 'tap'; hit: Grab; point: Vec2 }

export interface InputHandlers {
  /** premier geste de la session : c'est là qu'on déverrouille l'audio */
  onFirstGesture(): void
  /** L'entrée ne connaît pas le monde : elle demande ce qui se trouve sous le point. */
  hitTest(point: Vec2, radii: HitRadii): Grab | null
  onGesture(gesture: Gesture): void
}

/**
 * Clé d'identité du survol : c'est elle qui évite de réémettre un `hover` à chaque pixel parcouru. Une
 * fonction plutôt qu'une expression ternaire, parce qu'une troisième nature de cible a suffi à rendre
 * le ternaire faux.
 */
function hoverKey(hit: Grab): string {
  if (hit.target === 'bar') return `bar${hit.bar.id}:${hit.kind}`
  if (hit.target === 'emitter') return `emit${hit.emitter.id}`
  return `drop${hit.dropper.id}`
}

export function attachInput(canvas: HTMLCanvasElement, handlers: InputHandlers): () => void {
  let activePointer: number | null = null
  let start: Vec2 | null = null
  let last: Vec2 | null = null
  let grabbed: Grab | null = null
  let moved = false
  let unlocked = false
  let hoveredKey = ''
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressFired = false
  let touchHinted = false

  function cancelLongPress(): void {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  function toLocal(event: PointerEvent): Vec2 {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function radiiFor(event: PointerEvent): HitRadii {
    // Un doigt est plus gros et moins précis qu'un curseur : sans rayon dédié, rien n'est attrapable.
    return event.pointerType === 'touch' ? TOUCH_RADII : MOUSE_RADII
  }

  function onPointerDown(event: PointerEvent): void {
    if (activePointer !== null) return
    activePointer = event.pointerId
    start = toLocal(event)
    last = start
    moved = false
    grabbed = handlers.hitTest(start, radiiFor(event))
    canvas.setPointerCapture(event.pointerId)

    if (!unlocked) {
      unlocked = true
      handlers.onFirstGesture()
    }
    if (event.pointerType === 'touch' && !touchHinted) {
      touchHinted = true
      handlers.onGesture({ type: 'touch-hint' })
    }
    if (grabbed) handlers.onGesture({ type: 'grab', hit: grabbed })

    /*
     * Appui long dans le vide **ou sur une barre**. Sur une source, non : taper une source change déjà
     * son rythme, et un second idiome sur la même cible serait du bruit.
     *
     * Le relâchement qui suit ne doit surtout pas faire sonner la barre par-dessus — c'est le « vol du
     * geste d'écoute » que cette fonction refusait jusqu'ici. D'où `handled` sur le `release`.
     */
    if (grabbed?.target === 'emitter') return

    longPressFired = false
    const origin = start
    const target = grabbed
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      if (moved || activePointer === null) return
      longPressFired = true
      handlers.onGesture({ type: 'long-press', point: origin, hit: target })
    }, LONG_PRESS_MS)
  }

  function onPointerMove(event: PointerEvent): void {
    const point = toLocal(event)

    if (event.pointerId !== activePointer || !start || !last) {
      if (event.pointerType === 'touch') return
      handlers.onGesture({ type: 'pointer-move', point })
      // Survol : on ne réémet que sur changement, sinon c'est un événement par pixel parcouru.
      const hit = handlers.hitTest(point, radiiFor(event))
      // Clé d'identité du survol, valable pour les deux natures de cible : c'est elle qui évite de
      // réémettre un `hover` à chaque pixel parcouru.
      const key = hit ? hoverKey(hit) : ''
      if (key !== hoveredKey) {
        hoveredKey = key
        handlers.onGesture({ type: 'hover', hit })
      }
      return
    }

    if (!moved && Math.hypot(point.x - start.x, point.y - start.y) > TAP_RADIUS) {
      moved = true
      // Un vrai mouvement annule l'appui long : un doigt qui tremble ne doit pas empêcher la
      // création, mais un glisser franc ne doit pas la déclencher.
      cancelLongPress()
    }
    /*
     * Un appui long a déjà agi : le pointeur reste **suivi** — c'est ce qui permet de viser dans un
     * choix radial sans relever le doigt — mais il n'y a ni glisser ni aperçu de barre, qui
     * mentiraient sur ce que le relâchement va produire.
     *
     * Placé avant le seuil de tap, exprès : la visée doit être continue dès le premier pixel, sinon
     * rien ne réagit tant qu'on n'a pas dépassé le rayon de tap.
     */
    if (longPressFired) {
      handlers.onGesture({ type: 'long-press-move', point })
      last = point
      return
    }

    if (!moved) return

    if (grabbed) {
      handlers.onGesture({
        type: 'drag',
        hit: grabbed,
        point,
        delta: { x: point.x - last.x, y: point.y - last.y },
      })
    } else {
      handlers.onGesture({ type: 'draft', a: start, b: point })
    }
    last = point
  }

  function finish(event: PointerEvent, cancelled: boolean): void {
    if (event.pointerId !== activePointer || !start || !last) return
    cancelLongPress()
    const point = cancelled ? last : toLocal(event)

    /*
     * Émis **avant** `release` / `draft-cancel` : c'est ce geste qui décide, les autres ne font que
     * remettre à zéro la mise en évidence. L'ordre inverse fermerait la visée avant de la lire.
     */
    if (longPressFired) handlers.onGesture({ type: 'long-press-end', point, cancelled })

    if (grabbed) {
      // Toujours un `release`, y compris interrompu : c'est lui qui remet à zéro la mise en évidence
      // et la zone de glisser. Sans ça, une interruption laissait la barre surlignée indéfiniment.
      if (moved || cancelled || longPressFired) {
        handlers.onGesture({
          type: 'release',
          hit: grabbed,
          point,
          cancelled,
          handled: longPressFired,
        })
      } else {
        handlers.onGesture({ type: 'tap', hit: grabbed, point })
      }
    } else {
      handlers.onGesture({ type: 'draft-cancel' })
      // Un appui long a déjà agi : le relâchement ne doit pas lâcher une bille par-dessus.
      if (!cancelled && !longPressFired) {
        if (moved) handlers.onGesture({ type: 'create-bar', a: start, b: point })
        else handlers.onGesture({ type: 'drop-ball', point })
      }
    }

    activePointer = null
    start = null
    last = null
    grabbed = null
    moved = false
    // Sans cette remise à zéro, le pointeur resté sur la barre recalcule la même clé de survol que
    // celle d'avant le geste : aucun `hover` n'est réémis, et les poignées restent éteintes jusqu'à
    // ce qu'on quitte la barre et qu'on y revienne.
    hoveredKey = ''
  }

  const onPointerUp = (event: PointerEvent): void => finish(event, false)
  const onPointerCancel = (event: PointerEvent): void => finish(event, true)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)

  return () => {
    cancelLongPress()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
  }
}
