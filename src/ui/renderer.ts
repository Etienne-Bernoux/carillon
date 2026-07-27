import type { GrabKind } from '../core/hit-test'
import { BAR_THICKNESS } from '../core/physics'
import type { Bounds, ImpactEvent, Vec2, World } from '../core/types'
import { hueForMidi } from './notation'

const BG_TOP = '#0b1030'
const BG_BOTTOM = '#04060f'
/** Durée de la traînée derrière une bille, en secondes de simulation. */
const TRAIL_SECONDS = 0.22
const GLOW_MS = 420

interface Ripple {
  x: number
  y: number
  hue: number
  strength: number
  age: number
  ttl: number
}

export interface Effects {
  addImpact(event: ImpactEvent, midi: number, strength: number): void
  advance(dt: number): void
  clear(): void
  readonly ripples: readonly Ripple[]
}

export function createEffects(): Effects {
  const ripples: Ripple[] = []
  return {
    ripples,
    addImpact(event, midi, strength) {
      // Au-delà de ~140 ondes simultanées le gain visuel est nul et le coût réel : on jette les plus vieilles.
      if (ripples.length > 140) ripples.splice(0, ripples.length - 140)
      ripples.push({
        x: event.point.x,
        y: event.point.y,
        hue: hueForMidi(midi),
        strength: Math.min(1, strength),
        age: 0,
        ttl: 0.5 + strength * 0.35,
      })
    },
    advance(dt) {
      let write = 0
      for (let i = 0; i < ripples.length; i++) {
        const r = ripples[i]
        if (!r) continue
        r.age += dt
        if (r.age < r.ttl) ripples[write++] = r
      }
      ripples.length = write
    },
    clear() {
      ripples.length = 0
    },
  }
}

export interface Draft {
  a: Vec2
  b: Vec2
  label: string
}

/** État d'interaction courant : ce que le rendu doit montrer, sans que le monde en sache rien. */
export interface Interaction {
  hoveredBarId: number | null
  hoveredKind: GrabKind | null
  /** barre qui sera supprimée si l'on relâche maintenant — doit se voir avant le relâchement */
  pendingDeleteBarId: number | null
}

export const NO_INTERACTION: Interaction = {
  hoveredBarId: null,
  hoveredKind: null,
  pendingDeleteBarId: null,
}

export interface Renderer {
  resize(): Bounds
  draw(world: World, effects: Effects, draft: Draft | null, interaction: Interaction): void
}

/**
 * Le narrowing d'un `const` ne traverse pas une fonction déclarée (hoisting) : on obtient donc le
 * contexte via un helper au type non-nullable, plutôt que de re-tester dans chaque fonction de dessin.
 */
function require2d(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponible')
  return ctx
}

