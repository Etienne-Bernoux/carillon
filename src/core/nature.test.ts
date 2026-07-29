import { describe, expect, it } from 'vitest'

import { barSeconds } from './clock'
import { MIN_IMPACT_SPEED } from './music'
import {
  EPHEMERAL_HITS,
  MIN_ABSENCE_SECONDS,
  NATURES,
  cycleNature,
  isPresent,
  maxBounceSpeed,
  natureLabel,
  registerHit,
  restitutionFor,
} from './nature'
import { DT, addBar, createWorld, spawnBall, stepWorld } from './physics'
import type { Bar, Vec2, World } from './types'

function world(): World {
  return createWorld({ w: 1280, h: 800 })
}

/** Une barre horizontale au milieu de la scène, de la nature demandée. */
function floor(w: World, nature: Parameters<typeof addBar>[5]): Bar {
  return addBar(w, { x: 300, y: 500 }, { x: 900, y: 500 }, 60, undefined, nature)
}

describe('catalogue des natures', () => {
  it('l’ordre est figé, et le mur est en tête (défaut et comportement historique)', () => {
    expect(NATURES).toEqual(['wall', 'trampoline', 'ephemeral'])
  })

  it('une barre naît mur, pleine de vie et présente', () => {
    const w = world()
    const bar = addBar(w, { x: 0, y: 0 }, { x: 100, y: 0 }, 60)
    expect(bar.nature).toBe('wall')
    expect(bar.hitsLeft).toBe(EPHEMERAL_HITS)
    expect(isPresent(bar, 0)).toBe(true)
  })

  it('le cycle parcourt les trois natures, boucle, et ré-arme au passage', () => {
    const w = world()
    const bar = floor(w, 'ephemeral')
    bar.hitsLeft = 1
    bar.absentUntil = 999

    expect(cycleNature(bar)).toBe('wall')
    // Ré-armée : sans ça, une barre qui cesse d'être éphémère resterait absente pour toujours.
    expect(bar.absentUntil).toBe(-1)
    expect(bar.hitsLeft).toBe(EPHEMERAL_HITS)
    expect(cycleNature(bar)).toBe('trampoline')
    expect(cycleNature(bar)).toBe('ephemeral')
    expect(cycleNature(bar)).toBe('wall')
  })

  it('chaque nature a un nom lisible et distinct', () => {
    const labels = NATURES.map(natureLabel)
    expect(new Set(labels).size).toBe(NATURES.length)
    expect(labels.every((l) => l.length > 2)).toBe(true)
  })
})

describe('AE1 / R3 — un trampoline ne s’emballe pas', () => {
  it('la borne de vitesse est **dérivée de la hauteur au-dessus de l’impact**, pas choisie', () => {
    // v = sqrt(2·g·d) : la vitesse dont l'apogée touche exactement le bord haut, marge comprise.
    const impactY = 500
    const cap = maxBounceSpeed(1400, impactY)
    const apex = impactY - (cap * cap) / (2 * 1400)
    expect(apex).toBeCloseTo(12, 6)
    // Plus l'impact est haut, moins il reste de place : la borne suit.
    expect(maxBounceSpeed(1400, 200)).toBeLessThan(cap)
    // Et au ras du bord haut, un trampoline ne peut plus rien lancer.
    expect(maxBounceSpeed(1400, 8)).toBe(0)
  })

  it('vingt rebonds d’affilée : la bille ne sort jamais par le haut et sa vitesse reste bornée', () => {
    const w = world()
    floor(w, 'trampoline')
    const ball = spawnBall(w, { x: 600, y: 120 }, { x: 0, y: 0 })

    // Plafond calculé depuis la **hauteur de la barre**, pas celle de la scène : prendre `bounds.h`
    // donnait une borne plus généreuse que la vraie, donc une assertion plus faible que son nom.
    const cap = maxBounceSpeed(w.gravity.y, 500)
    let bounces = 0
    let highest = ball.pos.y
    let fastest = 0
    for (let i = 0; i < Math.round(40 / DT) && bounces < 20; i += 1) {
      const impacts = stepWorld(w, DT)
      bounces += impacts.length
      const live = w.balls[0]
      if (!live) break
      highest = Math.min(highest, live.pos.y)
      fastest = Math.max(fastest, Math.hypot(live.vel.x, live.vel.y))
    }

    expect(bounces).toBeGreaterThanOrEqual(20)
    /*
     * Le **bord haut de la bille** reste dans le champ, pas seulement son centre. Une première version
     * n'exigeait que `highest > 0` : le centre restait dedans et la bille était à moitié dehors —
     * mesuré, centre à y = 1 pour un rayon de 8.
     */
    expect(highest - (w.balls[0]?.radius ?? 8)).toBeGreaterThan(0)
    // La vitesse ne dépasse pas le plafond, à la contribution de la gravité entre deux pas près.
    expect(fastest).toBeLessThan(cap + Math.abs(w.gravity.y) * DT * 2)
  })

  it('un mur ne rend pas plus d’énergie qu’il n’en reçoit', () => {
    expect(restitutionFor('wall', 0.62)).toBe(0.62)
    expect(restitutionFor('ephemeral', 0.62)).toBe(0.62)
    expect(restitutionFor('trampoline', 0.62)).toBeGreaterThan(1)
  })
})

