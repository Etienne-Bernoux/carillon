/**
 * Encoder un air connu dans la géométrie. Pur, déterministe, sans DOM.
 *
 * C'est un problème **inverse** : étant donné une suite de hauteurs, placer des barres pour qu'une seule
 * bille les frappe dans cet ordre. La géométrie reste la partition — on choisit simplement une géométrie
 * qui épelle un air que l'oreille reconnaît.
 *
 * Trois sondes ont précédé ce fichier, et chacune a changé une décision :
 *
 * 1. **Un modèle balistique écrit à la main donne 0 réussite sur 510.** Trois écarts systématiques avec
 *    le pas réel : le rayon effectif de collision (la bille touche 11,5 px avant que son centre
 *    n'atteigne la barre), le frottement tangentiel, et les barres déjà posées qui interceptent la
 *    trajectoire. On ne modélise donc rien : on place, on simule, on vérifie.
 * 2. **Reprendre la simulation depuis un état sauvegardé ne suffit pas** : 9 notes sur 11 placées, 4 sur
 *    11 au rejeu. Un système de rebonds est chaotique, et une reprise n'est pas identique au bit près à
 *    une trajectoire continue. La vérification se fait donc par **rejeu depuis l'instant zéro**, pour
 *    chaque candidat.
 * 3. **La rythmique exacte rend le problème insoluble** (la durée fige le point d'impact, donc la
 *    recherche n'a plus qu'un angle pour satisfaire toute la suite) et la rythmique libre produit des
 *    notes qui se fondent — mesuré, des intervalles de 30 ms. C'est donc une **fenêtre bornée**.
 */

import { TUNINGS, lengthRangeForWidth, midiForLength } from './music'
import { DT, addBar, createWorld, spawnBall, stepWorld } from './physics'
import { createRng } from './rng'
import type { Tuning } from './music'
import type { Bounds, Vec2, World } from './types'

export interface Melody {
  readonly id: string
  readonly label: string
  /** demi-tons au-dessus de la tonique, dans l'ordre joué */
  readonly degrees: readonly number[]
  /** durée de chaque note, en temps */
  readonly beats: readonly number[]
}

/**
 * Airs du **domaine public**, réduits à leur **incipit** : cinq à huit notes suffisent à reconnaître un
 * air, et la bille recyclée le reboucle. Un air entier demanderait une recherche que les sondes ont
 * montrée hors d'atteinte — 4 notes sur 11 au mieux.
 */
export const MELODIES: readonly Melody[] = [
  {
    id: 'au-clair-de-la-lune',
    label: 'Au clair de la lune',
    degrees: [0, 0, 0, 2, 4],
    beats: [1, 1, 1, 1, 2],
  },
  {
    id: 'frere-jacques',
    label: 'Frère Jacques',
    degrees: [0, 2, 4, 0],
    beats: [1, 1, 1, 1],
  },
  {
    id: 'ah-vous-dirai-je-maman',
    label: 'Ah ! vous dirai-je maman',
    degrees: [0, 0, 7, 7, 9, 9, 7],
    beats: [1, 1, 1, 1, 1, 1, 2],
  },
  {
    id: 'ode-a-la-joie',
    label: 'Ode à la joie',
    degrees: [4, 4, 5, 7],
    beats: [1, 1, 1, 1],
  },
]

/** deux notes doivent rester deux notes : en dessous, l'oreille les fusionne */
export const MIN_NOTE_SECONDS = 0.16

/** marge aux bords : une barre posée au ras du HUD serait hors d'atteinte */
const MARGIN = 70

/**
 * Gamme qui **contient** l'air. Sans elle, une note de la mélodie tomberait sur le degré le plus proche
 * et l'air ne serait plus le même — c'est la différence entre transposer et déformer.
 */
export function tuningForMelody(melody: Melody): Tuning | null {
  for (const tuning of TUNINGS) {
    if (melody.degrees.every((degree) => tuning.scale.includes(degree % 12))) return tuning
  }
  return null
}

/**
 * Longueur de barre qui produit **exactement** cette hauteur, ou `null` si cette hauteur est hors
 * d'atteinte à cette largeur. Pour un usage répété, préférer `buildLengthTable` : cette fonction
 * rebalaye tout à chaque appel.
 */
