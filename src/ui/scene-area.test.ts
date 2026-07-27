import { describe, expect, it } from 'vitest'
import type { Bounds } from '../core/types'
import { measureSceneArea } from './scene-area'
import { sceneArea } from './scene'

/**
 * Faux DOM minimal : `measureSceneArea` n'a besoin que de `querySelectorAll` et des rectangles.
 * Un vrai DOM (jsdom) coûterait une dépendance pour vérifier une soustraction.
 */
function fakeRoot(rects: Array<{ top: number; bottom: number }>): ParentNode {
  const elements = rects.map((rect) => ({
    getBoundingClientRect: () => ({ ...rect, width: 200, height: rect.bottom - rect.top }),
  }))
  // Cast assumé : `measureSceneArea` n'appelle que `querySelectorAll` et lit des rectangles. Typer
  // fidèlement un `ParentNode` complet demanderait jsdom, soit une dépendance de test pour vérifier
  // une soustraction. À retirer si un vrai DOM entre un jour dans la suite de tests.
  return { querySelectorAll: () => elements } as unknown as ParentNode
}

const PHONE_LANDSCAPE: Bounds = { w: 844, h: 390 }
const DESKTOP: Bounds = { w: 1280, h: 800 }

describe('measureSceneArea', () => {
  it('replie sur l’heuristique quand aucun élément de HUD n’est mesurable', () => {
    expect(measureSceneArea(DESKTOP, fakeRoot([]))).toEqual(sceneArea(DESKTOP))
  })

  it('descend sous un HUD haut, quelle que soit la hauteur de l’écran', () => {
    // Le cas qui a motivé ce module : en paysage, la marge en fraction de hauteur tombait à 70 px
    // alors que le HUD descend jusqu'à 72 px, donc les barres passaient derrière les boutons.
    const area = measureSceneArea(PHONE_LANDSCAPE, fakeRoot([{ top: 20, bottom: 72 }]))
    expect(area.top).toBeGreaterThanOrEqual(72)
  })

  it('remonte au-dessus d’un HUD bas (barre d’outils en bas, disposition mobile)', () => {
    const area = measureSceneArea({ w: 375, h: 740 }, fakeRoot([
      { top: 18, bottom: 90 },
      { top: 595, bottom: 665 },
      { top: 680, bottom: 726 },
    ]))
    expect(area.top).toBeGreaterThanOrEqual(90)
    expect(area.bottom).toBeLessThanOrEqual(595)
  })

  it('garde une hauteur jouable même si le HUD dévore l’écran', () => {
    const area = measureSceneArea({ w: 400, h: 260 }, fakeRoot([
      { top: 0, bottom: 130 },
      { top: 150, bottom: 260 },
    ]))
    expect(area.bottom - area.top).toBeGreaterThanOrEqual(129)
    expect(area.top).toBeGreaterThanOrEqual(0)
    expect(area.bottom).toBeLessThanOrEqual(260)
  })

  it('ignore les éléments de taille nulle (masqués)', () => {
    const withHidden = measureSceneArea(DESKTOP, fakeRoot([
      { top: 18, bottom: 90 },
      { top: 400, bottom: 400 },
    ]))
    const withoutHidden = measureSceneArea(DESKTOP, fakeRoot([{ top: 18, bottom: 90 }]))
    expect(withHidden).toEqual(withoutHidden)
  })

  it('conserve les marges latérales de l’heuristique', () => {
    const area = measureSceneArea(DESKTOP, fakeRoot([{ top: 18, bottom: 90 }]))
    expect(area.left).toBe(sceneArea(DESKTOP).left)
    expect(area.right).toBe(sceneArea(DESKTOP).right)
  })
})
