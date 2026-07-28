import { describe, expect, it } from 'vitest'
import { DEFAULT_TUNING, midiForLength } from './music'
import { createRng } from './rng'
import { decodeScene, encodeScene } from './share'
import { placeSharedBar, placeSharedEmitter, toSharedBar, toSharedPoint } from './share-layout'
import type { LayoutArea } from './share-layout'
import type { Vec2 } from './types'

const MIN_BAR_LENGTH = 24
const TUNING_IDS = [DEFAULT_TUNING.id]

/** Écrans réels, avec leurs zones de jeu mesurées (cf. `scene-area.ts`). */
const DESKTOP = { area: { left: 48, top: 130, right: 1232, bottom: 672 } as LayoutArea, width: 1280 }
const PHONE = { area: { left: 22, top: 72, right: 353, bottom: 592 } as LayoutArea, width: 375 }
const LANDSCAPE = { area: { left: 48, top: 86, right: 796, bottom: 326 } as LayoutArea, width: 844 }

/** Barres dessinées à la main sur le grand écran, dans sa zone de jeu. */
function drawnOnDesktop(): Array<[Vec2, Vec2]> {
  const rng = createRng(99)
  return Array.from({ length: 14 }, () => {
    const length = 40 + rng() * 600
    const angle = (rng() - 0.5) * 1.4
    const cx = 200 + rng() * 800
    const cy = 200 + rng() * 400
    const half = length / 2
    return [
      { x: cx - Math.cos(angle) * half, y: cy - Math.sin(angle) * half },
      { x: cx + Math.cos(angle) * half, y: cy + Math.sin(angle) * half },
    ] as [Vec2, Vec2]
  })
}

function noteOf([a, b]: [Vec2, Vec2], width: number): number {
  return midiForLength(Math.hypot(b.x - a.x, b.y - a.y), DEFAULT_TUNING, width)
}

/** Chemin complet : pixels → fractions → **encodage réel** → décodage → pixels. */
function roundTrip(
  drawn: Array<[Vec2, Vec2]>,
  from: typeof DESKTOP,
  to: typeof DESKTOP,
): Array<[Vec2, Vec2]> {
  const shared = drawn.map(([a, b]) => toSharedBar(a, b, from.area, from.width))
  const decoded = decodeScene(
    encodeScene({ tuningId: DEFAULT_TUNING.id, bars: shared, emitters: [] }, TUNING_IDS),
    TUNING_IDS,
  )
  expect(decoded).not.toBeNull()
  return (decoded?.bars ?? []).map((bar) => placeSharedBar(bar, to.area, to.width, MIN_BAR_LENGTH))
}

describe('E2 — invariance des notes, par le vrai chemin', () => {
  // Ce test passe par des **pixels de départ** et des **pixels d'arrivée**, sur deux écrans réels, en
  // traversant l'encodage. Une version antérieure comparait `midiForLength(len·w, T, w)` à
  // `midiForLength(len·1280, T, 1280)` : le `w` se simplifie, c'était une identité arithmétique vraie
  // quoi que fasse l'encodeur. Ici, normaliser la longueur par la hauteur ferait échouer le test.
  /**
   * Assertion **exacte** plutôt qu'un quota : une note ne peut bouger que si la barre est trop courte
   * pour l'écran cible et qu'on l'a allongée au minimum jouable — perdre une barre d'un lien reçu
   * serait pire. Toute autre barre doit garder sa note, sans exception. Un quota (« au plus une
   * décalée ») aurait laissé passer une déformation réelle sur une scène plus dense.
   */
  function expectNotesPreserved(from: typeof DESKTOP, to: typeof DESKTOP): void {
    const drawn = drawnOnDesktop()
    const placed = roundTrip(drawn, from, to)
    expect(placed).toHaveLength(drawn.length)

    // En dessous de cette longueur chez l'auteur, la barre passe sous le minimum jouable chez le
    // destinataire et doit être allongée.
    const threshold = (MIN_BAR_LENGTH * from.width) / to.width
    let stretched = 0

    for (const [i, bar] of placed.entries()) {
      const original = drawn[i] ?? bar
      const originalLength = Math.hypot(original[1].x - original[0].x, original[1].y - original[0].y)
      if (originalLength < threshold) {
        stretched++
        continue
      }
      expect(noteOf(bar, to.width), `barre ${i} (longueur ${Math.round(originalLength)} px)`).toBe(
        noteOf(original, from.width),
      )
    }
    // Le test ne prouverait rien s'il n'exerçait que des barres exemptées.
    expect(stretched).toBeLessThan(placed.length / 2)
  }

  it('conserve la note de chaque barre d’un grand écran vers un téléphone', () => {
    expectNotesPreserved(DESKTOP, PHONE)
  })

  it('conserve la note vers un écran en paysage, de rapport d’aspect très différent', () => {
    expectNotesPreserved(DESKTOP, LANDSCAPE)
  })

  it('conserve la note vers un écran plus grand, sans aucune exception', () => {
    // Vers un écran plus large, aucune barre ne passe sous le minimum : toutes les notes doivent tenir.
    const big = { area: { left: 72, top: 130, right: 1848, bottom: 950 } as LayoutArea, width: 1920 }
    const drawn = drawnOnDesktop()
    for (const [i, bar] of roundTrip(drawn, DESKTOP, big).entries()) {
      expect(noteOf(bar, big.width), `barre ${i}`).toBe(noteOf(drawn[i] ?? bar, DESKTOP.width))
    }
  })

  it('remplit la hauteur disponible au lieu de s’écraser en bandeau', () => {
    const drawn = drawnOnDesktop()
    for (const target of [PHONE, LANDSCAPE]) {
      const placed = roundTrip(drawn, DESKTOP, target)
      const ys = placed.flatMap(([a, b]) => [a.y, b.y])
      const span = Math.max(...ys) - Math.min(...ys)
      const available = target.area.bottom - target.area.top
      // Le format « tout normalisé par la largeur » tombait ici à 27 % sur le téléphone.
      expect(span / available).toBeGreaterThan(0.5)
    }
  })
})