export function lengthForMidi(midi: number, tuning: Tuning, width: number): number | null {
  const { min, max } = lengthRangeForWidth(width)
  let low: number | null = null
  let high: number | null = null
  const steps = 400
  for (let i = 0; i <= steps; i += 1) {
    const length = min + ((max - min) * i) / steps
    if (midiForLength(length, tuning, width) !== midi) continue
    if (low === null) low = length
    high = length
  }
  if (low === null || high === null) return null
  return (low + high) / 2
}

/**
 * Table hauteur → longueur, construite en **un** balayage.
 *
 * `midiForLength` reconstruit et trie sa liste de degrés à chaque appel — c'est un choix documenté de
 * `music.ts`, justifié pour un appel par `pointermove`. Mais la recherche d'un air en fait des milliers :
 * mesuré, la composition coûtait 933 ms pour un budget de 200. Un balayage unique par gamme et par
 * largeur rend le coût négligeable, sans toucher au choix de `music.ts`.
 */
export function buildLengthTable(tuning: Tuning, width: number): Map<number, number> {
  const { min, max } = lengthRangeForWidth(width)
  const first = new Map<number, number>()
  const last = new Map<number, number>()
  const steps = 400
  for (let i = 0; i <= steps; i += 1) {
    const length = min + ((max - min) * i) / steps
    const midi = midiForLength(length, tuning, width)
    if (!first.has(midi)) first.set(midi, length)
    last.set(midi, length)
  }
  const table = new Map<number, number>()
  for (const [midi, low] of first) {
    // Milieu du palier : la plus grande tolérance possible autour de la hauteur visée.
    table.set(midi, (low + (last.get(midi) ?? low)) / 2)
  }
  return table
}

export interface ComposedBar {
  a: Vec2
  b: Vec2
  midi: number
}

export interface ComposedScene {
  readonly melody: Melody
  readonly tuningId: string
  readonly bars: readonly ComposedBar[]
  readonly drop: Vec2
  readonly velocity: Vec2
  /** intervalles réellement obtenus entre les notes, en secondes — utile pour juger et pour tester */
  readonly gaps: readonly number[]
}

interface BallState {
  pos: Vec2
  vel: Vec2
  time: number
}

function inside(p: Vec2, bounds: Bounds): boolean {
  return (
    p.x > MARGIN && p.x < bounds.w - MARGIN && p.y > MARGIN && p.y < bounds.h - MARGIN
  )
}

function ballistic(p: Vec2, v: Vec2, gravityY: number, dt: number): Vec2 {
  return { x: p.x + v.x * dt, y: p.y + v.y * dt + 0.5 * gravityY * dt * dt }
}

/**
 * Copie fidèle d'un monde. Continuer une simulation depuis une **copie exacte** est identique au bit près
 * à la simulation d'origine, alors que la reconstruire (`spawnBall` sur un monde neuf) ne l'est pas — id
 * de bille différent, âge remis à zéro, instants d'impact décalés. C'est cette nuance qui a coûté deux
 * sondes : 9 notes placées sur 11, 4 retrouvées au rejeu.
 */
function cloneWorld(world: World): World {
  return {
    balls: world.balls.map((ball) => ({ ...ball, pos: { ...ball.pos }, vel: { ...ball.vel }, origin: { ...ball.origin } })),
    bars: world.bars.map((bar) => ({ ...bar, a: { ...bar.a }, b: { ...bar.b } })),
    emitters: world.emitters.map((emitter) => ({ ...emitter, pos: { ...emitter.pos } })),
    gravity: { ...world.gravity },
    bounds: { ...world.bounds },
    time: world.time,
    bpm: world.bpm,
    respawns: world.respawns.map((respawn) => ({ ...respawn, vel: { ...respawn.vel } })),
    droppers: world.droppers.map((dropper) => ({ ...dropper, pos: { ...dropper.pos } })),
    nextBallId: world.nextBallId,
    nextDropperId: world.nextDropperId,
    nextBarId: world.nextBarId,
    nextEmitterId: world.nextEmitterId,
  }
}