describe('AE2 / R4 — une barre éphémère s’efface puis revient', () => {
  it('elle encaisse exactement le nombre d’impacts annoncé, puis s’efface', () => {
    const w = world()
    const bar = floor(w, 'ephemeral')
    for (let i = 1; i < EPHEMERAL_HITS; i += 1) {
      expect(registerHit(bar, 900, 1, w.bpm)).toBe(false)
      expect(isPresent(bar, 1)).toBe(true)
    }
    expect(registerHit(bar, 900, 1, w.bpm)).toBe(true)
    expect(isPresent(bar, 1)).toBe(false)
  })

  it('elle revient sur un temps de mesure, avec sa vie réarmée', () => {
    const w = world()
    const bar = floor(w, 'ephemeral')
    bar.hitsLeft = 1
    registerHit(bar, 900, 1.3, w.bpm)

    const measure = barSeconds(w.bpm)
    expect(bar.absentUntil).toBeGreaterThan(1.3)
    expect(Math.abs(bar.absentUntil / measure - Math.round(bar.absentUntil / measure))).toBeLessThan(
      1e-9
    )
    expect(bar.hitsLeft).toBe(EPHEMERAL_HITS)
    expect(isPresent(bar, bar.absentUntil)).toBe(true)
  })

  it('un frôlement inaudible ne consomme pas de vie — le seuil est celui du son', () => {
    // Deux seuils distincts dériveraient : on verrait une barre s'user sans rien entendre. C'est la
    // même règle que pour les étincelles de l'US6.
    const w = world()
    const bar = floor(w, 'ephemeral')
    expect(registerHit(bar, MIN_IMPACT_SPEED - 0.001, 1, w.bpm)).toBe(false)
    expect(bar.hitsLeft).toBe(EPHEMERAL_HITS)
    expect(registerHit(bar, MIN_IMPACT_SPEED + 0.001, 1, w.bpm)).toBe(false)
    expect(bar.hitsLeft).toBe(EPHEMERAL_HITS - 1)
  })

  it('absente, elle laisse passer les billes sans note', () => {
    const w = world()
    const bar = floor(w, 'ephemeral')
    bar.absentUntil = 10
    spawnBall(w, { x: 600, y: 120 }, { x: 0, y: 0 })

    let impacts = 0
    for (let i = 0; i < Math.round(1.2 / DT); i += 1) impacts += stepWorld(w, DT).length

    expect(impacts).toBe(0)
    // Et la bille est bien passée **au travers**, pas arrêtée au-dessus.
    expect(w.balls[0]?.pos.y ?? Number.POSITIVE_INFINITY).toBeGreaterThan(bar.a.y)
  })

  it('une barre non éphémère ne s’efface jamais', () => {
    const w = world()
    for (const nature of ['wall', 'trampoline'] as const) {
      const bar = floor(w, nature)
      for (let i = 0; i < 50; i += 1) expect(registerHit(bar, 3000, i, w.bpm)).toBe(false)
      expect(isPresent(bar, 100)).toBe(true)
    }
  })
})

describe('C9 — une absence doit s’entendre', () => {
  it('l’absence dure au moins son plancher, **quel que soit** l’instant du dernier impact', () => {
    /*
     * Le retour est quantifié sur la mesure, pas la durée : une barre touchée juste avant la barre de
     * mesure disparaissait 1 ms — un huitième de pas de simulation, donc pas du tout. On balaye toute
     * la mesure, y compris ses derniers millièmes.
     */
    const w = world()
    const measure = barSeconds(w.bpm)
    for (const phase of [0, 0.25, 0.5, 0.9, 0.98, 0.999, 0.9999]) {
      const bar = floor(w, 'ephemeral')
      const time = measure * 3 + measure * phase
      bar.hitsLeft = 1
      registerHit(bar, 900, time, w.bpm)
      expect(bar.absentUntil - time).toBeGreaterThanOrEqual(MIN_ABSENCE_SECONDS)
      // Et le retour reste **sur** la grille : le plancher décale d'une mesure, il ne désaligne pas.
      expect(Math.abs(bar.absentUntil / measure - Math.round(bar.absentUntil / measure))).toBeLessThan(
        1e-9
      )
    }
  })
})

