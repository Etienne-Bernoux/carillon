import type { SharedBar, SharedEmitter } from './share'
import type { Vec2 } from './types'

/**
 * Géométrie du partage : pixels ↔ fractions. Pur, sans DOM, donc testable — c'est tout l'objet de
 * l'extraction. Cette conversion vivait dans `src/main.ts`, où elle n'avait aucune couverture : sa
 * seule preuve était un scénario navigateur à **un** couple de viewports et **une** graine, et c'est
 * exactement là que s'était logé un défaut (une barre courte étirée après recadrage repassait sous
 * le HUD).
 */

/** Rectangle jouable. Structurellement compatible avec la `SceneArea` de l'UI. */
export interface LayoutArea {
  left: number
  top: number
  right: number
  bottom: number
}

function areaHeight(area: LayoutArea): number {
  return Math.max(1, area.bottom - area.top)
}

/**
 * Abscisses rapportées à la **largeur du viewport**, ordonnées à la **hauteur de la zone**.
 *
 * L'asymétrie est le cœur du format : la longueur d'une barre est une fraction de la largeur, donc la
 * note se conserve d'un écran à l'autre ; l'ordonnée du milieu suit la hauteur disponible, donc la
 * scène remplit l'écran du destinataire au lieu de s'écraser en bandeau.
 */
export function toSharedBar(a: Vec2, b: Vec2, area: LayoutArea, width: number): SharedBar {
  return {
    mx: (a.x + b.x) / 2 / width,
    my: ((a.y + b.y) / 2 - area.top) / areaHeight(area),
    len: Math.hypot(b.x - a.x, b.y - a.y) / width,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

export function toSharedPoint(point: Vec2, area: LayoutArea, width: number): { x: number; y: number } {
  return { x: point.x / width, y: (point.y - area.top) / areaHeight(area) }
}

export function placeSharedPoint(x: number, y: number, area: LayoutArea, width: number): Vec2 {
  return {
    x: Math.max(area.left, Math.min(area.right, x * width)),
    y: Math.max(area.top, Math.min(area.bottom, area.top + y * areaHeight(area))),
  }
}

/** Étire un segment autour de son milieu jusqu'à `minLength`, s'il est plus court. */
function stretchToMin(a: Vec2, b: Vec2, minLength: number): [Vec2, Vec2] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length >= minLength) return [a, b]

  const midX = (a.x + b.x) / 2
  const midY = (a.y + b.y) / 2
  const half = minLength / 2
  const ux = length < 1e-9 ? 1 : dx / length
  const uy = length < 1e-9 ? 0 : dy / length
  return [
    { x: midX - ux * half, y: midY - uy * half },
    { x: midX + ux * half, y: midY + uy * half },
  ]
}

/**
 * Fait rentrer un segment dans la zone en le **translatant**, jamais en le raccourcissant :
 * raccourcir changerait sa note. On ne borne un axe que si la barre y est plus grande que la zone,
 * cas où aucune position ne satisfait la contrainte.
 */
function translateInside(a: Vec2, b: Vec2, area: LayoutArea): [Vec2, Vec2] {
  const shift = (min: number, max: number, low: number, high: number): number => {
    if (max - min > high - low) return 0
    return Math.max(low - min, Math.min(high - max, 0))
  }
  const dx = shift(Math.min(a.x, b.x), Math.max(a.x, b.x), area.left, area.right)
  const dy = shift(Math.min(a.y, b.y), Math.max(a.y, b.y), area.top, area.bottom)
  return [
    { x: a.x + dx, y: a.y + dy },
    { x: b.x + dx, y: b.y + dy },
  ]
}

/**
 * Reconstruit une barre partagée en pixels.
 *
 * L'ordre des deux dernières étapes n'est pas indifférent : **étirer d'abord, recadrer ensuite**.
 * L'inverse laissait une barre courte, recadrée à fleur du bord haut, ressortir sous le HUD en
 * s'étirant — un défaut invisible aux assertions parce que la graine de la scène d'accueil ne place
 * aucune barre courte tout en haut.
 */
export function placeSharedBar(
  bar: SharedBar,
  area: LayoutArea,
  width: number,
  minLength: number,
): [Vec2, Vec2] {
  const mid = placeSharedPoint(bar.mx, bar.my, area, width)
  const half = (bar.len * width) / 2
  const dx = Math.cos(bar.angle) * half
  const dy = Math.sin(bar.angle) * half
  const [stretchedA, stretchedB] = stretchToMin(
    { x: mid.x - dx, y: mid.y - dy },
    { x: mid.x + dx, y: mid.y + dy },
    minLength,
  )
  return translateInside(stretchedA, stretchedB, area)
}

export function placeSharedEmitter(emitter: SharedEmitter, area: LayoutArea, width: number): Vec2 {
  return placeSharedPoint(emitter.x, emitter.y, area, width)
}
