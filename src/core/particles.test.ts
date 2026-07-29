import { describe, expect, it } from 'vitest'

import { MIN_IMPACT_SPEED, gainForImpact } from './music'
import {
  MAX_PARTICLES,
  MAX_PER_IMPACT,
  PARTICLE_LIFE,
  SPEED_MAX,
  SPEED_MIN,
  advanceParticles,
  clearParticles,
  createParticleField,
  particleFade,
  spawnImpactParticles,
} from './particles'
import { createRng } from './rng'
import type { ImpactEvent } from './types'

function impact(speed: number, at = 0): ImpactEvent {
  return { barId: 1, ballId: 1, point: { x: 100, y: 100 }, normal: { x: 0, y: -1 }, speed, at }
}

describe('particules — audibilité', () => {
  it('un impact sous le seuil audible ne produit aucune étincelle', () => {
    const field = createParticleField()
    const rand = createRng(1)
    expect(spawnImpactParticles(field, impact(MIN_IMPACT_SPEED - 1), rand, 60)).toBe(0)
    expect(field.particles).toHaveLength(0)
  })

  it('le seuil des étincelles est exactement celui du son, pas un seuil parallèle', () => {
    // Deux seuils distincts dériveraient : on verrait des éclats muets, ou des notes sans éclat.
    const rand = createRng(2)
    const justBelow = createParticleField()
    const justAt = createParticleField()
    spawnImpactParticles(justBelow, impact(MIN_IMPACT_SPEED - 0.001), rand, 60)
    spawnImpactParticles(justAt, impact(MIN_IMPACT_SPEED + 0.001), rand, 60)
    expect(justBelow.particles).toHaveLength(0)
    expect(justAt.particles.length).toBeGreaterThan(0)
  })

  it('un impact violent produit plus d’étincelles qu’un impact faible, sans dépasser le plafond', () => {
    const rand = createRng(3)
    const soft = createParticleField()
    const hard = createParticleField()
    const softCount = spawnImpactParticles(soft, impact(MIN_IMPACT_SPEED + 30), rand, 60)
    const hardCount = spawnImpactParticles(hard, impact(4000), rand, 60)
    expect(softCount).toBeLessThan(hardCount)
    expect(hardCount).toBe(MAX_PER_IMPACT)
    expect(softCount).toBeGreaterThanOrEqual(1)
  })
})

describe('particules — la violence se voit', () => {
  const speedOf = (p: { vx: number; vy: number }) => Math.hypot(p.vx, p.vy)

  it('la vitesse d’une étincelle est bornée par l’intensité de son impact', () => {
    // Règle **exacte** sur le domaine, pas un ratio de portées. La première version comparait la
    // portée maximale d'une gerbe violente (9 étincelles) à celle d'une gerbe faible (1 étincelle) :
    // le facteur était financé par l'écart de **cardinal**, pas par la vitesse, et supprimer
    // `* strength` la laissait passer.
    for (const speed of [MIN_IMPACT_SPEED + 5, MIN_IMPACT_SPEED + 60, 800, 4000]) {
      const field = createParticleField()
      const strength = gainForImpact(speed)
      spawnImpactParticles(field, impact(speed), createRng(20), 60)
      const ceiling = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * strength
      for (const particle of field.particles) {
        expect(speedOf(particle)).toBeGreaterThanOrEqual(SPEED_MIN - 1e-9)
        expect(speedOf(particle)).toBeLessThanOrEqual(ceiling + 1e-9)
      }
    }
  })

  it('un impact violent dépasse le plafond de vitesse d’un impact faible', () => {
    const weak = gainForImpact(MIN_IMPACT_SPEED + 20)
    const weakCeiling = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * weak
    const strong = createParticleField()
    spawnImpactParticles(strong, impact(4000), createRng(21), 60)
    expect(Math.max(...strong.particles.map(speedOf))).toBeGreaterThan(weakCeiling)
  })

  it('les étincelles d’une même gerbe n’ont pas toutes la même vitesse', () => {
    const field = createParticleField()
    spawnImpactParticles(field, impact(3000), createRng(22), 60)
    const speeds = field.particles.map(speedOf)
    expect(new Set(speeds.map((s) => s.toFixed(3))).size).toBeGreaterThan(1)
  })
})

