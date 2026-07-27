import type { Bounds, Vec2 } from '../core/types'
import { sceneArea } from './scene'
import type { SceneArea } from './scene'

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Intersection segment / rectangle exacte (découpage de Liang-Barsky).
 *
 * Une comparaison de boîtes englobantes serait plus courte mais sur-détecterait : une barre inclinée
 * dont la boîte croise la barre d'outils sans la toucher rendrait le harnais rouge pour rien. Un
 * garde qui crie à tort finit désactivé, donc il doit être exact.
 */
export function segmentIntersectsRect(a: Vec2, b: Vec2, rect: Rect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y

  for (const [p, q] of [
    [-dx, a.x - rect.left],
    [dx, rect.right - a.x],
    [-dy, a.y - rect.top],
    [dy, rect.bottom - a.y],
  ] as const) {
    if (p === 0) {
      // Segment parallèle à ce bord : hors du rectangle de ce côté, il ne peut plus y entrer.
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }

  return t0 <= t1
}

/** Respiration entre le HUD et la première barre, en px. */
const GAP = 14
/** En dessous, la scène n'a plus assez de hauteur pour une cascade : on rogne les respirations. */
const MIN_HEIGHT = 130

/**
 * Mesure la zone libre **réellement** disponible, depuis le DOM.
 *
 * Les marges en dur ne peuvent pas marcher : elles supposent une mise en page, or la barre d'outils
 * passe en bas sous 640 px de large et reste en haut au-delà. Pire, une marge exprimée en fraction de
 * la hauteur *rétrécit* quand l'écran est bas — exactement l'inverse du besoin, puisque le HUD garde
 * sa taille. Défaut constaté sur un téléphone en paysage (844 × 390) : la rangée haute de barres
 * passait derrière le titre et les boutons.
 *
 * On demande donc au navigateur où sont vraiment les éléments de HUD (`[data-hud]`), et on en déduit
 * le rectangle jouable. Repli sur l'heuristique `sceneArea(bounds)` si rien n'est mesurable — cas des
 * tests unitaires, qui n'ont pas de DOM.
 */
export function measureSceneArea(bounds: Bounds, root: ParentNode = document): SceneArea {
  const fallback = sceneArea(bounds)
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-hud]'))
  if (elements.length === 0) return fallback

  const middle = bounds.h / 2
  let topBlocked = 0
  let bottomBlocked = bounds.h

  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    // Un élément est classé haut ou bas selon son centre : c'est ce qui permet à la même mesure de
    // marcher que la barre d'outils soit en haut (desktop) ou en bas (mobile).
    if ((rect.top + rect.bottom) / 2 < middle) topBlocked = Math.max(topBlocked, rect.bottom)
    else bottomBlocked = Math.min(bottomBlocked, rect.top)
  }

  let top = topBlocked + GAP
  let bottom = bottomBlocked - GAP

  // Écran très bas : plutôt que de rendre la scène injouable, on récupère les respirations, puis on
  // accepte de frôler le HUD. Mieux vaut une cascade serrée qu'une cascade de trois pixels.
  if (bottom - top < MIN_HEIGHT) {
    top = topBlocked
    bottom = bottomBlocked
  }
  if (bottom - top < MIN_HEIGHT) {
    const center = (top + bottom) / 2
    top = Math.max(0, center - MIN_HEIGHT / 2)
    bottom = Math.min(bounds.h, center + MIN_HEIGHT / 2)
  }

  return { left: fallback.left, right: fallback.right, top, bottom }
}
