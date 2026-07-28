import type { Ball, Bar, Bounds, ImpactEvent, Vec2, World } from './types'
import { dot, len2, normalize, perp, sub } from './vec'

export const DT = 1 / 120
export const DEFAULT_GRAVITY: Vec2 = { x: 0, y: 1400 }

/** Sous ce seuil de vitesse normale (px/s), on considère la bille au repos : pas de rebond. */
const REST_SPEED_THRESHOLD = 25
/** Décollement de la surface après impact, pour ne pas re-toucher au même point (px). */
const SEPARATION_EPS = 0.01
/** Friction tangentielle appliquée à chaque impact. */
const TANGENT_FRICTION = 0.02
/** Garde-fou anti-boucle infinie : au plus 4 impacts résolus par bille et par pas. */
const MAX_IMPACTS_PER_STEP = 4
/** Marges de sortie de scène (px), cf. contrat US1. */
const BOTTOM_MARGIN = 200
const SIDE_MARGIN = 200
const DEFAULT_RESTITUTION = 0.8
const DEFAULT_RADIUS = 8
/** Largeur visuelle d'une barre (px) ; source de vérité unique, importée par le rendu. */
export const BAR_THICKNESS = 7

export interface SweepHit {
  t: number
  point: Vec2
  normal: Vec2
}

/**
 * Intersection rayon/capsule : le segment [a,b] gonflé du rayon r. Teste le flanc (les deux
 * faces de la bande) et les deux extrémités (cercles de rayon r en a et b), retient le plus
 * petit t dans [0, dt]. La normale est unitaire, orientée vers le côté d'où arrive la bille
 * (dot(normal, v) < 0 à l'impact).
 */
export function sweepCircleSegment(
  p0: Vec2,
  v: Vec2,
  r: number,
  a: Vec2,
  b: Vec2,
  dt: number,
): SweepHit | null {
  let best: SweepHit | null = null

  const ab = sub(b, a)
  const abLen2 = len2(ab)

  if (abLen2 > 1e-9) {
    const abLen = Math.sqrt(abLen2)
    const n: Vec2 = { x: -ab.y / abLen, y: ab.x / abLen }
    const d0 = dot(sub(p0, a), n)
    const vn = dot(v, n)

    let hitT: number | null = null
    let outward: Vec2 | null = null

    if (d0 >= r && vn < 0) {
      const t = (r - d0) / vn
      if (t >= 0 && t <= dt) {
        hitT = t
        outward = n
      }
    } else if (d0 <= -r && vn > 0) {
      const t = (-r - d0) / vn
      if (t >= 0 && t <= dt) {
        hitT = t
        outward = { x: -n.x, y: -n.y }
      }
    } else if (Math.abs(d0) < r) {
      // Centre déjà dans la bande (barre dessinée sur une bille en vol, ou interstice sous 2r à
      // un croisement de barres à angle faible) : même garde que sweepCircleEndpoint — impact à
      // t=0 seulement si la bille s'enfonce encore côté outward, sinon on piégerait une bille qui
      // s'en écarte déjà.
      const side: Vec2 = d0 >= 0 ? n : { x: -n.x, y: -n.y }
      if (dot(v, side) < 0) {
        hitT = 0
        outward = side
      }
    }

    if (hitT !== null && outward !== null) {
      const px = p0.x + v.x * hitT
      const py = p0.y + v.y * hitT
      const s = ((px - a.x) * ab.x + (py - a.y) * ab.y) / abLen2
      if (s >= 0 && s <= 1) {
        best = {
          t: hitT,
          point: { x: px - outward.x * r, y: py - outward.y * r },
          normal: outward,
        }
      }
    }
  }

  const capA = sweepCircleEndpoint(p0, v, r, a, dt)
  if (capA && (!best || capA.t < best.t)) best = capA
  const capB = sweepCircleEndpoint(p0, v, r, b, dt)
  if (capB && (!best || capB.t < best.t)) best = capB

  return best
}

function sweepCircleEndpoint(p0: Vec2, v: Vec2, r: number, c: Vec2, dt: number): SweepHit | null {
  const rel = sub(p0, c)
  const relLen2 = len2(rel)
  const C = relLen2 - r * r

  if (C <= 0) {
    // Recouvrement déjà présent (barre tracée sur la bille, ou reliquat d'un impact rasant).
    // On ne le traite comme un impact que si la bille s'enfonce encore : sinon on inverserait une
    // vitesse sortante et la bille resterait piégée à crépiter contre le bout de la barre.
    if (dot(rel, v) >= 0) return null
    const normal = relLen2 > 1e-12 ? normalize(rel) : { x: 0, y: -1 }
    return { t: 0, point: { x: p0.x - normal.x * r, y: p0.y - normal.y * r }, normal }
  }

  const A = len2(v)
  if (A < 1e-9) return null

  const B = 2 * dot(rel, v)
  const disc = B * B - 4 * A * C
  if (disc < 0) return null

  const t = (-B - Math.sqrt(disc)) / (2 * A)
  if (t < 0 || t > dt) return null

  const px = p0.x + v.x * t
  const py = p0.y + v.y * t
  const normal = normalize({ x: px - c.x, y: py - c.y })
  // À l'instant du contact, le centre est exactement à distance r de c : cette formule vaut c,
  // comme avant. On la garde identique à la branche de recouvrement pour une seule et même
  // définition du point de contact (surface, pas le coin de la barre).
  return { t, point: { x: px - normal.x * r, y: py - normal.y * r }, normal }
}

