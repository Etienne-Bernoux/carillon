/**
 * Géométrie → musique. Pur, zéro DOM, déterministe : testable en Vitest.
 */

import type { Bar } from './types'

export interface Tuning {
  readonly id: string
  readonly label: string
  /**
   * Nom compact, pour le mode icône des petits écrans. Le bouton de gamme est le seul dont le texte
   * **porte l'état** : le réduire à un pictogramme ferait perdre l'information « quelle gamme joue ».
   */
  readonly short: string
  readonly scale: readonly number[]
  readonly rootMidi: number
}

/** Nommée à part pour que `DEFAULT_TUNING` n'ait pas à indexer un tableau (donc pas de `!`). */
const PENTATONIC_MINOR: Tuning = {
  id: 'pentatonic-minor',
  label: 'Pentatonique mineure',
  short: 'Pent. min.',
  scale: [0, 3, 5, 7, 10],
  rootMidi: 57, // A3
}

/**
 * **L'ordre de ce tableau est figé** : son index voyage dans les liens partagés (cf. `share.ts`).
 * Réordonner ou insérer en tête casserait tous les liens déjà émis. On ajoute donc **à la fin**, et le
 * catalogue ne peut pas dépasser 64 entrées — l'index est encodé sur 6 bits. Un test l'épingle.
 */
export const TUNINGS: readonly Tuning[] = [
  PENTATONIC_MINOR,
  {
    id: 'pentatonic-major',
    label: 'Pentatonique majeure',
    short: 'Pent. maj.',
    scale: [0, 2, 4, 7, 9],
    rootMidi: 57,
  },
  {
    id: 'dorian',
    label: 'Dorien',
    short: 'Dorien',
    scale: [0, 2, 3, 5, 7, 9, 10],
    rootMidi: 57,
  },
  {
    id: 'hirajoshi',
    label: 'Hirajoshi (japonaise)',
    short: 'Hirajoshi',
    scale: [0, 2, 3, 7, 8],
    rootMidi: 57,
  },
  {
    id: 'lydian',
    label: 'Lydien',
    short: 'Lydien',
    scale: [0, 2, 4, 6, 7, 9, 11],
    rootMidi: 57,
  },
  {
    // Ajoutée **en fin** de catalogue (l'ordre est figé) pour les airs connus : aucune des cinq gammes
    // précédentes ne contient à la fois la tierce majeure et la quarte, que la plupart exigent.
    id: 'major',
    label: 'Majeure',
    short: 'Majeure',
    scale: [0, 2, 4, 5, 7, 9, 11],
    rootMidi: 57,
  },
] as const

export const DEFAULT_TUNING: Tuning = PENTATONIC_MINOR

export function tuningById(id: string): Tuning {
  return TUNINGS.find((tuning) => tuning.id === id) ?? DEFAULT_TUNING
}

/** en dessous de ce seuil (px/s), l'impact est trop faible pour déclencher une note */
export const MIN_IMPACT_SPEED = 40

/**
 * Bornes de longueur exprimées en **fraction de la largeur de la scène**, et non en pixels.
 *
 * En pixels absolus (40 → 700 px), un téléphone ne jouait que deux hauteurs : ses barres tiennent
 * toutes dans le bas de la plage. À 1280 px ces ratios valent 38 → 704 px, donc le comportement
 * desktop d'avant est préservé ; à 375 px ils valent 11 → 206 px, ce qui rend enfin toute
 * l'étendue atteignable au doigt.
 */
export const MIN_LENGTH_RATIO = 0.03
export const MAX_LENGTH_RATIO = 0.55

/**
 * Plage de longueurs qui couvre toute l'étendue de l'instrument à cette largeur. Exportée pour que
 * le générateur de scène échantillonne **l'étendue musicale** et non celle de sa mise en page :
 * calibrer les longueurs sur le pas d'une rangée faisait saturer un tiers d'entre elles sur la note
 * la plus grave dès que la scène ne tenait que deux colonnes.
 */
export function lengthRangeForWidth(sceneWidth: number): { min: number; max: number } {
  const width = sceneWidth > 0 ? sceneWidth : 1
  return { min: width * MIN_LENGTH_RATIO, max: width * MAX_LENGTH_RATIO }
}

/** nombre de degrés de gamme couverts sur la plage utile, avant repli en octaves (~3 octaves) */
const SPAN_OCTAVES = 3

/**
 * Barre courte → aigu, barre longue → grave (métaphore du carillon). On construit la liste des
 * degrés MIDI disponibles sur ~3 octaves, triée du plus aigu au plus grave, puis on choisit
 * l'index par interpolation linéaire de la longueur bornée — ce qui garantit monotonie
 * (décroissante) et couverture de tous les degrés sans en sauter.
 *
 * `sceneWidth` rend le résultat **invariant d'échelle** : une barre qui occupe le tiers de l'écran
 * sonne la même note sur un téléphone et sur un grand écran.
 */
export function midiForLength(lengthPx: number, tuning: Tuning, sceneWidth: number): number {
  const { min, max } = lengthRangeForWidth(sceneWidth)
  const degrees = descendingDegrees(tuning)
  const clamped = Math.min(Math.max(lengthPx, min), max)
  const t = (clamped - min) / (max - min)
  const lastIndex = degrees.length - 1
  const index = Math.min(Math.max(Math.round(t * lastIndex), 0), lastIndex)
  return degrees[index] ?? tuning.rootMidi
}

/**
 * Reconstruite à chaque appel, volontairement. Un cache avait été ajouté, clé sur `tuning.id`, alors
 * que le résultat dépend aussi de `rootMidi` : le jour où l'on change de tonique en gardant l'`id`,
 * il aurait renvoyé des hauteurs périmées **en silence**. Mesuré : 0,34 µs par appel, soit 20 µs par
 * seconde au pire (un appel par `pointermove`). Le cache achetait donc un risque de correction contre
 * rien du tout.
 */
function descendingDegrees(tuning: Tuning): readonly number[] {
  const perOctave = tuning.scale.length
  const notes: number[] = []
  for (let i = 0; i < perOctave * SPAN_OCTAVES; i += 1) {
    const octave = Math.floor(i / perOctave)
    const degree = tuning.scale[i % perOctave] ?? 0
    notes.push(tuning.rootMidi + degree + octave * 12)
  }
  // aigu en premier : la note la plus haute correspond à la barre la plus courte
  notes.sort((a, b) => b - a)
  return notes
}

function barLength(bar: Bar): number {
  return Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y)
}

/**
 * Réaccorde l'instrument : chaque barre recalcule sa hauteur depuis sa **géométrie**, seule source
 * de vérité — jamais depuis sa hauteur précédente, qui aurait dérivé à chaque changement de gamme.
 * Aucune barre n'est déplacée.
 */
export function retuneBars(bars: readonly Bar[], tuning: Tuning, sceneWidth: number): void {
  for (const bar of bars) {
    bar.midi = midiForLength(barLength(bar), tuning, sceneWidth)
  }
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