describe('particules — la gerbe doit quitter le halo', () => {
  /**
   * Rayon du halo d'une bille au rendu, **dérivé du rendu et non estimé** : le sprite de lueur est
   * dessiné sur `ball.radius * 7` px de côté (`renderer.ts`), soit 8 × 7 / 2 = 28 px de rayon, et son
   * dégradé atteint alpha 0 exactement là.
   *
   * C'est le nombre qui décide si une gerbe se voit. Avec le réglage d'origine (5 étincelles,
   * 60→220 px/s, freinage 3,4) les étincelles mouraient à ~20 px du contact, donc **dans** un halo déjà
   * blanc saturé : présentes dans l'état, invisibles à l'écran.
   *
   * La marge est mince — 29,4 px mesurés contre 28 exigés — et c'est **voulu** : le cœur est
   * déterministe (graine fixe), donc cette valeur est exacte et reproductible, pas instable. Un seuil
   * posé au vrai bord du halo fait tomber le test au moindre affaiblissement du réglage, ce qu'un
   * seuil confortable ne ferait pas.
   */
  const HALO_RADIUS = 28

  it('une gerbe pleine puissance sort du halo de la bille en 70 ms', () => {
    const field = createParticleField()
    const origin = impact(4000)
    spawnImpactParticles(field, origin, createRng(30), 60)
    for (let i = 0; i < Math.round(0.07 * 120); i += 1) advanceParticles(field, 1 / 120)
    const reach = Math.max(
      ...field.particles.map((p) => Math.hypot(p.x - origin.point.x, p.y - origin.point.y))
    )
    expect(reach).toBeGreaterThan(HALO_RADIUS)
  })

  it('elles sont encore vivantes à cet instant — sortir du halo après sa mort ne sert à rien', () => {
    const field = createParticleField()
    spawnImpactParticles(field, impact(4000), createRng(31), 60)
    for (let i = 0; i < Math.round(0.07 * 120); i += 1) advanceParticles(field, 1 / 120)
    expect(field.particles.length).toBeGreaterThan(0)
    expect(field.particles.every((p) => particleFade(p) > 0.2)).toBe(true)
  })
})

describe('particules — ce que le rendu lira', () => {
  it('chaque étincelle porte l’intensité de son impact, pas une constante', () => {
    // `strength` pilote l'opacité et l'épaisseur au rendu : « un impact doux fait une étincelle
    // discrète » n'était vérifié nulle part, et le remplacer par 1 passait tous les tests.
    for (const speed of [MIN_IMPACT_SPEED + 5, 600, 4000]) {
      const field = createParticleField()
      spawnImpactParticles(field, impact(speed), createRng(23), 60)
      const expected = gainForImpact(speed)
      expect(field.particles.length).toBeGreaterThan(0)
      for (const particle of field.particles) {
        expect(particle.strength).toBeCloseTo(expected, 12)
      }
    }
  })

  it('chaque étincelle porte la note de son impact — c’est de là que vient sa teinte', () => {
    const field = createParticleField()
    const rand = createRng(24)
    spawnImpactParticles(field, impact(3000), rand, 48)
    spawnImpactParticles(field, impact(3000), rand, 79)
    expect(new Set(field.particles.map((p) => p.midi))).toEqual(new Set([48, 79]))
    // et la note ne dérive pas d'une gerbe à l'autre : chaque étincelle garde celle de son impact
    expect(field.particles.filter((p) => p.midi === 48).length).toBe(MAX_PER_IMPACT)
    expect(field.particles.filter((p) => p.midi === 79).length).toBe(MAX_PER_IMPACT)
  })
})

describe('particules — bornes', () => {
  it('mille impacts consécutifs ne dépassent jamais le plafond global', () => {
    const field = createParticleField()
    const rand = createRng(4)
    for (let i = 0; i < 1000; i += 1) {
      spawnImpactParticles(field, impact(3000, i * 0.01), rand, 60)
      expect(field.particles.length).toBeLessThanOrEqual(MAX_PARTICLES)
    }
    expect(field.particles.length).toBe(MAX_PARTICLES)
  })

  it('au plafond, ce sont les plus anciennes qui cèdent la place — pas les plus récentes', () => {
    const field = createParticleField()
    const rand = createRng(5)
    // Âges **étagés** : sans cela, toutes les étincelles se ressemblent et le test passerait aussi
    // bien si l'éviction frappait la fin du tableau. C'est l'écart d'âge qui rend la règle observable.
    const step = 0.005
    while (field.particles.length + MAX_PER_IMPACT <= MAX_PARTICLES) {
      spawnImpactParticles(field, impact(3000), rand, 60)
      advanceParticles(field, step)
    }
    const before = [...field.particles]

    const created = spawnImpactParticles(field, impact(3000), rand, 60)

    expect(created).toBe(MAX_PER_IMPACT)
    expect(field.particles).toHaveLength(MAX_PARTICLES)
    // le nouvel impact est bien là
    expect(field.particles.filter((p) => p.age === 0)).toHaveLength(MAX_PER_IMPACT)

    const evicted = before.filter((p) => !field.particles.includes(p))
    const survivors = before.filter((p) => field.particles.includes(p))
    expect(evicted.length).toBeGreaterThan(0)
    // La règle exacte : **toute** évincée est au moins aussi vieille que **toute** survivante. Une
    // première version exigeait que l'âge maximal baisse — faux dès qu'une gerbe n'est évincée qu'en
    // partie (le plafond n'est pas un multiple de la taille de gerbe), alors que la règle tenait.
    const oldestSurvivor = Math.max(...survivors.map((p) => p.age))
    expect(Math.min(...evicted.map((p) => p.age))).toBeGreaterThanOrEqual(oldestSurvivor)
  })
})