function makeGlowSprite(hue: number): HTMLCanvasElement {
  const size = 64
  const sprite = document.createElement('canvas')
  sprite.width = size
  sprite.height = size
  const g = require2d(sprite)
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.18, `hsla(${hue}, 100%, 78%, 0.85)`)
  grad.addColorStop(0.45, `hsla(${hue}, 95%, 60%, 0.28)`)
  grad.addColorStop(1, `hsla(${hue}, 95%, 55%, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return sprite
}

/**
 * Un seul calque, **entièrement repeint** à chaque frame, et des traînées **explicites**.
 *
 * Deux approches ont été essayées et jetées avant celle-ci, toutes deux à base de tampon
 * d'accumulation (voile semi-opaque, puis effacement en `destination-out`). Mathématiquement leur
 * résidu tend vers zéro ; en pratique l'arrondi sur 8 bits le bloque à un niveau non nul, donc
 * chaque étiquette de note, chaque onde et chaque traînée restait gravée **définitivement** dans le
 * décor — un voile gris qui s'accumulait toute la session.
 *
 * Garder l'historique de trajectoire supprime le problème par construction : rien ne persiste dans
 * un pixel, tout est redessiné depuis la donnée. Bonus : la longueur de traînée est exprimée en
 * secondes de simulation, donc identique à 60 Hz et à 120 Hz.
 */
export function createRenderer(stage: HTMLCanvasElement): Renderer {
  const base = require2d(stage)

  // Sprites pré-rendus par classe de hauteur : dessiner 200 halos par frame avec shadowBlur
  // coûte des dizaines de ms, un drawImage n'en coûte aucune.
  const sprites = Array.from({ length: 12 }, (_, i) => makeGlowSprite(i * 30))
  /** id de bille → suite de (x, y, temps de simulation), du plus ancien au plus récent */
  const trails = new Map<number, number[]>()
  let bounds: Bounds = { w: stage.clientWidth || 1, h: stage.clientHeight || 1 }
  let backdrop: CanvasGradient | null = null

  function resize(): Bounds {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, stage.clientWidth)
    const h = Math.max(1, stage.clientHeight)
    stage.width = Math.round(w * dpr)
    stage.height = Math.round(h * dpr)
    base.setTransform(dpr, 0, 0, dpr, 0, 0)
    bounds = { w, h }
    backdrop = base.createLinearGradient(0, 0, 0, h)
    backdrop.addColorStop(0, BG_TOP)
    backdrop.addColorStop(1, BG_BOTTOM)
    return bounds
  }

  function drawBars(world: World, interaction: Interaction): void {
    base.lineCap = 'round'
    for (const bar of world.bars) {
      const hue = hueForMidi(bar.midi)
      const sinceHit = (world.time - bar.lastHitAt) * 1000
      const hot = bar.lastHitAt >= 0 && sinceHit < GLOW_MS ? 1 - sinceHit / GLOW_MS : 0

      if (bar.id === interaction.pendingDeleteBarId) {
        drawPendingDelete(bar)
        continue
      }

      if (hot > 0) {
        base.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.14 + hot * 0.3})`
        base.lineWidth = BAR_THICKNESS + 10 + hot * 14
        strokeBar(bar.a, bar.b)
      }

      base.strokeStyle = `hsl(${hue}, ${60 + hot * 30}%, ${44 + hot * 40}%)`
      base.lineWidth = BAR_THICKNESS
      strokeBar(bar.a, bar.b)

      base.strokeStyle = `hsla(0, 0%, 100%, ${0.12 + hot * 0.65})`
      base.lineWidth = 1.6
      strokeBar(bar.a, bar.b)

      if (bar.id === interaction.hoveredBarId) drawGrabHandles(bar, interaction.hoveredKind)
    }
  }

  /**
   * Poignées de préhension au survol. Elles ne sont pas décoratives : sans elles, rien n'indique
   * qu'une extrémité s'attrape pour accorder la barre, et le geste central du produit reste invisible.
   */
  function drawGrabHandles(bar: { a: Vec2; b: Vec2 }, kind: GrabKind | null): void {
    base.strokeStyle = 'rgba(232, 240, 255, 0.55)'
    base.lineWidth = 1.4
    strokeBar(bar.a, bar.b)

    for (const [point, own] of [
      [bar.a, 'endA'],
      [bar.b, 'endB'],
    ] as const) {
      const active = kind === own
      base.beginPath()
      base.arc(point.x, point.y, active ? 8 : 5.5, 0, Math.PI * 2)
      base.fillStyle = active ? 'rgba(255, 255, 255, 0.95)' : 'rgba(232, 240, 255, 0.5)'
      base.fill()
    }
  }

  /** Une suppression doit s'annoncer **avant** le relâchement, sinon elle est vécue comme un accident. */
  function drawPendingDelete(bar: { a: Vec2; b: Vec2 }): void {
    base.save()
    base.setLineDash([7, 6])
    base.strokeStyle = 'rgba(255, 110, 130, 0.9)'
    base.lineWidth = BAR_THICKNESS
    strokeBar(bar.a, bar.b)
    base.restore()
  }

  function strokeBar(a: Vec2, b: Vec2): void {
    base.beginPath()
    base.moveTo(a.x, a.y)
    base.lineTo(b.x, b.y)
    base.stroke()
  }

  function drawRipples(effects: Effects): void {
    base.globalCompositeOperation = 'lighter'
    for (const r of effects.ripples) {
      const p = r.age / r.ttl
      const radius = 6 + p * (34 + r.strength * 62)
      const alpha = (1 - p) * (0.25 + r.strength * 0.55)
      base.strokeStyle = `hsla(${r.hue}, 100%, 72%, ${alpha})`
      base.lineWidth = (1 - p) * (1.5 + r.strength * 3.5)
      base.beginPath()
      base.arc(r.x, r.y, radius, 0, Math.PI * 2)
      base.stroke()
    }
    base.globalCompositeOperation = 'source-over'
  }

  function drawDraft(draft: Draft): void {
    base.save()
    base.setLineDash([9, 7])
    base.strokeStyle = 'rgba(190, 214, 255, 0.75)'
    base.lineWidth = 2
    strokeBar(draft.a, draft.b)
    base.setLineDash([])

    base.fillStyle = 'rgba(190, 214, 255, 0.9)'
    for (const p of [draft.a, draft.b]) {
      base.beginPath()
      base.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
      base.fill()
    }

    base.font = '600 15px ui-sans-serif, system-ui, sans-serif'
    base.textAlign = 'center'
    base.textBaseline = 'bottom'
    const midX = (draft.a.x + draft.b.x) / 2
    const midY = (draft.a.y + draft.b.y) / 2
    const width = base.measureText(draft.label).width + 16
    base.fillStyle = 'rgba(9, 12, 28, 0.8)'
    base.fillRect(midX - width / 2, midY - 30, width, 22)
    base.fillStyle = '#e8f0ff'
    base.fillText(draft.label, midX, midY - 12)
    base.restore()
  }

  function recordTrails(world: World): void {
    for (const ball of world.balls) {
      let points = trails.get(ball.id)
      if (!points) {
        points = []
        trails.set(ball.id, points)
      }
      points.push(ball.pos.x, ball.pos.y, world.time)
      let drop = 0
      while (drop + 3 <= points.length && world.time - (points[drop + 2] ?? 0) > TRAIL_SECONDS) {
        drop += 3
      }
      // On garde toujours au moins deux points, sinon une bille lente n'a plus de traînée du tout.
      if (drop > 0 && points.length - drop >= 6) points.splice(0, drop)
    }
    if (trails.size > world.balls.length) {
      const alive = new Set(world.balls.map((ball) => ball.id))
      for (const id of trails.keys()) {
        if (!alive.has(id)) trails.delete(id)
      }
    }
  }

  function drawBalls(world: World): void {
    base.globalCompositeOperation = 'lighter'
    base.lineCap = 'round'
    base.lineJoin = 'round'

    for (const ball of world.balls) {
      const points = trails.get(ball.id)
      if (points && points.length >= 6) {
        const headX = points[points.length - 3] ?? ball.pos.x
        const headY = points[points.length - 2] ?? ball.pos.y
        const tailX = points[0] ?? headX
        const tailY = points[1] ?? headY
        // Dégradé le long de la traînée : un seul tracé par bille, et un fondu franc vers la queue.
        const gradient = base.createLinearGradient(tailX, tailY, headX, headY)
        gradient.addColorStop(0, `hsla(${ball.hue}, 100%, 70%, 0)`)
        gradient.addColorStop(1, `hsla(${ball.hue}, 100%, 76%, 0.75)`)
        base.strokeStyle = gradient
        base.lineWidth = ball.radius * 1.5
        base.beginPath()
        base.moveTo(tailX, tailY)
        for (let i = 3; i < points.length; i += 3) {
          base.lineTo(points[i] ?? headX, points[i + 1] ?? headY)
        }
        base.stroke()
      }

      const sprite = sprites[Math.round(ball.hue / 30) % 12]
      if (!sprite) continue
      const size = ball.radius * 7
      base.drawImage(sprite, ball.pos.x - size / 2, ball.pos.y - size / 2, size, size)
    }

    base.globalCompositeOperation = 'source-over'
  }

  return {
    resize,
    draw(world, effects, draft, interaction) {
      recordTrails(world)
      if (backdrop) {
        base.fillStyle = backdrop
        base.fillRect(0, 0, bounds.w, bounds.h)
      }
      drawRipples(effects)
      drawBars(world, interaction)
      if (draft) drawDraft(draft)
      drawBalls(world)
    },
  }
}
