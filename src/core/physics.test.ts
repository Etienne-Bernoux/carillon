import { describe, expect, it } from 'vitest'
import { BAR_THICKNESS, DT, addBar, createWorld, spawnBall, stepWorld, sweepCircleSegment } from './physics'
import { createRng } from './rng'
import type { ImpactEvent, Vec2, World } from './types'
import { dot, sub } from './vec'

const RADIUS = 8
// La physique gonfle la capsule de collision du rayon de la bille + le demi-épaisseur de la
// barre (cf. physics.ts) : la surface de repos réelle est décalée de BAR_THICKNESS/2 par rapport
// à la ligne centrale de la barre.
const EFFECTIVE_RADIUS = RADIUS + BAR_THICKNESS / 2

function flatWorld(restitution: number, barY = 1000): World {
  const world = createWorld({ w: 800, h: 2000 })
  addBar(world, { x: -10000, y: barY }, { x: 10000, y: barY }, 60, restitution)
  return world
}

function run(world: World, steps: number): ImpactEvent[] {
  const all: ImpactEvent[] = []
  for (let i = 0; i < steps; i++) all.push(...stepWorld(world, DT))
  return all
}

/** Normale unitaire d'une barre, calculée une fois pour servir de repère fixe dans un test. */
function barNormal(a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a)
  const abLen = Math.sqrt(ab.x * ab.x + ab.y * ab.y)
  return { x: -ab.y / abLen, y: ab.x / abLen }
}

/** Distance signée d'un point à la droite portée par la barre (a, n fixes pour tout le test). */
function signedSide(pos: Vec2, a: Vec2, n: Vec2): number {
  return dot(sub(pos, a), n)
}

describe('A1 — hauteur de rebond', () => {
  it('rebondit à e² fois la hauteur de chute, à 5 % près', () => {
    const restitution = 0.8
    const dropHeight = 400
    const barY = 1000
    const world = flatWorld(restitution, barY)
    const ball = spawnBall(world, { x: 400, y: barY - RADIUS - dropHeight })

    let impacts = 0
    let apex = Number.POSITIVE_INFINITY
    for (let i = 0; i < 400; i++) {
      impacts += stepWorld(world, DT).length
      if (impacts === 1) apex = Math.min(apex, ball.pos.y)
      if (impacts > 1) break
    }

    expect(impacts).toBeGreaterThanOrEqual(1)
    const rebound = barY - RADIUS - apex
    const expected = restitution * restitution * dropHeight
    expect(rebound).toBeGreaterThan(expected * 0.95)
    expect(rebound).toBeLessThan(expected * 1.05)
  })
})

describe('A2 — aucun tunneling', () => {
  it('ne traverse jamais une barre, même à 5000 px/s', () => {
    const barY = 500
    let trials = 0

    for (let speedStep = 0; speedStep < 20; speedStep++) {
      const speed = 500 + speedStep * 237
      for (let angleStep = 0; angleStep < 11; angleStep++) {
        // -70°..+70° autour de la verticale descendante
        const angle = (-70 + angleStep * 14) * (Math.PI / 180)
        const world = flatWorld(0.8, barY)
        const ball = spawnBall(world, { x: 400, y: barY - RADIUS - 37 }, {
          x: Math.sin(angle) * speed,
          y: Math.cos(angle) * speed,
        })

        const impacts = run(world, 120)
        trials++

        // La barre est infinie : franchir la ligne est impossible, avec ou sans rebond.
        expect(ball.pos.y).toBeLessThanOrEqual(barY)
        expect(impacts.length).toBeGreaterThanOrEqual(1)
      }
    }

    expect(trials).toBe(220)
  })
})

describe('A3 — réflexion sur barre inclinée', () => {
  it('renvoie une chute verticale à l’horizontale sur une pente à 45°', () => {
    const world = createWorld({ w: 800, h: 800 })
    world.gravity = { x: 0, y: 0 }
    addBar(world, { x: 200, y: 600 }, { x: 600, y: 200 }, 60, 1)
    const ball = spawnBall(world, { x: 400, y: 200 }, { x: 0, y: 400 })

    const impacts = run(world, 120)

    expect(impacts.length).toBe(1)
    // Incidence verticale sur une pente à 45° ⇒ sortie horizontale, à la friction tangentielle près.
    expect(Math.abs(ball.vel.y)).toBeLessThan(12)
    expect(ball.vel.x).toBeLessThan(-380)
    expect(ball.vel.x).toBeGreaterThan(-405)
  })
})