describe('particules — cycle de vie', () => {
  it('une étincelle disparaît à la fin de sa durée de vie', () => {
    const field = createParticleField()
    spawnImpactParticles(field, impact(3000), createRng(6), 60)
    expect(field.particles.length).toBeGreaterThan(0)
    advanceParticles(field, PARTICLE_LIFE - 0.001)
    expect(field.particles.length).toBeGreaterThan(0)
    advanceParticles(field, 0.002)
    expect(field.particles).toHaveLength(0)
  })

  it('le champ ne fuit pas : sans nouvel impact, il revient toujours à vide', () => {
    const field = createParticleField()
    const rand = createRng(7)
    for (let i = 0; i < 50; i += 1) spawnImpactParticles(field, impact(3000), rand, 60)
    for (let i = 0; i < 100; i += 1) advanceParticles(field, 1 / 60)
    expect(field.particles).toHaveLength(0)
  })

  it('les étincelles s’éloignent du point d’impact puis ralentissent', () => {
    const field = createParticleField()
    spawnImpactParticles(field, impact(3000), createRng(8), 60)
    const start = field.particles.map((p) => ({ x: p.x, y: p.y }))
    advanceParticles(field, 1 / 60)
    const firstStep = field.particles.map((p, i) => Math.hypot(p.x - start[i]!.x, p.y - start[i]!.y))
    advanceParticles(field, 1 / 60)
    const secondStep = field.particles.map((p, i) =>
      Math.hypot(p.x - start[i]!.x, p.y - start[i]!.y)
    )
    expect(firstStep.every((d) => d > 0)).toBe(true)
    // toujours plus loin, mais le second pas est plus court que le premier (freinage)
    for (let i = 0; i < firstStep.length; i += 1) {
      expect(secondStep[i]!).toBeGreaterThan(firstStep[i]!)
      expect(secondStep[i]! - firstStep[i]!).toBeLessThan(firstStep[i]!)
    }
  })

  it('l’opacité décroît de 1 à 0 sur la durée de vie', () => {
    const field = createParticleField()
    spawnImpactParticles(field, impact(3000), createRng(9), 60)
    const particle = field.particles[0]!
    expect(particleFade(particle)).toBeCloseTo(1, 5)
    particle.age = PARTICLE_LIFE / 2
    expect(particleFade(particle)).toBeCloseTo(0.5, 5)
    particle.age = PARTICLE_LIFE
    expect(particleFade(particle)).toBe(0)
  })

  it('les étincelles s’éloignent réellement du côté d’où arrive la bille', () => {
    const field = createParticleField()
    const origin = impact(3000)
    spawnImpactParticles(field, origin, createRng(10), 60)
    expect(field.particles.every((p) => p.vy < 0)).toBe(true)

    // La vitesse ne suffit pas à prouver le rendu : c'est la **position** qui se dessine. Une version
    // qui n'intégrait pas `vy` passait le test précédent sans qu'aucune étincelle ne monte jamais.
    advanceParticles(field, 1 / 60)
    expect(field.particles.every((p) => p.y < origin.point.y)).toBe(true)
    advanceParticles(field, 1 / 60)
    expect(field.particles.every((p) => p.y < origin.point.y)).toBe(true)
  })

  it('une gerbe s’ouvre en éventail, elle ne part pas en un seul rayon', () => {
    const field = createParticleField()
    const origin = impact(3000)
    spawnImpactParticles(field, origin, createRng(12), 60)
    // Deux propriétés distinctes, chacune invisible pour l'autre test : les étincelles divergent
    // **en direction** (angles distincts) et le nuage s'étale **en x** une fois intégré.
    const angles = field.particles.map((p) => Math.atan2(p.vy, p.vx))
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(0.2)

    advanceParticles(field, 1 / 60)
    advanceParticles(field, 1 / 60)
    const xs = field.particles.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1)
    expect(xs.some((x) => x !== origin.point.x)).toBe(true)
  })

  it('un même seed rejoue exactement les mêmes étincelles', () => {
    const shape = (seed: number) => {
      const field = createParticleField()
      const rand = createRng(seed)
      for (let i = 0; i < 5; i += 1) spawnImpactParticles(field, impact(1200), rand, 60)
      return field.particles.map((p) => [p.vx, p.vy])
    }
    expect(shape(42)).toEqual(shape(42))
    expect(shape(42)).not.toEqual(shape(43))
  })

  it('clearParticles vide le champ', () => {
    const field = createParticleField()
    spawnImpactParticles(field, impact(3000), createRng(11), 60)
    clearParticles(field)
    expect(field.particles).toHaveLength(0)
  })
})
