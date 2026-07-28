import { describe, expect, it } from 'vitest'
import { DEFAULT_TUNING, TUNINGS, midiForLength } from '../core/music'
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
  buildSurpriseScene(bounds, seed, { bar: (a, b) => bars.push([a, b]) })
  return bars
}

describe('B3 — richesse musicale de la scène d’accueil', () => {
  function distinctPitches(bounds: Bounds, seed: number, tuning = DEFAULT_TUNING): number {
    const midis = collect(bounds, seed).map(([a, b]) =>
      midiForLength(Math.hypot(b.x - a.x, b.y - a.y), tuning, bounds.w),
    )
    return new Set(midis).size
  }

  // Les seuils portent sur **tous** les viewports, pas seulement ceux qui avaient été mesurés :
  // caler un seuil sur les deux largeurs qu'on a regardées laisse un trou pour toutes les autres.
  // C'est ce trou qui cachait 6 hauteurs sur 15 entre 600 et 999 px de large.
  it('joue au moins 5 hauteurs distinctes partout, y compris sur un téléphone (2 avant l’US2)', () => {
    for (const bounds of VIEWPORTS) {
      for (const seed of [1, 7, 12, 30]) {
        const pitches = distinctPitches(bounds, seed)
        expect(pitches, `${bounds.w}x${bounds.h} graine ${seed}`).toBeGreaterThanOrEqual(5)
      }
    }
  })

  it('joue au moins 8 hauteurs distinctes dès qu’il y a la place (≥ 600 px)', () => {
    for (const bounds of VIEWPORTS.filter((v) => v.w >= 600)) {
      for (const seed of [1, 7, 12, 30]) {
        const pitches = distinctPitches(bounds, seed)
        expect(pitches, `${bounds.w}x${bounds.h} graine ${seed}`).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('n’écrase pas plusieurs strates sur la note la plus grave', () => {
    // Symptôme du désaccord entre l'échelle des longueurs et celle du mapping : les longueurs les
    // plus grandes saturaient toutes sur le même degré, gaspillant un tiers de l'étendue.
    for (const bounds of VIEWPORTS) {
      const midis = collect(bounds, 7).map(([a, b]) =>
        midiForLength(Math.hypot(b.x - a.x, b.y - a.y), DEFAULT_TUNING, bounds.w),
      )
      const lowest = Math.min(...midis)
      const saturated = midis.filter((midi) => midi === lowest).length
      expect(saturated / midis.length, `${bounds.w}px`).toBeLessThanOrEqual(0.25)
    }
  })

  it('reste riche quelle que soit la gamme choisie', () => {
    for (const tuning of TUNINGS) {
      expect(distinctPitches({ w: 375, h: 740 }, 7, tuning)).toBeGreaterThanOrEqual(5)
    }
  })
})

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

  // Ce test mesure des longueurs en pixels, **pas** des hauteurs de note. Son ancien intitulé
  // (« sinon tout l'écran sonnerait la même note ») promettait une propriété musicale qu'il ne
  // vérifiait pas : il restait vert alors que la scène ne jouait que 4 hauteurs sur 15 possibles.
  // La propriété musicale est portée par le bloc B3 ci-dessus, qui passe par le mapping réel.
  it('fait varier les longueurs au pixel', () => {
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
