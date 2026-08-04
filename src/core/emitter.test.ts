import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DIVISION_INDEX,
  DIVISIONS,
  barSeconds,
  divisionAt,
  divisionSeconds,
} from './clock'
import {
  MAX_BALLS,
  addEmitter,
  clampDivisionIndex,
  setDivision,
  emitterPeriod,
  removeEmitter,
  runEmitters,
} from './emitter'
import { DT, addBar, createWorld, spawnBall, stepWorld } from './physics'
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
  for (let index = 0; index < DIVISIONS.length; index += 1) {
    const division = divisionAt(index)
    it(`émet à la division ${division.toFixed(3)} de mesure, ni plus ni moins`, () => {
      const w = world()
      addEmitter(w, { x: 640, y: 100 }, { divisionIndex: index })
      const period = emitterPeriod(w.emitters[0]!, w.bpm)

      const times = simulate(w, 30)

      // Attente calculée depuis le temps **réellement** simulé, pas depuis 30 : additionner 3 600
      // pas de 1/120 donne 29,999999999999996, donc une échéance tombant pile sur 30 n'est pas
      // franchie. Comparer à `floor(30 / period)` ferait échouer le test d'une bille pour une raison
      // qui n'a rien à voir avec la cadence.
      expect(times.length).toBe(Math.floor(w.time / period))
      expect(times[0] ?? 0).toBeGreaterThanOrEqual(period)
      expect(times[0] ?? 0).toBeLessThan(period + DT * 1.5)
    })
  }

  it('les émissions tombent **sur la grille**, pas seulement à intervalle régulier', () => {
    // Propriété plus forte que « les écarts sont égaux » : une suite d'écarts égaux peut être
    // entièrement décalée par rapport à la mesure. C'est cette différence qui fait qu'un motif se
    // répète en phase au lieu de flotter.
    const w = world()
    const index = 3 // 1/4 de mesure
    addEmitter(w, { x: 640, y: 100 }, { divisionIndex: index })
    const step = divisionSeconds(divisionAt(index), w.bpm)

    for (const time of simulate(w, 20)) {
      // L'émission est détectée au pas qui franchit l'échéance : l'instant de grille est donc dans le
      // pas qui précède.
      const previousGrid = Math.floor(time / step + 1e-9) * step
      expect(time - previousGrid).toBeLessThan(DT * 1.5)
    }
  })

  it('deux sources de même division émettent exactement en phase, sur 200 mesures', () => {
    const w = world()
    addEmitter(w, { x: 200, y: 100 }, { divisionIndex: 1 })
    // La seconde source est posée **au milieu** d'un pas : c'est le cas qui distingue une échéance
    // recalculée depuis la grille d'une échéance cumulée depuis l'instant de création.
    w.time += divisionSeconds(divisionAt(1), w.bpm) * 0.37
    addEmitter(w, { x: 900, y: 100 }, { divisionIndex: 1 })

    const byEmitter = new Map<number, number[]>()
    const steps = Math.round((barSeconds(w.bpm) * 200) / DT)
    for (let i = 0; i < steps; i += 1) {
      w.time += DT
      for (const emitter of w.emitters) {
        if (emitter.nextAt <= w.time) {
          const list = byEmitter.get(emitter.id) ?? []
          list.push(emitter.nextAt)
          byEmitter.set(emitter.id, list)
        }
      }
      runEmitters(w, (pos) => spawnBall(w, pos))
    }

    const [first, second] = [...byEmitter.values()]
    expect(first?.length).toBeGreaterThan(300)
    // Égalité **exacte** des échéances, pas « écart faible » : un écart faible laisserait passer une
    // dérive lente, qui est précisément ce qu'on veut interdire.
    expect(second).toEqual(first?.slice(first.length - (second?.length ?? 0)))
  })

  it('un changement de tempo raccroche la source à la NOUVELLE grille', () => {
    /*
     * C'est **la** propriété qui distingue une échéance recalculée depuis la grille d'une échéance
     * cumulée (`nextAt += période`). Depuis une échéance déjà alignée, l'accumulation retombe sur les
     * mêmes instants : les deux versions sont indiscernables… jusqu'au changement de tempo, où
     * l'accumulation reste sur l'**ancienne** grille pour toujours. Vérifié par mutation : sans cette
     * assertion, remplacer le recalcul par une accumulation passait les 19 autres tests.
     */
    const w = world()
    addEmitter(w, { x: 640, y: 100 }, { divisionIndex: 1 })
    simulate(w, 5)

    w.bpm = 132
    // On avance jusqu'à la prochaine émission, qui doit se poser sur la grille du nouveau tempo.
    // On relève l'échéance **après** `runEmitters`, donc celle qui vient d'être recalculée : le callback
    // d'émission, lui, est appelé avant la mise à jour et rendrait l'ancienne échéance.
    const deadlines: number[] = []
    const steps = Math.round(4 / DT)
    for (let i = 0; i < steps && deadlines.length < 3; i += 1) {
      w.time += DT
      if (runEmitters(w, () => {}) > 0) deadlines.push(w.emitters[0]!.nextAt)
    }

    expect(deadlines.length).toBe(3)
    const step = divisionSeconds(divisionAt(1), 132)
    for (const deadline of deadlines) {
      expect(Math.abs(deadline / step - Math.round(deadline / step))).toBeLessThan(1e-9)
    }
  })

  it('n’émet rien à l’instant de sa création', () => {
    const w = world()
    addEmitter(w, { x: 640, y: 100 })
    expect(runEmitters(w, () => {})).toBe(0)
  })

  it('honore plusieurs échéances dans un pas long, dans la limite du garde-fou', () => {
    const w = world()
    addEmitter(w, { x: 640, y: 100 }, { divisionIndex: 3 })

    w.time += 4
    const spawned = runEmitters(w, (pos) => spawnBall(w, pos))

    expect(spawned).toBe(4)
    // Le reliquat n'est pas traîné comme une dette : la source repart de la grille.
    expect(w.emitters[0]?.nextAt).toBeGreaterThan(w.time)
  })

  it('après un très gros saut de temps, la source reste sur la grille', () => {
    const w = world()
    addEmitter(w, { x: 640, y: 100 }, { divisionIndex: 1 })
    w.time += 600
    runEmitters(w, () => {})
    const step = divisionSeconds(divisionAt(1), w.bpm)
    const next = w.emitters[0]!.nextAt
    expect(next).toBeGreaterThan(w.time)
    expect(Math.abs(next / step - Math.round(next / step))).toBeLessThan(1e-9)
  })
})