/**
 * Rejoue la scène **depuis l'instant zéro** et renvoie les `wanted` premiers impacts, ou `null` dès que
 * l'ordre attendu est rompu. L'arrêt anticipé est ce qui rend la recherche assez rapide pour tenir dans
 * un clic de bouton : sans lui, chaque candidat simulait la durée entière.
 */
function replayPrefix(
  bars: readonly ComposedBar[],
  drop: Vec2,
  velocity: Vec2,
  bounds: Bounds,
  wanted: number,
  limitSeconds: number
): { at: number; after: BallState }[] | null {
  const world = createWorld(bounds)
  for (const bar of bars) addBar(world, bar.a, bar.b, bar.midi)
  const ball = spawnBall(world, drop, velocity)

  const out: { at: number; after: BallState }[] = []
  const steps = Math.round(limitSeconds / DT)
  for (let i = 0; i < steps; i += 1) {
    const impacts = stepWorld(world, DT)
    for (const impact of impacts) {
      // L'ordre attendu est celui de la pose : le n-ième impact doit être sur la n-ième barre.
      if (impact.barId !== out.length) return null
      out.push({
        at: impact.at,
        after: { pos: { ...ball.pos }, vel: { ...ball.vel }, time: world.time },
      })
      if (out.length === wanted) return out
    }
    if (!world.balls.includes(ball)) return null
  }
  return null
}

export interface ComposeOptions {
  bounds: Bounds
  seed: number
  /** nombre de tentatives ; 0 signifie « ne compose rien », ce qui exerce le repli */
  attempts?: number
  melodyId?: string
}

/*
 * Grille de candidats par note : angles × durées de vol. Mesuré à 14 × 12 = 168 candidats, la
 * composition atteignait 698 ms au pire ; à 11 × 9 = 99, elle tient dans le budget sans perdre de
 * convergence. Descendre plus bas la fait chuter — une sortie anticipée « dès qu'un candidat est
 * confortable » avait fait échouer la moitié des graines.
 */
const ANGLE_STEPS = 11
const FLIGHT_STEPS = 9

/**
 * Compose une scène qui joue l'incipit, ou rend `null` si la recherche n'aboutit pas dans son budget.
 * L'appelant doit alors se replier sur le générateur ordinaire : mieux vaut une scène sans air qu'un air
 * approximatif.
 */
