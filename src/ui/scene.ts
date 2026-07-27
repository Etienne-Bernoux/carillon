import { lengthRangeForWidth } from '../core/music'
import { createRng } from '../core/rng'
import type { Bounds, Vec2 } from '../core/types'

export type PlaceBar = (a: Vec2, b: Vec2) => void

/** Zone occupée par le titre en haut, à laisser libre pour ne pas dessiner sous le HUD. */
export const TOP_INSET = 130
/** Zone occupée par la barre d'outils et l'indice en bas (cf. style.css, disposition mobile). */
export const BOTTOM_INSET = 170
export const ROWS = 6
/** Demi-longueur minimale d'une barre : en dessous, une bille de 16 px de diamètre la manque. */
const MIN_HALF = 18

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
export function buildSurpriseScene(
  bounds: Bounds,
  seed: number,
  place: PlaceBar,
  /**
   * Rectangle jouable. Par défaut l'heuristique `sceneArea`, mais l'application passe la zone
   * **mesurée sur le DOM** : aucune marge en dur ne peut savoir où est le HUD, qui change de place
   * selon la largeur et ne rétrécit pas quand l'écran est bas (cf. `scene-area.ts`).
   */
  area: SceneArea = sceneArea(bounds),
): void {
  const rng = createRng(seed)
  const usable = area.right - area.left
  const rowGap = (area.bottom - area.top) / ROWS
  const perRow = Math.max(2, Math.round(bounds.w / 400))
  const slot = usable / perRow

  const slots: Array<{ row: number; index: number; onSeams: boolean; isEdge: boolean }> = []
  for (let row = 0; row < ROWS; row++) {
    // Les rangées impaires se posent sur les **coutures** entre les pas de la rangée paire (donc
    // une barre de moins). Un simple décalage d'un demi-pas envoyait la dernière barre hors zone,
    // où elle était supprimée — ce qui rouvrait un couloir vertical côté droit.
    const onSeams = row % 2 === 1
    const count = onSeams ? perRow - 1 : perRow
    for (let index = 0; index < count; index++) {
      slots.push({ row, index, onSeams, isEdge: !onSeams && (index === 0 || index === count - 1) })
    }
  }

  // Les longueurs cibles sont tirées sur l'étendue **de l'instrument** à cette largeur, pas sur le pas
  // de la rangée. Calibrer sur le pas semblait naturel mais désaccordait les deux échelles : dès que
  // la scène ne tenait que deux colonnes (toute largeur de 200 à 999 px), un tiers des longueurs
  // dépassait le plafond du mapping et saturait sur la **même** note grave — 6 hauteurs sur 15.
  const targets = stratifiedLengths(slots.length, lengthRangeForWidth(bounds.w), rng)

  for (const [k, spot] of slots.entries()) {
    const y = area.top + rowGap * (spot.row + 0.5)
    const desiredHalf = (targets[k] ?? slot) / 2
    const slope = ((spot.row + spot.index) % 2 === 0 ? 1 : -1) * (0.18 + rng() * 0.34)

    // Place disponible d'abord, longueur ensuite : on **borne** la longueur au minimum jouable au
    // lieu de supprimer la barre. Supprimer faisait disparaître le degré le plus aigu de la scène
    // sur écran étroit, sans que rien ne le signale.
    const center = spot.onSeams ? spot.index + 1 : spot.index + 0.5
    const room = spot.isEdge
      ? usable / 2
      : Math.min(slot * center, usable - slot * center)
    if (room < MIN_HALF) continue

    const half = Math.min(Math.max(desiredHalf, MIN_HALF), room)
    const cx = spot.isEdge
      ? // Barre de bord **ancrée au bord** : l'ancrage préserve la couverture (aucun couloir
        // vertical où une bille tombe sans rien toucher) sans imposer une longueur unique à toutes
        // les barres de bord, ce qui gaspillait un degré de gamme.
        spot.index === 0
        ? area.left + half
        : area.right - half
      : area.left + slot * center

    const maxRise = Math.min(y - area.top, area.bottom - y)
    const rise = Math.max(-maxRise, Math.min(maxRise, slope * half))

    place({ x: cx - half, y: y - rise }, { x: cx + half, y: y + rise })
  }
}

/**
 * Longueurs **stratifiées** sur la plage donnée, puis mélangées, au lieu de tirages indépendants.
 *
 * En tirage libre, la richesse musicale dépendait de la chance : sur un téléphone (9 barres), des
 * graines malchanceuses ne donnaient que 3 hauteurs distinctes. La stratification garantit que la
 * scène parcourt l'étendue **par construction**, pas en moyenne. Le mélange évite que la scène se
 * lise comme une rampe monotone de la plus courte à la plus longue.
 *
 * Le cas `count <= 1` n'est pas atteignable depuis l'appelant actuel (au moins 9 emplacements), mais
 * il est traité ici parce que la division par `count - 1` rendrait la fonction fausse pour un
 * appelant futur : c'est le contrat de la fonction, pas une branche défensive gratuite.
 */
function stratifiedLengths(
  count: number,
  range: { min: number; max: number },
  rng: () => number,
): number[] {
  const lengths = Array.from({ length: count }, (_, i) =>
    count <= 1 ? range.max : range.min + ((range.max - range.min) * i) / (count - 1),
  )
  for (let i = lengths.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const swap = lengths[i] ?? range.min
    lengths[i] = lengths[j] ?? range.min
    lengths[j] = swap
  }
  return lengths
}