describe('D2 — déterminisme', () => {
  it('produit la même **trace d’impacts** à monde identique, sur 30 s', () => {
    function run(): string[] {
      const w = createWorld({ w: 1280, h: 800 })
      for (let i = 0; i < 6; i++) {
        const x = 120 + i * 180
        addBar(w, { x: x - 90, y: 250 + (i % 3) * 130 }, { x: x + 90, y: 300 + (i % 3) * 130 }, 60 + i)
      }
      addEmitter(w, { x: 300, y: 80 }, { divisionIndex: 2 })
      addEmitter(w, { x: 900, y: 120 }, { divisionIndex: 3 })

      const trace: string[] = []
      const steps = Math.round(30 / DT)
      for (let i = 0; i < steps; i++) {
        runEmitters(w, (pos, hue) => spawnBall(w, pos, { x: 0, y: 0 }, { hue }))
        for (const impact of stepWorld(w, DT)) {
          trace.push(`${impact.barId}@${impact.at.toFixed(6)}:${impact.speed.toFixed(3)}`)
        }
      }
      return trace
    }

    const first = run()
    expect(first.length).toBeGreaterThan(50)
    expect(run()).toEqual(first)
  })
})

describe('D3 — plafond de billes', () => {
  it('ne dépasse jamais le plafond, et sacrifie les plus anciennes', () => {
    const w = world()
    // Gravité coupée : on veut voir le plafond agir, pas les billes sortir par le bas.
    w.gravity = { x: 0, y: 0 }
    for (const x of [200, 640, 1000]) addEmitter(w, { x, y: 100 }, { divisionIndex: 3 })

    simulate(w, 300)

    expect(w.balls.length).toBeLessThanOrEqual(MAX_BALLS)
    const ids = w.balls.map((ball) => ball.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(ids.at(-1)).toBe(w.nextBallId - 1)
  })
})

describe('divisions', () => {
  it('un index hors catalogue retombe sur le défaut, sans lever', () => {
    const w = world()
    expect(addEmitter(w, { x: 0, y: 0 }, { divisionIndex: -1 }).divisionIndex).toBe(
      DEFAULT_DIVISION_INDEX
    )
    expect(addEmitter(w, { x: 0, y: 0 }, { divisionIndex: 99 }).divisionIndex).toBe(
      DEFAULT_DIVISION_INDEX
    )
    expect(addEmitter(w, { x: 0, y: 0 }, { divisionIndex: 1.5 }).divisionIndex).toBe(
      DEFAULT_DIVISION_INDEX
    )
    expect(clampDivisionIndex(Number.NaN)).toBe(DEFAULT_DIVISION_INDEX)
  })

  it('ne boucle pas sans fin si la division est écrasée après la création', () => {
    const w = world()
    const emitter = addEmitter(w, { x: 0, y: 0 })
    emitter.divisionIndex = -7
    w.time += 10

    // Le garde-fou doit borner, sinon ce test ne termine jamais.
    expect(runEmitters(w, () => {})).toBe(4)
  })

  it('chaque division du catalogue est atteignable directement', () => {
    // La roue de l'US17 remplace le cyclage : on ne passe plus par les autres pour arriver à la bonne.
    const w = world()
    const emitter = addEmitter(w, { x: 0, y: 0 }, { divisionIndex: 0 })
    for (let index = 0; index < DIVISIONS.length; index += 1) {
      expect(setDivision(w, emitter, index)).toBe(index)
      expect(emitter.divisionIndex).toBe(index)
    }
  })

  it('un index hors catalogue retombe sur le défaut, comme à la création', () => {
    // Une seule règle de bornage dans le fichier (`clampDivisionIndex`), pas deux qui divergeraient :
    // hors catalogue, la source prend la division par défaut plutôt qu'une extrémité arbitraire.
    const w = world()
    const emitter = addEmitter(w, { x: 0, y: 0 }, { divisionIndex: 2 })
    expect(setDivision(w, emitter, -3)).toBe(DEFAULT_DIVISION_INDEX)
    expect(setDivision(w, emitter, 99)).toBe(DEFAULT_DIVISION_INDEX)
    expect(setDivision(w, emitter, 1.5)).toBe(DEFAULT_DIVISION_INDEX)
  })

  it('changer de division ré-arme sur la grille, sans rafale ni trou', () => {
    const w = world()
    const emitter = addEmitter(w, { x: 0, y: 0 }, { divisionIndex: 0 })
    w.time += 3.7
    setDivision(w, emitter, 3)

    // Devant nous (pas de rafale à rattraper), et sur la grille de la **nouvelle** division.
    expect(emitter.nextAt).toBeGreaterThan(w.time)
    const step = divisionSeconds(divisionAt(emitter.divisionIndex), w.bpm)
    expect(Math.abs(emitter.nextAt / step - Math.round(emitter.nextAt / step))).toBeLessThan(1e-9)
    // Et pas plus loin qu'une division : la source ne se tait pas en changeant de rythme.
    expect(emitter.nextAt - w.time).toBeLessThanOrEqual(step + 1e-9)
  })

  it('la période est **dérivée** du tempo, jamais stockée', () => {
    const w = world()
    const emitter = addEmitter(w, { x: 0, y: 0 }, { divisionIndex: 1 })
    const slow = emitterPeriod(emitter, 60)
    const fast = emitterPeriod(emitter, 120)
    expect(slow).toBeCloseTo(fast * 2, 10)
    // Doubler le tempo change la cadence sans qu'aucun champ de la source ait bougé.
    expect(emitter.divisionIndex).toBe(1)
  })
})

describe('suppression et teintes', () => {
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