describe('A4 — collision sur l’extrémité', () => {
  it('détecte l’impact sur le bout de la barre avec une normale radiale', () => {
    const world = createWorld({ w: 1200, h: 800 })
    world.gravity = { x: 0, y: 0 }
    addBar(world, { x: 400, y: 500 }, { x: 600, y: 500 }, 60, 0.9)
    const ball = spawnBall(world, { x: 300, y: 500 }, { x: 400, y: 0 })

    const impacts = run(world, 120)
    const first = impacts[0]

    expect(first).toBeDefined()
    expect(first?.normal.x).toBeLessThan(-0.9)
    expect(Math.abs(first?.normal.y ?? 1)).toBeLessThan(0.2)
    expect(ball.vel.x).toBeLessThan(0)
  })

  it('ne piège pas une bille déjà en recouvrement qui s’éloigne du bout', () => {
    const world = createWorld({ w: 1200, h: 800 })
    world.gravity = { x: 0, y: 0 }
    addBar(world, { x: 400, y: 500 }, { x: 600, y: 500 }, 60, 0.9)
    // Centre à 5 px du bout, donc dans le rayon : recouvrement, mais la vitesse s’en écarte.
    const ball = spawnBall(world, { x: 396, y: 497 }, { x: -300, y: 0 })

    const impacts = run(world, 60)

    expect(impacts).toHaveLength(0)
    expect(ball.vel.x).toBeCloseTo(-300, 5)
    expect(ball.vel.y).toBeCloseTo(0, 5)
  })

  it('laisse passer une bille qui manque franchement le bout', () => {
    const world = createWorld({ w: 1200, h: 800 })
    world.gravity = { x: 0, y: 0 }
    addBar(world, { x: 400, y: 500 }, { x: 600, y: 500 }, 60, 0.9)
    spawnBall(world, { x: 300, y: 460 }, { x: 400, y: 0 })

    expect(run(world, 120)).toHaveLength(0)
  })
})

describe('A5 — déterminisme', () => {
  it('produit une trace d’impacts identique à monde identique', () => {
    function buildAndRun(): ImpactEvent[] {
      const rng = createRng(1234)
      const world = createWorld({ w: 900, h: 1400 })
      for (let i = 0; i < 10; i++) {
        const x = rng() * 700 + 100
        const y = rng() * 900 + 200
        const half = 60 + rng() * 120
        const slope = rng() - 0.5
        addBar(world, { x: x - half, y: y - slope * half }, { x: x + half, y: y + slope * half }, 60 + i)
      }
      for (let i = 0; i < 5; i++) spawnBall(world, { x: 150 + i * 140, y: 60 })
      return run(world, 600)
    }

    const first = buildAndRun()
    const second = buildAndRun()

    expect(first.length).toBeGreaterThan(5)
    expect(second).toEqual(first)
  })
})

describe('repos', () => {
  it('immobilise une bille au lieu de la faire vibrer indéfiniment', () => {
    const barY = 1000
    const world = flatWorld(0.8, barY)
    const ball = spawnBall(world, { x: 400, y: barY - RADIUS - 30 })

    run(world, 480)
    const lateImpacts = run(world, 120)

    expect(lateImpacts).toHaveLength(0)
    expect(Math.abs(ball.vel.y)).toBeLessThan(30)
    expect(Math.abs(ball.pos.y - (barY - EFFECTIVE_RADIUS))).toBeLessThan(2)
  })
})

describe('sweepCircleSegment', () => {
  it('ne retourne rien quand la trajectoire passe loin de la barre', () => {
    const hit = sweepCircleSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 8, { x: 0, y: 300 }, { x: 200, y: 300 }, DT)
    expect(hit).toBeNull()
  })

  it('retourne un impact dans le pas quand la barre est droit devant', () => {
    const hit = sweepCircleSegment({ x: 100, y: 0 }, { x: 0, y: 6000 }, 8, { x: 0, y: 40 }, { x: 200, y: 40 }, DT)
    expect(hit).not.toBeNull()
    expect(hit?.t).toBeGreaterThan(0)
    expect(hit?.t).toBeLessThanOrEqual(DT)
    expect(hit?.normal.y).toBeLessThan(-0.9)
  })
})

