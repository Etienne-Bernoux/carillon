/**
 * Roue de sélection radiale. Pur, sans DOM : ce fichier ne connaît **ni barres, ni timbres, ni
 * canvas** — un centre, un anneau, N secteurs, et la question « quel secteur sous ce point ».
 *
 * C'est ce qui remplace le cyclage. Un cycle cache l'ensemble des options : revenir d'un cran sur cinq
 * timbres coûte quatre clics, et rien n'annonce combien il en existe. Une roue les montre.
 *
 * La géométrie vit ici plutôt que dans le rendu parce que c'est elle qui décide ce qui est
 * **atteignable** : un secteur hors écran est une option qu'on ne peut pas choisir, et ça ne se
 * démontre pas depuis un canvas.
 */

import type { Vec2 } from './types'

/** Zone morte centrale. Relâcher dedans **épingle** la roue au lieu de choisir — cf. `sectorAt`. */
export const INNER_RADIUS = 26

/** Rayon extérieur de l'anneau. Au-delà, le geste est une annulation. */
export const OUTER_RADIUS = 104

/**
 * Un secteur est décrit par ce qu'il faut pour le dessiner et le nommer. La valeur est opaque : la roue
 * ne sait pas ce qu'elle sélectionne, et c'est exactement ce qui lui permet de servir deux réglages.
 */
export interface WheelOption<T extends string> {
  value: T
  label: string
}

export interface Wheel<T extends string> {
  center: Vec2
  options: readonly WheelOption<T>[]
  /** valeur en place à l'ouverture — dessinée marquée, pour qu'on sache d'où on part */
  current: T
}

/**
 * Résultat de la lecture d'un point.
 *
 * `pin` mérite son existence : le geste le plus probable la première fois est « j'appuie long, je
 * relâche sans avoir bougé ». Traité comme une annulation, il ne ferait **rien** — la roue serait aussi
 * invisible que le cycle qu'elle remplace. Épinglée, elle laisse le temps de lire.
 */
export type WheelAim =
  | { kind: 'sector'; index: number }
  | { kind: 'pin' }
  | { kind: 'cancel' }

/**
 * Angle du **début** du secteur `index`, en radians, dans le repère du canvas (y vers le bas, donc les
 * angles croissants tournent dans le sens horaire à l'écran).
 *
 * Le premier secteur est centré sur le **haut** : c'est la direction qu'on vise sans réfléchir, et elle
 * doit désigner la même option quel que soit le nombre d'options.
 */
export function sectorStartAngle(count: number, index: number): number {
  const step = (Math.PI * 2) / count
  return -Math.PI / 2 - step / 2 + index * step
}

/** Angle médian d'un secteur : là où se pose son libellé, et là où on vise pour le choisir. */
export function sectorMidAngle(count: number, index: number): number {
  return sectorStartAngle(count, index) + Math.PI / count
}

/** Point d'ancrage d'un libellé, au milieu de l'épaisseur de l'anneau. */
export function labelAnchor<T extends string>(wheel: Wheel<T>, index: number): Vec2 {
  const angle = sectorMidAngle(wheel.options.length, index)
  const radius = (INNER_RADIUS + OUTER_RADIUS) / 2
  return {
    x: wheel.center.x + Math.cos(angle) * radius,
    y: wheel.center.y + Math.sin(angle) * radius,
  }
}

/**
 * Ce que désigne un point. La partition est **complète et sans recouvrement** : tout point de l'anneau
 * appartient à exactement un secteur, sinon il existerait des directions qui ne choisissent rien.
 */
export function sectorAt<T extends string>(wheel: Wheel<T>, point: Vec2): WheelAim {
  const dx = point.x - wheel.center.x
  const dy = point.y - wheel.center.y
  const distance = Math.hypot(dx, dy)

  if (distance < INNER_RADIUS) return { kind: 'pin' }
  if (distance > OUTER_RADIUS) return { kind: 'cancel' }

  const count = wheel.options.length
  const step = (Math.PI * 2) / count
  /*
   * Ramené dans [0, 2π) **relativement au début du premier secteur**, puis divisé. Passer par un
   * `atan2` brut et une cascade de comparaisons redonnerait le trou que cette normalisation évite : le
   * secteur qui chevauche -π/π serait coupé en deux, et une direction ne choisirait rien.
   */
  const raw = Math.atan2(dy, dx) - sectorStartAngle(count, 0)
  const turns = raw / (Math.PI * 2)
  const normalized = (turns - Math.floor(turns)) * (Math.PI * 2)
  const index = Math.min(count - 1, Math.floor(normalized / step))
  return { kind: 'sector', index }
}

/**
 * Ce que le rendu doit montrer d'une roue ouverte. `aimed` est le secteur sous le pointeur — `null`
 * quand il est dans la zone morte ou hors de l'anneau, deux états qui ne choisissent rien et ne doivent
 * donc pas s'afficher comme un choix imminent.
 */
export interface WheelView {
  wheel: Wheel<string>
  aimed: number | null
}

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Recadre le centre pour que le **disque entier** tienne dans la zone. Une roue ouverte près d'un bord
 * a sinon des secteurs hors écran : des options qu'on ne peut pas choisir, et qu'aucun test posé au
 * centre de la scène ne verrait.
 *
 * Si la zone est plus petite que le diamètre, on centre : mieux vaut une roue symétriquement rognée
 * qu'une roue collée à un bord, où le rognage porte entièrement sur les mêmes options.
 */
export function fitWheel(wanted: Vec2, area: Rect): Vec2 {
  return {
    x: fitAxis(wanted.x, area.left, area.right),
    y: fitAxis(wanted.y, area.top, area.bottom),
  }
}

function fitAxis(value: number, min: number, max: number): number {
  const low = min + OUTER_RADIUS
  const high = max - OUTER_RADIUS
  if (low > high) return (min + max) / 2
  return Math.max(low, Math.min(high, value))
}
