/**
 * Étincelles d'impact. Pur, déterministe (le hasard est injecté), zéro DOM — donc testable.
 *
 * Deux invariants portent tout le reste : une étincelle ne naît **que** d'un impact audible (sinon
 * l'œil verrait des notes qui ne sonnent pas, et la vue mentirait sur ce qu'on entend), et leur
 * nombre est **borné globalement** (le plafond de billes est à 320, chacune pouvant rebondir
 * plusieurs fois par seconde).
 */

import { gainForImpact } from './music'
import type { ImpactEvent } from './types'

export const MAX_PARTICLES = 240
/** à pleine puissance ; un impact tout juste audible n'en produit qu'une */
export const MAX_PER_IMPACT = 9
export const PARTICLE_LIFE = 0.45

/*
 * Ces trois nombres ont été **réglés sur capture**, pas au jugé. La première version (5 étincelles,
 * 60→220 px/s, freinage 3,4) était présente dans l'état et invisible à l'écran : chaque étincelle
 * naissait au centre du halo de la bille — déjà blanc saturé — et le freinage l'empêchait d'en sortir
 * avant de mourir. Il faut donc qu'elles **quittent le halo** (~30 px) pour exister.
 */
export const SPEED_MIN = 150
export const SPEED_MAX = 520
/** demi-angle du cône d'éjection autour de la normale, en radians (~50°) */
const SPREAD = 0.9
/** freinage exponentiel : les étincelles ralentissent au lieu de filer en ligne droite */
const DRAG = 2.4

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /** secondes écoulées depuis la naissance */
  age: number
  /** intensité de l'impact d'origine (0..1), pilote la taille et l'opacité au rendu */
  strength: number
  /** note jouée par cet impact ; le rendu en dérive la teinte, le cœur ignore les couleurs */
  midi: number
}

export interface ParticleField {
  particles: Particle[]
}

export function createParticleField(): ParticleField {
  return { particles: [] }
}

/**
 * Éjecte des étincelles depuis un impact. Renvoie le nombre réellement créé — c'est ce que les tests
 * observent, et c'est 0 pour un impact inaudible.
 *
 * `rand` est injecté : la simulation doit rester rejouable à l'identique pour un même seed.
 */
export function spawnImpactParticles(
  field: ParticleField,
  impact: ImpactEvent,
  rand: () => number,
  midi: number
): number {
  const strength = gainForImpact(impact.speed)
  if (strength <= 0) return 0

  const count = Math.max(1, Math.round(strength * MAX_PER_IMPACT))
  // On fait la place **avant** d'insérer, en évinçant les plus anciennes : au plafond, le dernier
  // impact reste visible. Laisser tomber les nouvelles ferait geler l'effet pile quand la scène
  // devient dense, c'est-à-dire exactement quand on la regarde.
  const overflow = field.particles.length + count - MAX_PARTICLES
  if (overflow > 0) field.particles.splice(0, overflow)

  const base = Math.atan2(impact.normal.y, impact.normal.x)
  for (let i = 0; i < count; i += 1) {
    const angle = base + (rand() * 2 - 1) * SPREAD
    const speed = SPEED_MIN + rand() * (SPEED_MAX - SPEED_MIN) * strength
    field.particles.push({
      x: impact.point.x,
      y: impact.point.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      strength,
      midi,
    })
  }
  return count
}

/**
 * Avance le champ d'un pas et retire les étincelles mortes. Aucune gravité : ce sont des éclats de
 * lumière, pas des débris — leur trajectoire doit se lire comme un éclat, non comme une chute.
 */
export function advanceParticles(field: ParticleField, dt: number): void {
  const decay = Math.exp(-DRAG * dt)
  let write = 0
  for (const particle of field.particles) {
    particle.age += dt
    if (particle.age >= PARTICLE_LIFE) continue
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.vx *= decay
    particle.vy *= decay
    field.particles[write] = particle
    write += 1
  }
  field.particles.length = write
}

export function clearParticles(field: ParticleField): void {
  field.particles.length = 0
}

/** 1 à la naissance, 0 à la mort — l'opacité de rendu, exposée ici pour rester testable. */
export function particleFade(particle: Particle): number {
  return Math.max(0, 1 - particle.age / PARTICLE_LIFE)
}
