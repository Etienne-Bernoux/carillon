/**
 * Horloge musicale. Pure, sans état : une **fonction** de la grille, pas un compteur qui tourne.
 *
 * C'est la leçon de l'US4 : `nextAt`, une échéance stockée, avait provoqué une rafale de billes à
 * l'annulation parce qu'un compteur d'échéance est un état transitoire déguisé en donnée. Ici, rien à
 * resynchroniser après un `undo`, un changement de tempo ou un chargement depuis un lien — l'instant
 * suivant se **recalcule** toujours depuis le temps de simulation.
 */

export const DEFAULT_BPM = 96
export const MIN_BPM = 60
export const MAX_BPM = 168
export const BEATS_PER_BAR = 4

/**
 * Divisions de mesure offertes à une source. **L'ordre est figé** : l'index voyagera dans les liens de
 * partage, comme celui des gammes. On ajoute donc à la fin, jamais en tête.
 *
 * Le tiers est là exprès : c'est lui qui donne le ternaire, et il cohabite avec les binaires sur la même
 * mesure — c'est ce qui permet un motif à trois contre quatre sans polyrythmie involontaire, puisque la
 * mesure reste la période commune.
 *
 * La croche (1/8) ferme la liste parce qu'il faut une division **rapide** : la plus fine valait sinon
 * 1/4 de mesure, soit 0,625 s à 96 BPM, quatre fois plus lent que la période minimale d'avant l'US7.
 * Une scène a besoin d'au moins une source qui pulse vite pour avoir un socle.
 */
export const DIVISIONS: readonly number[] = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 8]

export const DEFAULT_DIVISION_INDEX = 1

/**
 * Tolérance de comparaison sur la grille. Sans elle, un temps de simulation qui vaut « exactement »
 * 3 pas mais s'écrit 2,9999999999999996 renverrait le pas 3 comme instant *suivant* — donc un instant
 * non strictement postérieur, et une boucle d'émission qui ne progresse jamais. C'est le même défaut
 * de flottant que le décompte d'émissions de l'US4 (29,999999999999996 émissions attendues).
 */
const EPSILON = 1e-9

export function barSeconds(bpm: number): number {
  return (60 / clampBpm(bpm)) * BEATS_PER_BAR
}

export function divisionSeconds(division: number, bpm: number): number {
  return barSeconds(bpm) * division
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM
  return Math.min(Math.max(bpm, MIN_BPM), MAX_BPM)
}

export function divisionAt(index: number): number {
  return DIVISIONS[index] ?? DIVISIONS[DEFAULT_DIVISION_INDEX] ?? 1
}

/**
 * Prochain instant de grille **strictement** postérieur à `time`, pour cette division et ce tempo.
 *
 * Deux sources de même division reçoivent le même instant quel que soit leur passé : c'est ce qui les
 * met en phase et les y maintient indéfiniment, là où deux échéances cumulées (`nextAt += period`)
 * dérivent par accumulation de flottants.
 */
export function gridTimeAfter(time: number, division: number, bpm: number): number {
  const step = divisionSeconds(division, bpm)
  const steps = Math.floor((time + EPSILON) / step) + 1
  return steps * step
}

/**
 * Index de la mesure en cours et position dans la mesure (0..1). Sert à comparer deux mesures entre
 * elles — la périodicité du motif se vérifie comme ça, pas à l'oreille.
 */
export function barPosition(time: number, bpm: number): { bar: number; phase: number } {
  const length = barSeconds(bpm)
  const bar = Math.floor((time + EPSILON) / length)
  const phase = (time - bar * length) / length
  return { bar, phase: Math.min(Math.max(phase, 0), 1) }
}

/**
 * Division la plus proche d'une période exprimée en secondes. Sert à relire les liens de partage
 * **déjà émis**, qui encodent une période libre : on ne casse pas un lien, on le rapproche de la
 * grille musicale la plus voisine.
 */
export function nearestDivisionIndex(periodSeconds: number, bpm: number): number {
  let best = DEFAULT_DIVISION_INDEX
  let bestGap = Number.POSITIVE_INFINITY
  for (let i = 0; i < DIVISIONS.length; i += 1) {
    const gap = Math.abs(divisionSeconds(divisionAt(i), bpm) - periodSeconds)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  }
  return best
}

/**
 * Nom lisible d'une division, pour l'annonce accessible. Dans le vocabulaire de la mesure et non en
 * secondes : « une bille par mesure » se comprend, « toutes les 2,5 s » demande un calcul.
 */
export function divisionLabel(index: number): string {
  const labels = ['une par mesure', 'une par demi-mesure', 'trois par mesure', 'une par temps', 'deux par temps']
  return labels[index] ?? labels[DEFAULT_DIVISION_INDEX] ?? 'une par mesure'
}
