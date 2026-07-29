import { describe, expect, it } from 'vitest'

import { barSeconds, divisionAt, divisionSeconds } from './clock'
import { MAX_BALLS, MAX_RESPAWNS_PER_STEP, addEmitter, runEmitters, runRespawns } from './emitter'
import { DT, createWorld, spawnBall, stepWorld } from './physics'
import type { World } from './types'

function world(): World {
  return createWorld({ w: 1280, h: 800 })
}

/** Avance la simulation en consommant les retours programmés, comme le fait `main.ts`. */
function run(w: World, seconds: number): number {
  let returned = 0
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i += 1) {
    returned += runRespawns(w, (pos, hue) =>
      spawnBall(w, pos, { x: 0, y: 0 }, { hue, recycle: true })
    )
    runEmitters(w, (pos, hue) => spawnBall(w, pos, { x: 0, y: 0 }, { hue }))
    stepWorld(w, DT)
  }
  return returned
}

describe('G3 — une bille lâchée à la main revient', () => {
  it('revient à son point de lâcher, sur un temps de la grille', () => {
    const w = world()
    const origin = { x: 400, y: 120 }
    spawnBall(w, origin, { x: 0, y: 0 }, { recycle: true })

    // Rien à consommer tant qu'elle est en vol.
    expect(w.respawns).toHaveLength(0)

    // Chute libre sur 800 px : elle sort par le bas, donc un retour est programmé.
    run(w, 1.4)
    const scheduled = w.respawns[0]
    expect(scheduled).toBeDefined()
    expect(scheduled?.pos).toEqual(origin)
    const bar = barSeconds(w.bpm)
    expect(Math.abs((scheduled?.at ?? 0) / bar - Math.round((scheduled?.at ?? 0) / bar))).toBeLessThan(
      1e-9
    )
    expect(scheduled?.at).toBeGreaterThan(w.time)

    // Puis elle revient réellement, au bon endroit. On l'inspecte **à son apparition** : elle retombe
    // et meurt en 1,1 s, donc une fenêtre d'observation d'une mesure entière la manquerait.
    const before = w.nextBallId
    let revenue: { origin: { x: number; y: number }; recycle: boolean } | undefined
    for (let i = 0; i < Math.round((bar * 1.2) / DT) && !revenue; i += 1) {
      run(w, DT)
      revenue = w.balls.find((ball) => ball.id === before)
    }
    expect(revenue).toBeDefined()
    expect(revenue?.origin).toEqual(origin)
    expect(revenue?.recycle).toBe(true)
  })

  it('une bille née d’une source ne revient pas — sa source la ré-émet déjà', () => {
    const w = world()
    addEmitter(w, { x: 300, y: 60 }, { divisionIndex: 0 })
    run(w, barSeconds(w.bpm) * 3)
    // Des billes ont vécu et sont sorties, sans qu'aucun retour ne soit programmé.
    expect(w.nextBallId).toBeGreaterThanOrEqual(2)
    expect(w.respawns).toHaveLength(0)
  })

  it('le retour se répète indéfiniment : un seul geste devient un motif', () => {
    const w = world()
    spawnBall(w, { x: 400, y: 120 }, { x: 0, y: 0 }, { recycle: true })
    const returns = run(w, barSeconds(w.bpm) * 12)
    // Une bille par mesure environ : le motif tourne, il ne s'éteint pas.
    expect(returns).toBeGreaterThanOrEqual(8)
  })
})

describe('G4 — le recyclage ne fuit pas', () => {
  it('billes vivantes et retours en attente restent bornés sur une longue durée', () => {
    const w = world()
    // 40 billes recyclées, toutes lâchées d'en haut : la scène tourne en boucle sans intervention.
    for (let i = 0; i < 40; i += 1) {
      spawnBall(w, { x: 40 + i * 30, y: 60 }, { x: 0, y: 0 }, { recycle: true })
    }
    for (let i = 0; i < 6; i += 1) addEmitter(w, { x: 100 + i * 200, y: 80 }, { divisionIndex: 4 })

    run(w, 120)

    expect(w.balls.length).toBeLessThanOrEqual(MAX_BALLS)
    // La file d'attente est la vraie candidate à la fuite : elle ne doit pas croître avec le temps.
    expect(w.respawns.length).toBeLessThanOrEqual(MAX_BALLS)
  })

  it('un retour dû mais hors budget est reporté, jamais perdu', () => {
    const w = world()
    const bar = barSeconds(w.bpm)
    // Un de plus que le budget : c'est le surplus qu'on veut voir survivre.
    for (let i = 0; i < MAX_RESPAWNS_PER_STEP + 6; i += 1) {
      w.respawns.push({ at: 0, pos: { x: 100 + i * 4, y: 50 }, hue: 200 })
    }
    w.time = bar * 2

    const first = runRespawns(w, () => {})
    expect(first).toBe(MAX_RESPAWNS_PER_STEP)
    // Les six restants sont toujours là, reprogrammés devant nous — pas jetés.
    expect(w.respawns).toHaveLength(6)
    expect(w.respawns.every((r) => r.at > w.time)).toBe(true)

    // Et ils finissent par revenir.
    let total = first
    for (let i = 0; i < Math.round((bar * 4) / DT); i += 1) {
      w.time += DT
      total += runRespawns(w, () => {})
    }
    expect(total).toBe(MAX_RESPAWNS_PER_STEP + 6)
    expect(w.respawns).toHaveLength(0)
  })

  it('la file est vide quand aucune bille n’est recyclable', () => {
    const w = world()
    spawnBall(w, { x: 400, y: 120 }, { x: 0, y: 0 })
    run(w, 3)
    expect(w.respawns).toHaveLength(0)
    expect(w.balls).toHaveLength(0)
  })

  it('les retours tombent tous sur la grille de la mesure', () => {
    const w = world()
    for (let i = 0; i < 5; i += 1) {
      spawnBall(w, { x: 200 + i * 150, y: 60 + i * 40 }, { x: 0, y: 0 }, { recycle: true })
    }
    run(w, 2)
    const step = divisionSeconds(divisionAt(0), w.bpm)
    expect(w.respawns.length).toBeGreaterThan(0)
    for (const respawn of w.respawns) {
      expect(Math.abs(respawn.at / step - Math.round(respawn.at / step))).toBeLessThan(1e-9)
    }
  })
})
