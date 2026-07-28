import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD, MAX_BALLS, MIN_PERIOD, addEmitter, removeEmitter, runEmitters } from './emitter'
import { DT, createWorld, spawnBall } from './physics'
import type { Vec2, World } from './types'

function world(): World {
  return createWorld({ w: 1280, h: 800 })
}

/** Avance le temps par pas fixes en faisant émettre, et renvoie les instants d'émission. */
function simulate(w: World, seconds: number, dt = DT): number[] {
  const times: number[] = []
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) {
    w.time += dt
    runEmitters(w, (pos) => {
      times.push(w.time)
      spawnBall(w, pos)
    })
  }
  return times
}

describe('D1 — cadence d’émission', () => {
  for (const period of [MIN_PERIOD, 0.5, DEFAULT_PERIOD, 3]) {
    it(`lâche une bille tous les ${period} s, ni plus ni moins`, () => {
      const w = world()
      addEmitter(w, { x: 640, y: 100 }, { period })

      const times = simulate(w, 30)

      // Attente calculée depuis le temps **réellement** simulé, pas depuis 30 : additionner 3 600
      // pas de 1/120 donne 29,999999999999996, donc une échéance tombant pile sur 30 n'est pas
      // franchie. Comparer à `floor(30 / period)` ferait échouer le test d'une bille pour une raison
      // qui n'a rien à voir avec la cadence.
      expect(times.length).toBe(Math.floor(w.time / period))
      // La cadence est réellement contrainte : première émission à une période près, à un pas de
      // simulation près — l'échéance est détectée au pas qui la franchit, donc jamais avant.
      expect(times[0] ?? 0).toBeGreaterThanOrEqual(period)
      expect(times[0] ?? 0).toBeLessThan(period + DT * 1.5)
    })
  }

  it('ne dérive pas : les écarts entre émissions restent égaux à la période', () => {
    const w = world()
    addEmitter(w, { x: 640, y: 100 }, { period: DEFAULT_PERIOD })
    const times = simulate(w, 30)

    for (let i = 1; i < times.length; i++) {
      // Tolérance d'un pas de simulation : l'émission est détectée au pas qui franchit l'échéance.
      expect(Math.abs((times[i] ?? 0) - (times[i - 1] ?? 0) - DEFAULT_PERIOD)).toBeLessThan(DT * 1.5)
    }
  })

  it('n’émet rien à l’instant de sa création', () => {
    const w = world()
    addEmitter(w, { x: 640, y: 100 })
    expect(runEmitters(w, () => {})).toBe(0)
  })

  it('honore plusieurs échéances dans un pas long, dans la limite du garde-fou', () => {
    const w = world()
    addEmitter(w, { x: 640, y: 100 }, { period: 0.2 })

    // Un seul pas de 2 s : 10 échéances dues, mais le garde-fou en autorise 4.
    w.time += 2
    const spawned = runEmitters(w, (pos) => spawnBall(w, pos))

    expect(spawned).toBe(4)
    // Le reliquat n'est pas traîné comme une dette : la source repart de maintenant.
    expect(w.emitters[0]?.nextAt).toBeGreaterThan(w.time)
  })
})

describe('D2 — déterminisme', () => {
  it('produit la même suite d’instants d’émission à monde identique', () => {
    function run(): number[] {
      const w = world()
      addEmitter(w, { x: 300, y: 80 }, { period: 0.37 })
      addEmitter(w, { x: 900, y: 120 }, { period: 0.61 })
      return simulate(w, 30)
    }

    const first = run()
    expect(first.length).toBeGreaterThan(100)
    expect(run()).toEqual(first)
  })
})

describe('D3 — plafond de billes', () => {
  it('ne dépasse jamais le plafond, et sacrifie les plus anciennes', () => {
    const w = world()
    // Gravité coupée : on veut voir le plafond agir, pas les billes sortir par le bas.
    w.gravity = { x: 0, y: 0 }
    for (const x of [200, 640, 1000]) addEmitter(w, { x, y: 100 }, { period: MIN_PERIOD })

    simulate(w, 300)

    expect(w.balls.length).toBeLessThanOrEqual(MAX_BALLS)
    // Les survivantes sont les dernières créées : les identifiants forment une suite croissante qui
    // se termine au dernier id attribué.
    const ids = w.balls.map((ball) => ball.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(ids.at(-1)).toBe(w.nextBallId - 1)
  })
})

describe('bornes et suppression', () => {
  it('borne une période nulle ou négative au minimum', () => {
    const w = world()
    expect(addEmitter(w, { x: 0, y: 0 }, { period: 0 }).period).toBe(MIN_PERIOD)
    expect(addEmitter(w, { x: 0, y: 0 }, { period: -5 }).period).toBe(MIN_PERIOD)
  })

  it('ne boucle pas sans fin si la période est écrasée à zéro après la création', () => {
    const w = world()
    const emitter = addEmitter(w, { x: 0, y: 0 })
    emitter.period = 0
    w.time += 10

    // Le garde-fou doit borner, sinon ce test ne termine jamais.
    expect(runEmitters(w, () => {})).toBe(4)
  })

  it('retire une source par son identifiant, et ignore un identifiant inconnu', () => {
    const w = world()
    const emitter = addEmitter(w, { x: 10, y: 10 })
    removeEmitter(w, 999)
    expect(w.emitters).toHaveLength(1)
    removeEmitter(w, emitter.id)
    expect(w.emitters).toHaveLength(0)
  })

  it('donne des teintes froides, déterministes, aux billes émises', () => {
    const w = world()
    const hues: number[] = []
    for (let i = 0; i < 6; i++) hues.push(addEmitter(w, { x: i * 100, y: 50 } as Vec2).hue)
    for (const hue of hues) {
      expect(hue).toBeGreaterThanOrEqual(190)
      expect(hue).toBeLessThan(280)
    }
  })
})