describe('non-régression — recouvrement du flanc', () => {
  it('émet un impact et repousse une bille dont le centre est déjà dans la bande et qui s’enfonce', () => {
    const world = createWorld({ w: 1000, h: 1000 })
    world.gravity = { x: 0, y: 0 }
    // Barre inclinée à 45°, comme A3 : le milieu du segment est le point (400, 400).
    const bar = addBar(world, { x: 200, y: 600 }, { x: 600, y: 200 }, 60, 0.8)
    const n = barNormal(bar.a, bar.b)
    // Centre à 5 px de la ligne : dans la bande, puisque le rayon effectif est 11.5 px (8 + 7/2).
    const start = { x: 400 + n.x * 5, y: 400 + n.y * 5 }
    const ball = spawnBall(world, start, { x: -n.x * 300, y: -n.y * 300 })

    const impacts = run(world, 60)

    expect(impacts.length).toBeGreaterThanOrEqual(1)
    // Elle rebondit et reste du côté d'où elle est partie, elle ne ressort pas de l'autre côté.
    expect(signedSide(ball.pos, bar.a, n)).toBeGreaterThan(0)
  })

  it('ne piège pas une bille dont le centre est dans la bande et qui s’en éloigne déjà', () => {
    const world = createWorld({ w: 1000, h: 1000 })
    world.gravity = { x: 0, y: 0 }
    const bar = addBar(world, { x: 200, y: 600 }, { x: 600, y: 200 }, 60, 0.8)
    const n = barNormal(bar.a, bar.b)
    const start = { x: 400 + n.x * 5, y: 400 + n.y * 5 }
    const ball = spawnBall(world, start, { x: n.x * 300, y: n.y * 300 })

    const impacts = run(world, 30)

    expect(impacts).toHaveLength(0)
    expect(ball.vel.x).toBeCloseTo(n.x * 300, 5)
    expect(ball.vel.y).toBeCloseTo(n.y * 300, 5)
  })
})

describe('scénario produit — barre dessinée sur une bille en vol', () => {
  it('intercepte une bille déjà en chute quand la barre apparaît par-dessus elle', () => {
    const world = createWorld({ w: 800, h: 2000 })
    const ball = spawnBall(world, { x: 400, y: 100 })

    // La bille prend de la vitesse en chute libre avant que l'utilisateur ne dessine la barre.
    for (let i = 0; i < 30; i++) stepWorld(world, DT)
    expect(ball.vel.y).toBeGreaterThan(200)

    // La barre apparaît à 2 px sous le centre de la bille : très à l'intérieur de la bande
    // (rayon effectif 11.5 px), exactement le cas « barre dessinée sur une bille en vol ».
    const barY = ball.pos.y + 2
    const bar = addBar(world, { x: ball.pos.x - 300, y: barY }, { x: ball.pos.x + 300, y: barY }, 60, 0.8)

    const impacts = run(world, 60)
    const hitThisBar = impacts.some((e) => e.barId === bar.id)

    expect(hitThisBar).toBe(true)
    expect(ball.pos.y).toBeLessThan(barY + EFFECTIVE_RADIUS)
  })
})

