import { describe, expect, it } from 'vitest'
import type { Bounds, Vec2 } from '../core/types'
import { buildSurpriseScene, sceneArea } from './scene'

const VIEWPORTS: Bounds[] = [
  { w: 320, h: 568 },
  { w: 375, h: 740 },
  { w: 768, h: 1024 },
  { w: 1024, h: 640 },
  { w: 1280, h: 800 },
  { w: 1920, h: 1080 },
]

function collect(bounds: Bounds, seed: number): Array<[Vec2, Vec2]> {
  const bars: Array<[Vec2, Vec2]> = []
  buildSurpriseScene(bounds, seed, (a, b) => bars.push([a, b]))
  return bars
}

describe('buildSurpriseScene', () => {
  it('garde chaque extrémité de barre dans la zone de jeu, sur tous les viewports', () => {
    for (const bounds of VIEWPORTS) {
      const area = sceneArea(bounds)
      for (let seed = 1; seed <= 8; seed++) {
        for (const [a, b] of collect(bounds, seed)) {
          for (const point of [a, b]) {
            // Tolérance de 0,5 px : on borne des flottants, pas des entiers.
            expect(point.x).toBeGreaterThanOrEqual(area.left - 0.5)
            expect(point.x).toBeLessThanOrEqual(area.right + 0.5)
            expect(point.y).toBeGreaterThanOrEqual(area.top - 0.5)
            expect(point.y).toBeLessThanOrEqual(area.bottom + 0.5)
          }
        }
      }
    }
  })

  it('produit assez de barres pour former une cascade, même sur un téléphone', () => {
    for (const bounds of VIEWPORTS) {
      // 6 rangées alternant `perRow` et `perRow - 1` barres : 9 au minimum, sur un 320 px.
      expect(collect(bounds, 7).length).toBeGreaterThanOrEqual(9)
    }
  })

  it('fait varier les longueurs, sinon tout l’écran sonnerait la même note', () => {
    for (const bounds of VIEWPORTS) {
      const lengths = collect(bounds, 3).map(([a, b]) => Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 10))
      expect(new Set(lengths).size).toBeGreaterThanOrEqual(5)
    }
  })

  it('reste déterministe à graine égale et change de dessin à graine différente', () => {
    const bounds: Bounds = { w: 1280, h: 800 }
    expect(collect(bounds, 42)).toEqual(collect(bounds, 42))
    expect(collect(bounds, 42)).not.toEqual(collect(bounds, 43))
  })

  it('décale les rangées en quinconce pour qu’aucun couloir vertical ne traverse la scène', () => {
    const bounds: Bounds = { w: 1280, h: 800 }
    const bars = collect(bounds, 11)
    const area = sceneArea(bounds)
    // Pour un balayage de colonnes, au moins une barre doit couvrir la colonne : sinon une bille
    // lâchée là tomberait de haut en bas sans jamais jouer une note.
    for (let x = area.left + 40; x < area.right - 40; x += 40) {
      const covering = bars.filter(([a, b]) => Math.min(a.x, b.x) <= x && x <= Math.max(a.x, b.x))
      expect(covering.length).toBeGreaterThanOrEqual(1)
    }
  })
})
