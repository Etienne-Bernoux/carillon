import type { Emitter, Vec2, World } from './types'

/** Période par défaut d'une source, en secondes de simulation. */
export const DEFAULT_PERIOD = 0.9
/** En dessous, une source noie la scène et le budget de polyphonie ne suit plus. */
export const MIN_PERIOD = 0.15
/** Plafond global de billes vivantes : au-delà, la perf se dégrade sans que rien ne le signale. */
export const MAX_BALLS = 320
/**
 * Émissions maximales par source et par pas. Sans ce garde-fou, un grand saut de temps (onglet
 * revenu au premier plan, rattrapage) produirait des centaines de billes en une frame.
 */
const MAX_EMISSIONS_PER_STEP = 4

export interface EmitterOptions {
  period?: number
  hue?: number
}

export function addEmitter(world: World, pos: Vec2, options?: EmitterOptions): Emitter {
  const period = Math.max(MIN_PERIOD, options?.period ?? DEFAULT_PERIOD)
  const id = world.nextEmitterId++
  const emitter: Emitter = {
    id,
    pos: { x: pos.x, y: pos.y },
    period,
    // Pas d'émission à l'instant de la création : poser une source ne doit pas produire un « plop »
    // surprise sous le doigt qui vient de la poser.
    nextAt: world.time + period,
    // Teintes froides dérivées de l'id, comme les billes lâchées à la main : la couleur chaude reste
    // réservée aux barres, qui portent la hauteur.
    hue: options?.hue ?? 190 + ((id * 53) % 90),
  }
  world.emitters.push(emitter)
  return emitter
}

/**
 * Fait émettre les sources dues à `world.time`, puis applique le plafond de billes.
 *
 * On compare une **échéance** (`nextAt`) au temps de simulation, jamais un compteur de frames ni une
 * horloge murale : c'est ce qui garde la musique reproductible à graine égale, invariant du noyau
 * depuis l'US1 — et ce qui rendra le partage d'une scène par URL possible.
 */
export function runEmitters(world: World, spawn: (pos: Vec2, hue: number) => void): number {
  let spawned = 0

  for (const emitter of world.emitters) {
    // Période relue à chaque appel : elle est modifiable de l'extérieur, et une valeur nulle ou
    // négative ferait tourner la boucle sans fin.
    const period = Math.max(MIN_PERIOD, emitter.period)
    let emissions = 0
    while (emitter.nextAt <= world.time && emissions < MAX_EMISSIONS_PER_STEP) {
      spawn(emitter.pos, emitter.hue)
      emitter.nextAt += period
      emissions++
      spawned++
    }
    // Retard trop grand pour être rattrapé dans le budget : on repart de maintenant plutôt que de
    // traîner une dette d'échéances qui ferait cracher la source pendant plusieurs secondes.
    if (emitter.nextAt <= world.time) emitter.nextAt = world.time + period
  }

  // Les billes sont créées par `push`, donc les plus anciennes sont en tête : on coupe par le début.
  if (world.balls.length > MAX_BALLS) {
    world.balls.splice(0, world.balls.length - MAX_BALLS)
  }

  return spawned
}

export function removeEmitter(world: World, id: number): void {
  const index = world.emitters.findIndex((emitter) => emitter.id === id)
  if (index >= 0) world.emitters.splice(index, 1)
}