export function createWorld(bounds: Bounds): World {
  return {
    balls: [],
    bars: [],
    emitters: [],
    gravity: { x: DEFAULT_GRAVITY.x, y: DEFAULT_GRAVITY.y },
    bounds,
    time: 0,
    nextBallId: 0,
    nextBarId: 0,
    nextEmitterId: 0,
  }
}

export function addBar(world: World, a: Vec2, b: Vec2, midi: number, restitution?: number): Bar {
  const bar: Bar = {
    id: world.nextBarId++,
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
    restitution: restitution ?? DEFAULT_RESTITUTION,
    midi,
    lastHitAt: -1,
  }
  world.bars.push(bar)
  return bar
}

export function spawnBall(
  world: World,
  pos: Vec2,
  vel?: Vec2,
  opts?: { radius?: number; hue?: number },
): Ball {
  const v = vel ?? { x: 0, y: 0 }
  const ball: Ball = {
    id: world.nextBallId++,
    pos: { x: pos.x, y: pos.y },
    vel: { x: v.x, y: v.y },
    radius: opts?.radius ?? DEFAULT_RADIUS,
    alive: true,
    age: 0,
    hue: opts?.hue ?? 0,
  }
  world.balls.push(ball)
  return ball
}

export function stepWorld(world: World, dt: number = DT): ImpactEvent[] {
  const events: ImpactEvent[] = []

  for (const ball of world.balls) {
    if (!ball.alive) continue
    stepBall(world, ball, dt, events)
    ball.age += dt
  }

  world.time += dt

  let died = false
  for (const ball of world.balls) {
    if (!ball.alive) continue
    if (ball.pos.y > world.bounds.h + BOTTOM_MARGIN) {
      ball.alive = false
    } else if (ball.pos.x < -SIDE_MARGIN || ball.pos.x > world.bounds.w + SIDE_MARGIN) {
      ball.alive = false
    }
    died = died || !ball.alive
  }
  // Ne réallouer le tableau que quand une bille disparaît : sinon c'est 120 tableaux par seconde
  // pour rien, en pleine boucle chaude.
  if (died) world.balls = world.balls.filter((b) => b.alive)

  events.sort((e1, e2) => e1.at - e2.at)
  return events
}

function stepBall(world: World, ball: Ball, dt: number, events: ImpactEvent[]): void {
  ball.vel.x += world.gravity.x * dt
  ball.vel.y += world.gravity.y * dt

  let remaining = dt
  let impacts = 0
  // Le rendu trace des barres de BAR_THICKNESS px de large : la capsule de collision doit gonfler
  // du rayon de la bille ET du demi-épaisseur, sinon la bille s'enfonce visuellement dans la barre.
  const effectiveRadius = ball.radius + BAR_THICKNESS / 2

  while (remaining > 1e-9 && impacts < MAX_IMPACTS_PER_STEP) {
    let bestHit: SweepHit | null = null
    let bestBar: Bar | null = null

    for (const bar of world.bars) {
      const hit = sweepCircleSegment(ball.pos, ball.vel, effectiveRadius, bar.a, bar.b, remaining)
      if (hit && (!bestHit || hit.t < bestHit.t)) {
        bestHit = hit
        bestBar = bar
      }
    }

    if (!bestHit || !bestBar) {
      ball.pos.x += ball.vel.x * remaining
      ball.pos.y += ball.vel.y * remaining
      remaining = 0
      break
    }

    ball.pos.x += ball.vel.x * bestHit.t
    ball.pos.y += ball.vel.y * bestHit.t
    const at = world.time + (dt - remaining) + bestHit.t
    const normal = bestHit.normal
    const vn = dot(ball.vel, normal)
    const speed = Math.abs(vn)

    if (speed < REST_SPEED_THRESHOLD) {
      ball.vel.x -= vn * normal.x
      ball.vel.y -= vn * normal.y
    } else {
      const e = bestBar.restitution
      const j = (1 + e) * vn
      ball.vel.x -= j * normal.x
      ball.vel.y -= j * normal.y

      const tangent = perp(normal)
      const vt = dot(ball.vel, tangent)
      const frictionDelta = TANGENT_FRICTION * vt
      ball.vel.x -= frictionDelta * tangent.x
      ball.vel.y -= frictionDelta * tangent.y

      events.push({
        barId: bestBar.id,
        ballId: ball.id,
        point: bestHit.point,
        normal,
        speed,
        at,
      })
      bestBar.lastHitAt = at
    }

    ball.pos.x += normal.x * SEPARATION_EPS
    ball.pos.y += normal.y * SEPARATION_EPS

    remaining -= bestHit.t
    impacts++
  }

  if (remaining > 1e-9) {
    ball.pos.x += ball.vel.x * remaining
    ball.pos.y += ball.vel.y * remaining
  }
}