describe('recadrage : rien ne sort de la zone', () => {
  for (const [name, target] of [
    ['téléphone', PHONE],
    ['paysage', LANDSCAPE],
    ['bureau', DESKTOP],
  ] as const) {
    it(`garde chaque barre dans la zone sur ${name}`, () => {
      for (const [a, b] of roundTrip(drawnOnDesktop(), DESKTOP, target)) {
        for (const point of [a, b]) {
          expect(point.x).toBeGreaterThanOrEqual(target.area.left - 0.5)
          expect(point.x).toBeLessThanOrEqual(target.area.right + 0.5)
          expect(point.y).toBeGreaterThanOrEqual(target.area.top - 0.5)
          expect(point.y).toBeLessThanOrEqual(target.area.bottom + 0.5)
        }
      }
    })
  }

  it('étire AVANT de recadrer : une barre courte collée au bord haut reste dans la zone', () => {
    // C'est le défaut trouvé en revue : recadrer puis étirer faisait ressortir la barre sous le HUD.
    // Milieu au sommet de la zone, longueur minuscule.
    const bar = { mx: 0.5, my: 0, len: 0.005, angle: Math.PI / 2 }
    const [a, b] = placeSharedBar(bar, PHONE.area, PHONE.width, MIN_BAR_LENGTH)

    expect(Math.min(a.y, b.y)).toBeGreaterThanOrEqual(PHONE.area.top - 0.5)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(MIN_BAR_LENGTH - 0.001)
  })

  it('garde une barre plus longue que la zone plutôt que de la raccourcir', () => {
    const bar = { mx: 0.5, my: 0.5, len: 0.98, angle: 0 }
    const [a, b] = placeSharedBar(bar, PHONE.area, PHONE.width, MIN_BAR_LENGTH)
    // Elle dépasse la zone en largeur : on ne peut pas la rentrer, mais sa longueur — donc sa note —
    // ne doit pas être sacrifiée.
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(0.98 * PHONE.width, 5)
  })
})

describe('sources', () => {
  it('conserve la position relative d’une source d’un écran à l’autre', () => {
    const point: Vec2 = { x: 640, y: 300 }
    const shared = toSharedPoint(point, DESKTOP.area, DESKTOP.width)

    const onPhone = placeSharedEmitter({ ...shared, period: 0.9 }, PHONE.area, PHONE.width)
    // Milieu horizontal chez l'auteur ⇒ milieu horizontal chez le destinataire.
    expect(onPhone.x / PHONE.width).toBeCloseTo(point.x / DESKTOP.width, 6)
    // Et la même fraction de hauteur de zone.
    const fromTop = (onPhone.y - PHONE.area.top) / (PHONE.area.bottom - PHONE.area.top)
    const authorFromTop = (point.y - DESKTOP.area.top) / (DESKTOP.area.bottom - DESKTOP.area.top)
    expect(fromTop).toBeCloseTo(authorFromTop, 5)
  })

  it('n’envoie jamais une source hors de la zone, même avec des fractions absurdes', () => {
    for (const [x, y] of [
      [-5, -5],
      [12, 40],
      [0, 0],
      [1, 1],
    ]) {
      const placed = placeSharedEmitter({ x: x ?? 0, y: y ?? 0, period: 0.9 }, PHONE.area, PHONE.width)
      expect(placed.x).toBeGreaterThanOrEqual(PHONE.area.left)
      expect(placed.x).toBeLessThanOrEqual(PHONE.area.right)
      expect(placed.y).toBeGreaterThanOrEqual(PHONE.area.top)
      expect(placed.y).toBeLessThanOrEqual(PHONE.area.bottom)
    }
  })
})
