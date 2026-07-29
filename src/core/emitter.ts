import { DIVISIONS, DEFAULT_DIVISION_INDEX, divisionAt, divisionSeconds, gridTimeAfter } from './clock'
import type { Emitter, Respawn, Vec2, World } from './types'

/** Plafond global de billes vivantes : au-delà, la perf se dégrade sans que rien ne le signale. */
export const MAX_BALLS = 320
/**
 * Émissions maximales par source et par pas. Sans ce garde-fou, un grand saut de temps (onglet
 * revenu au premier plan, rattrapage) produirait des centaines de billes en une frame.
 */
const MAX_EMISSIONS_PER_STEP = 4
/**
 * Budget **propre aux retours**, bien plus large que celui des sources, et c'est voulu.
 *
 * Une source qui rattrape son retard doit être bridée : ses échéances manquées sont du passé, les
 * honorer toutes produirait une rafale que personne n'a demandée. Un retour de bille, à l'inverse, est
 * attendu **à un instant précis de la grille** : si trente billes recyclées sont dues sur le même temps,
 * elles doivent revenir *ensemble* — c'est ça, le motif. Les brider à quatre par pas les étalerait sur
 * plusieurs mesures et dissoudrait le geste initial.
 *
 * Le plafond global de billes (`MAX_BALLS`) reste le garde-fou de fond : il s'applique juste après.
 *
 * À ne pas confondre avec un arriéré : une bille recyclée passe ~1,1 s en vol et le reste de la mesure
 * à **attendre son temps**. Une file bien remplie est donc l'état normal d'une scène en boucle, pas le
 * signe d'un étranglement — ce que `pendingRespawns` mesure est une attente, pas un retard.
 */
export const MAX_RESPAWNS_PER_STEP = 48

export interface EmitterOptions {
  divisionIndex?: number
  hue?: number
}

/** Période d'une source en secondes, **dérivée** de sa division et du tempo — jamais stockée. */
export function emitterPeriod(emitter: Emitter, bpm: number): number {
  return divisionSeconds(divisionAt(emitter.divisionIndex), bpm)
}

export function addEmitter(world: World, pos: Vec2, options?: EmitterOptions): Emitter {
  const divisionIndex = clampDivisionIndex(options?.divisionIndex ?? DEFAULT_DIVISION_INDEX)
  const id = world.nextEmitterId++
  const emitter: Emitter = {
    id,
    pos: { x: pos.x, y: pos.y },
    divisionIndex,
    // Pas d'émission à l'instant de la création : poser une source ne doit pas produire un « plop »
    // surprise sous le doigt qui vient de la poser. La première échéance est **sur la grille**, donc
    // une source posée n'importe quand tombe malgré tout en phase avec celles déjà en place.
    nextAt: gridTimeAfter(world.time, divisionAt(divisionIndex), world.bpm),
    // Teintes froides dérivées de l'id, comme les billes lâchées à la main : la couleur chaude reste
    // réservée aux barres, qui portent la hauteur.
    hue: options?.hue ?? 190 + ((id * 53) % 90),
  }
  world.emitters.push(emitter)
  return emitter
}

export function clampDivisionIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= DIVISIONS.length) {
    return DEFAULT_DIVISION_INDEX
  }
  return index
}

/**
 * Fait passer une source à la division suivante, en boucle. C'est le seul geste qui construit un
 * motif : sans lui, toutes les sources partagent la même division et la scène n'a qu'un seul rythme.
 * Ré-arme sur la grille pour que le changement prenne effet **en phase**, sans rafale ni trou.
 */
export function cycleDivision(world: World, emitter: Emitter): number {
  emitter.divisionIndex = (emitter.divisionIndex + 1) % DIVISIONS.length
  emitter.nextAt = gridTimeAfter(world.time, divisionAt(emitter.divisionIndex), world.bpm)
  return emitter.divisionIndex
}

/**
 * Fait émettre les sources dues à `world.time`, puis applique le plafond de billes.
 *
 * L'échéance est **recalculée depuis la grille** à chaque émission, jamais cumulée (`nextAt += period`).
 * C'est ce qui met deux sources de même division en phase et les y maintient : une accumulation dérive
 * par erreurs de flottants, et une échéance stockée doit être resynchronisée à chaque changement de
 * tempo, d'annulation ou de rechargement — le défaut exact qui produisait une rafale de billes à
 * l'annulation en US4.
 */
export function runEmitters(world: World, spawn: (pos: Vec2, hue: number) => void): number {
  let spawned = 0

  for (const emitter of world.emitters) {
    const division = divisionAt(clampDivisionIndex(emitter.divisionIndex))
    let emissions = 0
    while (emitter.nextAt <= world.time && emissions < MAX_EMISSIONS_PER_STEP) {
      spawn(emitter.pos, emitter.hue)
      emitter.nextAt = gridTimeAfter(emitter.nextAt, division, world.bpm)
      emissions++
      spawned++
    }
    // Retard trop grand pour être rattrapé dans le budget : on repart de la grille plutôt que de
    // traîner une dette d'échéances qui ferait cracher la source pendant plusieurs secondes.
    if (emitter.nextAt <= world.time) {
      emitter.nextAt = gridTimeAfter(world.time, division, world.bpm)
    }
  }

  // Les billes sont créées par `push`, donc les plus anciennes sont en tête : on coupe par le début.
  if (world.balls.length > MAX_BALLS) {
    world.balls.splice(0, world.balls.length - MAX_BALLS)
  }

  return spawned
}

/**
 * Fait revenir les billes recyclées dont l'instant est venu. Renvoie le nombre de retours.
 *
 * Borné par le même garde-fou que les sources : après un long saut de temps (onglet en arrière-plan),
 * des dizaines de retours peuvent être dus, et les tirer tous d'un coup produirait une rafale.
 */
export function runRespawns(
  world: World,
  spawn: (pos: Vec2, hue: number, vel: Vec2) => void
): number {
  if (world.respawns.length === 0) return 0

  let returned = 0
  const waiting: Respawn[] = []
  for (const respawn of world.respawns) {
    if (respawn.at <= world.time && returned < MAX_RESPAWNS_PER_STEP) {
      spawn(respawn.pos, respawn.hue, respawn.vel)
      returned += 1
    } else if (respawn.at <= world.time) {
      // Dû mais hors budget : on le décale d'une mesure plutôt que de le perdre — une bille recyclée
      // qui disparaît silencieusement serait vécue comme un bug, pas comme une limite.
      waiting.push({ ...respawn, at: gridTimeAfter(world.time, divisionAt(0), world.bpm) })
    } else {
      waiting.push(respawn)
    }
  }
  world.respawns = waiting
  return returned
}

export function removeEmitter(world: World, id: number): void {
  const index = world.emitters.findIndex((emitter) => emitter.id === id)
  if (index >= 0) world.emitters.splice(index, 1)
}
