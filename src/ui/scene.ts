import { createRng } from '../core/rng'
import type { Bounds, Vec2 } from '../core/types'

export type PlaceBar = (a: Vec2, b: Vec2) => void

/** Zone occupée par le titre en haut, à laisser libre pour ne pas dessiner sous le HUD. */
export const TOP_INSET = 130
/** Zone occupée par la barre d'outils et l'indice en bas (cf. style.css, disposition mobile). */
export const BOTTOM_INSET = 170
export const ROWS = 6
/** En dessous, la barre est trop courte pour être jouable : on préfère ne pas la poser. */
const MIN_HALF = 22

export interface SceneArea {
  left: number
  right: number
  top: number
  bottom: number
}

/** Zone de jeu réellement utilisable, hors HUD. Exportée pour être vérifiable en test. */
export function sceneArea(bounds: Bounds): SceneArea {
  const sideMargin = Math.min(48, bounds.w * 0.06)
  const top = Math.min(TOP_INSET, bounds.h * 0.18)
  return {
    left: sideMargin,
    right: bounds.w - sideMargin,
    top,
    bottom: Math.max(top + 120, bounds.h - BOTTOM_INSET),
  }
}

/**
 * Cascade en quinconce. Quatre propriétés sont voulues, et chacune a coûté une capture d'écran :
 *
 * 1. Les rangées sont **décalées d'un demi-pas** l'une par rapport à l'autre : sans ça, les trous
 *    s'alignent verticalement et une bille peut tomber de haut en bas sans rien toucher.
 * 2. La longueur est une **fraction du pas**, jamais une valeur absolue plafonnée : sur un écran
 *    étroit, plafonner donnait des barres toutes identiques — donc une seule note pour tout l'écran.
 * 3. Chaque barre est **bornée par ses extrémités**, pas par son centre. Le garde précédent testait
 *    le centre et laissait jusqu'à 133 px de barre hors écran : la bille rebondissait alors sur de
 *    la géométrie invisible, et sa note venait d'une longueur que personne ne voyait.
 * 4. Le dessin reste hors du HUD, en haut comme en bas.
 *
 * Entièrement déterministe : une même graine redonne la même scène.
 */
export function buildSurpriseScene(bounds: Bounds, seed: number, place: PlaceBar): void {
  const rng = createRng(seed)
  const area = sceneArea(bounds)
  const usable = Math.max(120, area.right - area.left)
  const rowGap = (area.bottom - area.top) / ROWS
  const perRow = Math.max(2, Math.round(bounds.w / 400))
  const slot = usable / perRow

  for (let row = 0; row < ROWS; row++) {
    const y = area.top + rowGap * (row + 0.5)
    const onSeams = row % 2 === 1
    // Les rangées impaires se posent sur les **coutures** entre les pas de la rangée paire (donc
    // une barre de moins). Un simple décalage d'un demi-pas envoyait la dernière barre hors zone,
    // où elle était supprimée — ce qui rouvrait un couloir vertical côté droit.
    const count = onSeams ? perRow - 1 : perRow

    for (let i = 0; i < count; i++) {
      const lengthFactor = 0.62 + rng() * 0.38
      const slope = ((row + i) % 2 === 0 ? 1 : -1) * (0.18 + rng() * 0.34)

      const cx = area.left + slot * (onSeams ? i + 1 : i + 0.5)
      const maxHalf = Math.min(cx - area.left, area.right - cx)
      if (maxHalf < MIN_HALF) continue

      // Les barres de bord vont jusqu'au bord : sinon il reste une bande où une bille tombe sans
      // jamais rien toucher, et la scène d'accueil ne joue rien pour qui clique dans le coin.
      const isEdge = !onSeams && (i === 0 || i === count - 1)
      const half = isEdge ? maxHalf : Math.min((slot * lengthFactor) / 2, maxHalf)
      const maxRise = Math.min(y - area.top, area.bottom - y)
      const rise = Math.max(-maxRise, Math.min(maxRise, slope * half))

      place({ x: cx - half, y: y - rise }, { x: cx + half, y: y + rise })
    }
  }
}