describe('C1 — le plafond ne bride que ce qui injecte de l’énergie', () => {
  /**
   * Rejoue un rebond et renvoie la vitesse d'impact mesurée **par la simulation** (`impact.speed`, la
   * composante normale avant réflexion) et la vitesse sortante. Se calibrer sur l'impact réel évite
   * tout nombre en dur : la relation attendue est `sortant = restitution × entrant`.
   *
   * La gravité reste **active**. Une première version la mettait à zéro « pour isoler le rebond » — ce
   * qui désactive le plafond lui-même (`maxBounceSpeed` vaut l'infini sans gravité) : le test
   * neutralisait le mécanisme qu'il devait surveiller, et la mutation passait.
   */
  function bounceOnce(w: World, from: Vec2, vel: Vec2): { entrant: number; sortant: Vec2 } {
    const ball = spawnBall(w, from, vel)
    for (let i = 0; i < Math.round(2 / DT); i += 1) {
      const impacts = stepWorld(w, DT)
      const impact = impacts[0]
      if (impact) return { entrant: impact.speed, sortant: { x: ball.vel.x, y: ball.vel.y } }
    }
    throw new Error('aucun rebond')
  }

  it('un mur vertical rend ce qu’il reçoit, sans être bridé par la place au-dessus', () => {
    /*
     * Première version du plafond : comparée à la composante normale de **toute** barre, dans n'importe
     * quel sens. Mesuré, elle ramenait le sortant d'un mur vertical de 720 à 579 px/s — une barre
     * passive qui vole de l'énergie.
     */
    const w = world()
    addBar(w, { x: 900, y: 20 }, { x: 900, y: 400 }, 60)
    const { entrant, sortant } = bounceOnce(w, { x: 700, y: 140 }, { x: 900, y: 0 })
    expect(Math.abs(sortant.x)).toBeCloseTo(0.8 * entrant, 0)
  })

  it('un rebond vers le bas n’est pas bridé non plus', () => {
    // Barre haute, bille qui **monte** vite : le rebond la renvoie vers le bas, donc « la place
    // au-dessus » n'a rien à voir avec ce mouvement.
    const w = world()
    addBar(w, { x: 300, y: 60 }, { x: 900, y: 60 }, 60)
    const { entrant, sortant } = bounceOnce(w, { x: 600, y: 200 }, { x: 0, y: -1200 })
    expect(sortant.y).toBeGreaterThan(0)
    expect(sortant.y).toBeCloseTo(0.8 * entrant, 0)
  })
})

describe('AE3 / SC1 — le motif évolue au lieu de se répéter', () => {
  it('deux mesures consécutives ne jouent pas la même suite de notes', () => {
    /*
     * C'est **le** critère de succès de ce travail : avant les natures, une scène tempo-verrouillée
     * rejouait exactement la même mesure indéfiniment. On mesure la suite de notes de deux mesures
     * consécutives et on exige qu'elles diffèrent.
     */
    const w = world()
    // Deux barres : une éphémère qui s'efface, une permanente en dessous pour que la bille joue
    // quelque chose quand la première est absente.
    addBar(w, { x: 400, y: 380 }, { x: 800, y: 380 }, 72, undefined, 'ephemeral')
    addBar(w, { x: 300, y: 600 }, { x: 900, y: 600 }, 60, undefined, 'wall')

    const measure = barSeconds(w.bpm)
    const byMeasure = new Map<number, number[]>()
    let dropped = 0
    for (let i = 0; i < Math.round(measure * 8 / DT); i += 1) {
      // Une bille par demi-mesure, toujours au même endroit : la scène est parfaitement périodique
      // **sauf** pour l'effacement de la barre éphémère.
      if (i % Math.round(measure / 2 / DT) === 0) {
        spawnBall(w, { x: 600, y: 100 }, { x: 0, y: 0 })
        dropped += 1
      }
      for (const impact of stepWorld(w, DT)) {
        const index = Math.floor(impact.at / measure)
        const list = byMeasure.get(index) ?? []
        list.push(impact.barId)
        byMeasure.set(index, list)
      }
    }

    expect(dropped).toBeGreaterThan(8)
    const sequences = [...byMeasure.entries()]
      .filter(([index]) => index >= 1 && index <= 6)
      .map(([, ids]) => ids.join(','))
    expect(sequences.length).toBeGreaterThanOrEqual(4)
    // Au moins deux mesures consécutives diffèrent : le motif dérive.
    const distinct = new Set(sequences)
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('sans barre éphémère, la scène **se répète** — c’est bien la nature qui fait dériver', () => {
    // Contrôle : sans lui, le test précédent pourrait passer pour une raison sans rapport (flottants,
    // ordre d'impacts). Ici la même scène, tous murs, doit être strictement périodique.
    const w = world()
    addBar(w, { x: 400, y: 380 }, { x: 800, y: 380 }, 72, undefined, 'wall')
    addBar(w, { x: 300, y: 600 }, { x: 900, y: 600 }, 60, undefined, 'wall')

    const measure = barSeconds(w.bpm)
    const byMeasure = new Map<number, number[]>()
    for (let i = 0; i < Math.round(measure * 8 / DT); i += 1) {
      if (i % Math.round(measure / 2 / DT) === 0) spawnBall(w, { x: 600, y: 100 }, { x: 0, y: 0 })
      for (const impact of stepWorld(w, DT)) {
        const index = Math.floor(impact.at / measure)
        const list = byMeasure.get(index) ?? []
        list.push(impact.barId)
        byMeasure.set(index, list)
      }
    }

    const sequences = [...byMeasure.entries()]
      .filter(([index]) => index >= 2 && index <= 6)
      .map(([, ids]) => ids.join(','))
    expect(sequences.length).toBeGreaterThanOrEqual(4)
    expect(new Set(sequences).size).toBe(1)
  })
})