export function composeMelody(options: ComposeOptions): ComposedScene | null {
  const attempts = options.attempts ?? 24
  const melodies = options.melodyId
    ? MELODIES.filter((candidate) => candidate.id === options.melodyId)
    : MELODIES
  if (melodies.length === 0 || attempts <= 0) return null

  const rng = createRng(options.seed)
  const { bounds } = options
  const gravityY = createWorld(bounds).gravity.y

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const melody = melodies[Math.floor(rng() * melodies.length)] ?? melodies[0]!
    const tuning = tuningForMelody(melody)
    if (!tuning) continue

    // La durée d'un temps varie d'une tentative à l'autre : c'est le levier le moins coûteux pour
    // débloquer une recherche qui butait, et il ne coûte rien à la reconnaissance de l'air.
    const secondsPerBeat = 0.3 + rng() * 0.26
    const drop: Vec2 = { x: MARGIN + 40 + rng() * (bounds.w * 0.3), y: MARGIN + 20 }
    const velocity: Vec2 = { x: 80 + rng() * 220, y: 0 }

    const lengths = buildLengthTable(tuning, bounds.w)
    const bars: ComposedBar[] = []
    const gaps: number[] = []
    let complete = true

    /*
     * Monde de référence, avancé jusqu'à l'impact déjà validé. On **continue** depuis une copie exacte
     * pour filtrer les candidats — c'est ~10× moins cher qu'un rejeu complet par candidat — puis on
     * valide le préfixe entier par un vrai rejeu depuis zéro, une seule fois, sur les meilleurs.
     *
     * Les deux étapes sont nécessaires : le filtrage ne voit pas qu'une barre posée plus tard peut
     * intercepter un vol antérieur, ce que seul le rejeu depuis zéro révèle.
     */
    let base: World = createWorld(bounds)
    spawnBall(base, drop, velocity)

    for (let k = 0; k < melody.degrees.length; k += 1) {
      const midi = tuning.rootMidi + 12 + (melody.degrees[k] ?? 0)
      const length = lengths.get(midi) ?? null
      if (length === null) {
        complete = false
        break
      }

      const ref = base.balls[0]
      if (!ref) {
        complete = false
        break
      }
      const from: BallState = { pos: { ...ref.pos }, vel: { ...ref.vel }, time: base.time }

      const intended = (melody.beats[k] ?? 1) * secondsPerBeat
      const floor = Math.max(MIN_NOTE_SECONDS, intended * 0.55)
      const ceiling = intended * 1.9
      const candidates: { bar: ComposedBar; gap: number; score: number; world: World }[] = []

      for (let ai = 0; ai < ANGLE_STEPS; ai += 1) {
        const angle = -Math.PI / 3 + (ai / (ANGLE_STEPS - 1)) * ((2 * Math.PI) / 3)
        const dir = { x: Math.cos(angle), y: Math.sin(angle) }
        for (let fi = 0; fi < FLIGHT_STEPS; fi += 1) {
          const flight = floor + ((ceiling - floor) * fi) / (FLIGHT_STEPS - 1)
          const centre = ballistic(from.pos, from.vel, gravityY, flight)
          if (!inside(centre, bounds)) continue

          const half = length / 2
          const candidate: ComposedBar = {
            a: { x: centre.x - dir.x * half, y: centre.y - dir.y * half },
            b: { x: centre.x + dir.x * half, y: centre.y + dir.y * half },
            midi,
          }
          if (!inside(candidate.a, bounds) || !inside(candidate.b, bounds)) continue

          const trial = cloneWorld(base)
          const placed = addBar(trial, candidate.a, candidate.b, candidate.midi)
          const ball = trial.balls[0]!
          let hit: { at: number } | null = null
          const steps = Math.round((ceiling + 0.5) / DT)
          for (let i = 0; i < steps && hit === null; i += 1) {
            for (const impact of stepWorld(trial, DT)) {
              if (impact.barId !== placed.id) {
                hit = null
                i = steps
                break
              }
              hit = { at: impact.at }
              break
            }
            if (!trial.balls.includes(ball)) break
          }
          if (!hit) continue
          const gap = hit.at - from.time
          if (gap < floor || gap > ceiling) continue

          const after = trial.balls[0]
          if (!after) continue
          const room =
            Math.min(after.pos.x - MARGIN, bounds.w - MARGIN - after.pos.x) +
            Math.min(after.pos.y - MARGIN, bounds.h - MARGIN - after.pos.y)
          candidates.push({
            bar: candidate,
            gap,
            score: room - Math.abs(gap - intended) * 300,
            world: trial,
          })
        }
      }

      candidates.sort((left, right) => right.score - left.score)
      let chosen: { bar: ComposedBar; gap: number; world: World } | null = null
      for (const candidate of candidates.slice(0, 5)) {
        const limit = candidate.gap + from.time + 0.6
        if (!replayPrefix([...bars, candidate.bar], drop, velocity, bounds, k + 1, limit)) continue
        chosen = candidate
        break
      }

      if (!chosen) {
        complete = false
        break
      }
      bars.push(chosen.bar)
      gaps.push(chosen.gap)
      base = chosen.world
    }

    if (complete && bars.length === melody.degrees.length) {
      return { melody, tuningId: tuning.id, bars, drop, velocity, gaps }
    }
  }

  return null
}

/**
 * Suite de hauteurs réellement jouée par une scène composée. C'est le contrat vérifiable de ce module :
 * « cette scène, simulée depuis zéro, joue cet air ».
 */
export function playedMidis(scene: ComposedScene, bounds: Bounds, limitSeconds = 12): number[] {
  const world = createWorld(bounds)
  for (const bar of scene.bars) addBar(world, bar.a, bar.b, bar.midi)
  const ball = spawnBall(world, scene.drop, scene.velocity)
  const played: number[] = []
  const steps = Math.round(limitSeconds / DT)
  for (let i = 0; i < steps; i += 1) {
    for (const impact of stepWorld(world, DT)) {
      const bar = world.bars.find((candidate) => candidate.id === impact.barId)
      if (bar) played.push(bar.midi)
    }
    if (!world.balls.includes(ball)) break
  }
  return played
}
