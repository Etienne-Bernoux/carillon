import type { Vec2 } from '../core/types'

/** En dessous de cette distance, le geste est lu comme un tap (lâcher une bille) et non un tracé. */
const TAP_RADIUS = 14

export interface InputHandlers {
  /** premier geste utilisateur de la session : c'est là qu'on déverrouille l'audio */
  onFirstGesture(): void
  onTap(point: Vec2): void
  onBar(a: Vec2, b: Vec2): void
  onDraft(draft: { a: Vec2; b: Vec2 } | null): void
}

export function attachInput(canvas: HTMLCanvasElement, handlers: InputHandlers): () => void {
  let activePointer: number | null = null
  let start: Vec2 | null = null
  let unlocked = false

  function toLocal(event: PointerEvent): Vec2 {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: PointerEvent): void {
    if (activePointer !== null) return
    activePointer = event.pointerId
    start = toLocal(event)
    canvas.setPointerCapture(event.pointerId)
    if (!unlocked) {
      unlocked = true
      handlers.onFirstGesture()
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== activePointer || !start) return
    const current = toLocal(event)
    handlers.onDraft(distance(start, current) > TAP_RADIUS ? { a: start, b: current } : null)
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointer || !start) return
    const end = toLocal(event)
    handlers.onDraft(null)
    if (distance(start, end) > TAP_RADIUS) handlers.onBar(start, end)
    else handlers.onTap(end)
    activePointer = null
    start = null
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== activePointer) return
    handlers.onDraft(null)
    activePointer = null
    start = null
  }

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

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}