describe('A2bis — balayage géométrique sur barres courtes et inclinées', () => {
  it('ne franchit jamais une barre sans impact enregistré, quelle que soit la pente ou la cible visée', () => {
    // « Mauvais côté » : la distance signée au support de la barre (mesurée une fois par essai,
    // avec une normale et une origine fixes) change de signe par rapport au signe de départ ET
    // dépasse le rayon effectif en valeur absolue — la bille est alors franchement de l'autre
    // côté, hors de la capsule de collision, ce qui ne devrait jamais arriver sans impact.
    const N_SPEED = 15
    const N_ANGLE = 10
    const H = 60
    const center = { x: 500, y: 500 }
    let trials = 0

    for (let si = 0; si < N_SPEED; si++) {
      const speed = 300 + si * (4700 / (N_SPEED - 1))
      for (let ai = 0; ai < N_ANGLE; ai++) {
        const angleDeg = -60 + ai * (120 / (N_ANGLE - 1))
        const angle = (angleDeg * Math.PI) / 180
        const dir = { x: Math.cos(angle), y: Math.sin(angle) }

        for (const aim of ['mid', 'nearEnd'] as const) {
          const along = aim === 'mid' ? 0 : 0.9 * H
          const target = { x: center.x + dir.x * along, y: center.y + dir.y * along }
          const a = { x: center.x - dir.x * H, y: center.y - dir.y * H }
          const b = { x: center.x + dir.x * H, y: center.y + dir.y * H }

          const world = createWorld({ w: 2000, h: 2000 })
          world.gravity = { x: 0, y: 0 }
          const bar = addBar(world, a, b, 60, 0.8)
          const n = barNormal(a, b)
          const start = { x: target.x, y: target.y - 50 }
          const ball = spawnBall(world, start, { x: 0, y: speed })

          const initialSideValue = signedSide(ball.pos, a, n)
          expect(Math.abs(initialSideValue)).toBeGreaterThanOrEqual(EFFECTIVE_RADIUS)
          const initialSide = Math.sign(initialSideValue)

          let hitThisBar = false
          for (let step = 0; step < 120 && ball.alive; step++) {
            const impacts = stepWorld(world, DT)
            if (impacts.some((e) => e.barId === bar.id)) hitThisBar = true

            const side = signedSide(ball.pos, a, n)
            const crossedToOppositeSide =
              Math.sign(side) !== 0 && Math.sign(side) !== initialSide && Math.abs(side) > EFFECTIVE_RADIUS
            if (crossedToOppositeSide) {
              expect(hitThisBar).toBe(true)
            }
          }

          trials++
        }
      }
    }

    expect(trials).toBeGreaterThanOrEqual(300)
  })
})

describe('garde-fou de performance du noyau pur', () => {
  /** Monte une scène de `bars` barres et 200 billes, puis chronomètre 120 pas. */
  function timeSteps(bars: number): number {
    const rng = createRng(42)
    const world = createWorld({ w: 1600, h: 1200 })
    for (let i = 0; i < bars; i += 1) {
      const x = rng() * 1400 + 100
      const y = rng() * 1000 + 100
      const half = 40 + rng() * 100
      const slope = rng() - 0.5
      addBar(world, { x: x - half, y: y - slope * half }, { x: x + half, y: y + slope * half }, 60)
    }
    for (let i = 0; i < 200; i += 1) {
      spawnBall(world, { x: rng() * 1600, y: rng() * 200 }, { x: (rng() - 0.5) * 200, y: rng() * 100 })
    }
    const start = performance.now()
    for (let i = 0; i < 120; i += 1) stepWorld(world, DT)
    return performance.now() - start
  }

  it('le coût croît **linéairement** avec le nombre de barres, pas quadratiquement', () => {
    /*
     * Le but est de détecter une régression **algorithmique** — une broadphase O(n²) accidentelle qui
     * remplacerait le parcours linéaire des barres — et non la vitesse de cette machine.
     *
     * Deux versions précédentes ont échoué à le faire :
     *
     * 1. Un budget en dur (500 ms) pour une référence annoncée à « ~98 ms ». Cette référence avait
     *    dérivé en silence : bissecté, le coût réel valait **401 ms** avant les natures de barres et
     *    **463 ms** avec. La marge n'était plus de 5× mais de 1,2×, et le test clignotait dès que la
     *    suite tournait en parallèle — 1225 ms en suite complète contre 337 ms isolé, **pour le même
     *    code**. Un garde-fou dont la référence a dérivé ne garde plus rien.
     * 2. Un budget calibré sur une boucle arithmétique. Mesuré, le rapport passait de 22 isolé à 62 en
     *    suite complète : la physique alloue et parcourt de la mémoire, la boucle arithmétique non, donc
     *    les deux ne subissent pas la contention de la même façon.
     *
     * L'étalon est donc le **même algorithme à une taille plus petite** : les deux mesures se suivent
     * dans le même worker et subissent la même contention, donc leur rapport ne dépend que de la
     * complexité. Linéaire en barres → rapport ≈ 5 ; quadratique → ≈ 25.
     */
    const small = timeSteps(5)
    const large = timeSteps(25)
    const ratio = large / Math.max(small, 0.5)

    console.log(
      `  [perf] 5 barres = ${small.toFixed(0)} ms | 25 barres = ${large.toFixed(0)} ms | rapport = ${ratio.toFixed(1)} (linéaire ≈ 5, quadratique ≈ 25)`
    )
    expect(ratio).toBeLessThan(12)
  })
})
