/**
 * Natures de barres. Pur, sans DOM : ce fichier ne décrit **que des nombres et des règles**, et la
 * physique les applique.
 *
 * Une barre n'est plus interchangeable avec une autre. Trois natures, pas plus — chacune ajoutée est un
 * rendu supplémentaire à distinguer d'un coup d'œil sur une scène de quinze barres, en plus des
 * poignées et des sources.
 */

import { divisionAt, gridTimeAfter } from './clock'
import { gainForImpact } from './music'
import type { Bar } from './types'

export type BarNature = 'wall' | 'trampoline' | 'ephemeral'

/**
 * **L'ordre est figé** : l'index voyage dans les liens de partage, comme celui des gammes et des
 * instruments. On ajoute à la fin, jamais en tête. Le mur est en tête parce qu'il est le défaut et le
 * comportement historique — un lien émis avant ce travail se relit avec des murs.
 */
export const NATURES: readonly BarNature[] = ['wall', 'trampoline', 'ephemeral']

export const DEFAULT_NATURE: BarNature = 'wall'

/** Restitution d'un trampoline : au-dessus de 1, donc la bille repart avec plus d'énergie. */
export const TRAMPOLINE_RESTITUTION = 1.35

/** Impacts audibles qu'une barre éphémère encaisse avant de s'effacer. */
export const EPHEMERAL_HITS = 3

/**
 * Division sur laquelle une barre éphémère revient : la mesure. Revenir à la croche la rendrait
 * clignotante plutôt qu'évolutive — ce qu'on cherche est une phrase qui dérive, pas un scintillement.
 */
const EPHEMERAL_DIVISION_INDEX = 0

/** marge sous le bord haut : une bille qui frôle le bord se lit déjà comme sortie */
const TOP_MARGIN = 12

/**
 * Vitesse de rebond maximale, **dérivée de la hauteur disponible au-dessus de l'impact**.
 *
 * Un trampoline qui rend plus d'énergie qu'il n'en reçoit fait croître la vitesse à chaque rebond. Sans
 * plafond, la bille finit par traverser l'écran par le haut — elle ne meurt pas (seul le bas et les
 * côtés tuent une bille) mais elle disparaît du champ, ce qui se vit comme un bug.
 *
 * La borne est `v = sqrt(2·g·d)` où `d` est la distance entre le point d'impact et le bord haut : c'est
 * exactement la vitesse dont l'apogée touche ce bord.
 *
 * Première version, fausse : `d` valait 90 % de la **hauteur de scène**, comme si tout impact avait lieu
 * au ras du bas. Mesuré sur une barre à mi-hauteur, la bille culminait à y = −236 — hors champ. La
 * hauteur qui compte est celle qui reste **au-dessus du point d'impact**, pas celle de la scène.
 */
export function maxBounceSpeed(gravityY: number, riseAvailable: number): number {
  const g = Math.abs(gravityY)
  if (g <= 0) return Number.POSITIVE_INFINITY
  return Math.sqrt(2 * g * Math.max(riseAvailable - TOP_MARGIN, 0))
}

export function restitutionFor(nature: BarNature, base: number): number {
  return nature === 'trampoline' ? TRAMPOLINE_RESTITUTION : base
}

/**
 * Une barre absente laisse passer les billes, sans note. `absentUntil` est un instant de simulation
 * absolu, comme l'échéance d'une source — jamais un compte à rebours, qui devrait être resynchronisé.
 */
export function isPresent(bar: Bar, time: number): boolean {
  return bar.nature !== 'ephemeral' || bar.absentUntil <= time
}

/**
 * Enregistre un impact sur une barre. Renvoie `true` si la barre vient de s'effacer.
 *
 * Le seuil est **exactement celui du son** (`gainForImpact`), pas un seuil parallèle : un frôlement
 * inaudible ne doit pas consommer une vie, sinon l'œil verrait une barre s'user sans rien entendre.
 * C'est la même règle que pour les étincelles de l'US6.
 */
export function registerHit(bar: Bar, speed: number, time: number, bpm: number): boolean {
  if (bar.nature !== 'ephemeral') return false
  if (gainForImpact(speed) <= 0) return false

  bar.hitsLeft -= 1
  if (bar.hitsLeft > 0) return false

  bar.hitsLeft = EPHEMERAL_HITS
  bar.absentUntil = gridTimeAfter(time, divisionAt(EPHEMERAL_DIVISION_INDEX), bpm)
  return true
}

/** Remet une barre à neuf : pleine vie, présente. Appelé quand sa nature change ou qu'on la restaure. */
export function rearm(bar: Bar): void {
  bar.hitsLeft = EPHEMERAL_HITS
  bar.absentUntil = -1
}

/**
 * Nature suivante, en cycle. Ré-arme au passage : une barre qui devient éphémère part avec sa vie
 * pleine, et une barre qui cesse de l'être ne doit pas rester absente pour toujours.
 */
export function cycleNature(bar: Bar): BarNature {
  const index = NATURES.indexOf(bar.nature)
  const next = NATURES[(index + 1) % NATURES.length] ?? DEFAULT_NATURE
  bar.nature = next
  rearm(bar)
  return next
}

/** Nom lisible, pour l'annonce accessible. */
export function natureLabel(nature: BarNature): string {
  if (nature === 'trampoline') return 'trampoline'
  if (nature === 'ephemeral') return 'éphémère'
  return 'mur'
}
