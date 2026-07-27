import { MOUSE_RADII, TOUCH_RADII } from '../core/hit-test'
import type { BarHit, HitRadii } from '../core/hit-test'
import type { Vec2 } from '../core/types'

/** En dessous de cette distance, le geste est lu comme un tap et non comme un glisser. */
const TAP_RADIUS = 14

/**
 * Intentions émises par la couche d'entrée. Le pari de l'US3 est de n'avoir **aucun mode** : ni
 * gomme, ni outil de sélection. Le geste se désambiguïse par *où il commence*, ce qui se lit
 * directement ici — `grab` n'existe que si le geste a démarré sur une barre.
 */
export type Gesture =
  | { type: 'hover'; hit: BarHit | null }
  | { type: 'draft'; a: Vec2; b: Vec2 }
  | { type: 'draft-cancel' }
  | { type: 'create-bar'; a: Vec2; b: Vec2 }
  | { type: 'drop-ball'; point: Vec2 }
  | { type: 'grab'; hit: BarHit }
  | { type: 'drag'; hit: BarHit; point: Vec2; delta: Vec2 }
  /** `cancelled` : le système a repris le pointeur, l'utilisateur n'a rien décidé. */
  | { type: 'release'; hit: BarHit; point: Vec2; cancelled: boolean }
  | { type: 'tap-bar'; hit: BarHit }

export interface InputHandlers {
  /** premier geste de la session : c'est là qu'on déverrouille l'audio */
  onFirstGesture(): void
  /** L'entrée ne connaît pas le monde : elle demande ce qui se trouve sous le point. */
  hitTest(point: Vec2, radii: HitRadii): BarHit | null
  onGesture(gesture: Gesture): void
}

export function attachInput(canvas: HTMLCanvasElement, handlers: InputHandlers): () => void {
  let activePointer: number | null = null
  let start: Vec2 | null = null
  let last: Vec2 | null = null
  let grabbed: BarHit | null = null
  let moved = false
  let unlocked = false
  let hoveredKey = ''

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
    if (grabbed) handlers.onGesture({ type: 'grab', hit: grabbed })
  }

  function onPointerMove(event: PointerEvent): void {
    const point = toLocal(event)

    if (event.pointerId !== activePointer || !start || !last) {
      if (event.pointerType === 'touch') return
      // Survol : on ne réémet que sur changement, sinon c'est un événement par pixel parcouru.
      const hit = handlers.hitTest(point, radiiFor(event))
      const key = hit ? `${hit.bar.id}:${hit.kind}` : ''
      if (key !== hoveredKey) {
        hoveredKey = key
        handlers.onGesture({ type: 'hover', hit })
      }
      return
    }

    if (!moved && Math.hypot(point.x - start.x, point.y - start.y) > TAP_RADIUS) moved = true
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
    const point = cancelled ? last : toLocal(event)

    if (grabbed) {
      // Toujours un `release`, y compris interrompu : c'est lui qui remet à zéro la mise en évidence
      // et la zone de glisser. Sans ça, une interruption laissait la barre surlignée indéfiniment.
      if (moved || cancelled) {
        handlers.onGesture({ type: 'release', hit: grabbed, point, cancelled })
      } else {
        handlers.onGesture({ type: 'tap-bar', hit: grabbed })
      }
    } else {
      handlers.onGesture({ type: 'draft-cancel' })
      if (!cancelled) {
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
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
  }
}
