/**
 * Géométrie → musique. Pur, zéro DOM, déterministe : testable en Vitest.
 */

export interface Tuning {
  readonly id: string
  readonly label: string
  readonly scale: readonly number[]
  readonly rootMidi: number
}

export const TUNINGS: readonly Tuning[] = [
  {
    id: 'pentatonic-minor',
    label: 'Pentatonique mineure',
    scale: [0, 3, 5, 7, 10],
    rootMidi: 57, // A3
  },
  {
    id: 'pentatonic-major',
    label: 'Pentatonique majeure',
    scale: [0, 2, 4, 7, 9],
    rootMidi: 57,
  },
  {
    id: 'dorian',
    label: 'Dorien',
    scale: [0, 2, 3, 5, 7, 9, 10],
    rootMidi: 57,
  },
  {
    id: 'hirajoshi',
    label: 'Hirajoshi (japonaise)',
    scale: [0, 2, 3, 7, 8],
    rootMidi: 57,
  },
  {
    id: 'lydian',
    label: 'Lydien',
    scale: [0, 2, 4, 6, 7, 9, 11],
    rootMidi: 57,
  },
] as const

export const DEFAULT_TUNING: Tuning = TUNINGS[0]!

/** en dessous de ce seuil (px/s), l'impact est trop faible pour déclencher une note */
export const MIN_IMPACT_SPEED = 40

/** longueur (px) plafonnée à l'aigu : toute barre plus courte sonne comme celle-ci */
const MIN_LENGTH_PX = 40
/** longueur (px) plafonnée au grave : toute barre plus longue sonne comme celle-ci */
const MAX_LENGTH_PX = 700

/** nombre de degrés de gamme couverts sur la plage utile, avant repli en octaves (~3 octaves) */
const SPAN_OCTAVES = 3

/**
 * Barre courte → aigu, barre longue → grave (métaphore du carillon). On construit la liste des
 * degrés MIDI disponibles sur ~3 octaves, triée du plus aigu au plus grave, puis on choisit
 * l'index par interpolation linéaire de la longueur bornée — ce qui garantit monotonie stricte
 * et couverture de tous les degrés sans en sauter.
 */
export function midiForLength(lengthPx: number, tuning: Tuning): number {
  const degrees = buildDescendingDegrees(tuning)
  const clamped = Math.min(Math.max(lengthPx, MIN_LENGTH_PX), MAX_LENGTH_PX)
  const t = (clamped - MIN_LENGTH_PX) / (MAX_LENGTH_PX - MIN_LENGTH_PX)
  const lastIndex = degrees.length - 1
  const index = Math.round(t * lastIndex)
  const clampedIndex = Math.min(Math.max(index, 0), lastIndex)
  return degrees[clampedIndex]!
}

function buildDescendingDegrees(tuning: Tuning): number[] {
  const perOctave = tuning.scale.length
  const totalSteps = perOctave * SPAN_OCTAVES
  const notes: number[] = []
  for (let i = 0; i < totalSteps; i += 1) {
    const octave = Math.floor(i / perOctave)
    const degree = tuning.scale[i % perOctave]!
    notes.push(tuning.rootMidi + degree + octave * 12)
  }
  // aigu en premier : la note la plus haute correspond à la barre la plus courte
  notes.sort((a, b) => b - a)
  return notes
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

const GAIN_MAX_SPEED = 2500

/**
 * Courbe concave (racine carrée) : les impacts doux restent audibles, les violents ne saturent
 * pas la sortie. 0 sous MIN_IMPACT_SPEED, 1 atteint vers GAIN_MAX_SPEED.
 */
export function gainForImpact(speed: number): number {
  if (speed < MIN_IMPACT_SPEED) return 0
  const t = Math.min((speed - MIN_IMPACT_SPEED) / (GAIN_MAX_SPEED - MIN_IMPACT_SPEED), 1)
  return Math.sqrt(t)
}

export function panForX(x: number, width: number): number {
  if (width <= 0) return 0
  const normalized = (x / width) * 2 - 1 // -1..1
  const clamped = Math.min(Math.max(normalized, -1), 1)
  return clamped * 0.8
}
