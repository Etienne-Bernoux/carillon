import { describe, expect, it } from 'vitest'
import {
  INNER_RADIUS,
  OUTER_RADIUS,
  fitWheel,
  labelAnchor,
  labelWidthBudget,
  sectorAt,
  sectorMidAngle,
  sectorStartAngle,
} from './wheel'
import type { Rect, Wheel } from './wheel'

const MID_RADIUS = (INNER_RADIUS + OUTER_RADIUS) / 2

function wheelOf(count: number): Wheel<string> {
  return {
    center: { x: 200, y: 150 },
    options: Array.from({ length: count }, (_, i) => ({ value: `v${i}`, label: `option ${i}` })),
    current: 'v0',
  }
}

function pointAt(wheel: Wheel<string>, angle: number, radius: number): { x: number; y: number } {
  return {
    x: wheel.center.x + Math.cos(angle) * radius,
    y: wheel.center.y + Math.sin(angle) * radius,
  }
}

/** Le domaine réellement visé : 2 options serait un choix binaire, 8 le plafond lisible d'une roue. */
const COUNTS = [2, 3, 4, 5, 6, 7, 8]

describe('sectorAt', () => {
  it('rend chaque secteur atteignable, pour tout nombre d’options', () => {
    for (const count of COUNTS) {
      const wheel = wheelOf(count)
      for (let index = 0; index < count; index += 1) {
        const point = pointAt(wheel, sectorMidAngle(count, index), MID_RADIUS)
        expect(sectorAt(wheel, point), `count=${count} index=${index}`).toEqual({
          kind: 'sector',
          index,
        })
      }
    }
  })

  it('épingle dans la zone morte, quel que soit l’angle', () => {
    const wheel = wheelOf(5)
    for (let step = 0; step < 72; step += 1) {
      const angle = (step / 72) * Math.PI * 2
      const point = pointAt(wheel, angle, INNER_RADIUS - 1)
      expect(sectorAt(wheel, point), `angle=${angle}`).toEqual({ kind: 'pin' })
    }
    expect(sectorAt(wheel, wheel.center)).toEqual({ kind: 'pin' })
  })

  it('annule au-delà de l’anneau, quel que soit l’angle', () => {
    const wheel = wheelOf(5)
    for (let step = 0; step < 72; step += 1) {
      const angle = (step / 72) * Math.PI * 2
      const point = pointAt(wheel, angle, OUTER_RADIUS + 1)
      expect(sectorAt(wheel, point), `angle=${angle}`).toEqual({ kind: 'cancel' })
    }
  })

  it('couvre le tour complet sans trou ni recouvrement', () => {
    for (const count of COUNTS) {
      const wheel = wheelOf(count)
      const seen = new Set<number>()
      // Un balayage fin plutôt que quelques angles choisis : un trou d'un degré est un trou.
      for (let step = 0; step < 3600; step += 1) {
        const angle = (step / 3600) * Math.PI * 2
        const aim = sectorAt(wheel, pointAt(wheel, angle, MID_RADIUS))
        expect(aim.kind, `count=${count} angle=${angle}`).toBe('sector')
        if (aim.kind === 'sector') {
          expect(aim.index).toBeGreaterThanOrEqual(0)
          expect(aim.index).toBeLessThan(count)
          seen.add(aim.index)
        }
      }
      expect(seen.size, `count=${count}`).toBe(count)
    }
  })

  it('sépare deux secteurs adjacents de part et d’autre de leur frontière', () => {
    /*
     * Pas d'assertion sur la frontière **exacte** : un point construit par cos/sin puis relu par
     * atan2 retombe à un epsilon près, du côté qu'on ne choisit pas. C'est l'aller-retour flottant,
     * pas la partition. Ce qui compte — et ce qui casserait vraiment — est l'adjacence : juste avant
     * la frontière, le secteur précédent ; juste après, le suivant. La direction exacte est de mesure
     * nulle : on exige seulement qu'elle tombe dans l'un des deux, jamais ailleurs.
     */
    const epsilon = 1e-6
    for (const count of COUNTS) {
      const wheel = wheelOf(count)
      for (let index = 0; index < count; index += 1) {
        const boundary = sectorStartAngle(count, index)
        const before = (index - 1 + count) % count
        expect(
          sectorAt(wheel, pointAt(wheel, boundary + epsilon, MID_RADIUS)),
          `count=${count} index=${index}`,
        ).toEqual({ kind: 'sector', index })
        expect(
          sectorAt(wheel, pointAt(wheel, boundary - epsilon, MID_RADIUS)),
          `count=${count} index=${index}`,
        ).toEqual({ kind: 'sector', index: before })
        const onIt = sectorAt(wheel, pointAt(wheel, boundary, MID_RADIUS))
        expect(onIt.kind).toBe('sector')
        if (onIt.kind === 'sector') expect([index, before]).toContain(onIt.index)
      }
    }
  })

  it('centre le premier secteur sur le haut : viser vers le haut **approximativement** suffit', () => {
    /*
     * Viser pile la verticale ne prouve rien : si le haut était une **frontière** entre deux secteurs,
     * ce point tomberait quand même dans le premier, et l'assertion passerait. Ce qui compte est le
     * voisinage — sinon « je vise en haut » est un tirage au sort entre deux options, exactement ce
     * qu'une roue doit éviter. Mutation vérifiée : retirer le centrage fait rougir ce test.
     */
    for (const count of COUNTS) {
      const wheel = wheelOf(count)
      const halfSector = Math.PI / count
      // Une marge nette à l'intérieur du demi-secteur : la frontière elle-même est traitée ailleurs.
      const wobble = halfSector * 0.8
      for (const angle of [-Math.PI / 2 - wobble, -Math.PI / 2, -Math.PI / 2 + wobble]) {
        expect(sectorAt(wheel, pointAt(wheel, angle, MID_RADIUS)), `count=${count} angle=${angle}`).toEqual(
          { kind: 'sector', index: 0 },
        )
      }
    }
  })
})

describe('labelAnchor', () => {
  it('pose chaque libellé dans son propre secteur', () => {
    for (const count of COUNTS) {
      const wheel = wheelOf(count)
      for (let index = 0; index < count; index += 1) {
        expect(sectorAt(wheel, labelAnchor(wheel, index)), `count=${count}`).toEqual({
          kind: 'sector',
          index,
        })
      }
    }
  })
})

describe('labelWidthBudget', () => {
  it('décroît quand les options se multiplient', () => {
    // La corde d'un secteur rétrécit avec son angle : c'est pour ça qu'un libellé long finit par ne
    // plus tenir, et pourquoi le budget ne peut pas être une constante.
    const budgets = COUNTS.map((count) => labelWidthBudget(count))
    for (let i = 1; i < budgets.length; i += 1) {
      expect(budgets[i]).toBeLessThan(budgets[i - 1] ?? Number.POSITIVE_INFINITY)
    }
  })

  it('reste dans la corde du secteur, jamais au-delà', () => {
    for (const count of COUNTS) {
      const chord = 2 * MID_RADIUS * Math.sin(Math.PI / count)
      expect(labelWidthBudget(count)).toBeLessThan(chord)
      expect(labelWidthBudget(count)).toBeGreaterThan(0)
    }
  })

  it('deux libellés adjacents qui tiennent dans leur budget ne se chevauchent pas', () => {
    /*
     * La propriété qui compte, et celle qui était fausse : à cinq options, deux libellés du bas
     * partagent la même ordonnée et se recouvraient de 18 px. On la vérifie ici en géométrie pure,
     * pour tout nombre d'options.
     */
    for (const count of COUNTS) {
      const wheel = wheelOf(count)
      const budget = labelWidthBudget(count)
      for (let index = 0; index < count; index += 1) {
        const a = labelAnchor(wheel, index)
        const b = labelAnchor(wheel, (index + 1) % count)
        const boxA = { left: a.x - budget / 2, right: a.x + budget / 2 }
        const boxB = { left: b.x - budget / 2, right: b.x + budget / 2 }
        // Le chevauchement horizontal n'est un défaut que si les ancres sont aussi proches en vertical.
        const sameRow = Math.abs(a.y - b.y) < 12
        if (sameRow) {
          expect(
            boxA.right <= boxB.left + 1e-9 || boxB.right <= boxA.left + 1e-9,
            `count=${count} index=${index}`,
          ).toBe(true)
        }
      }
    }
  })
})

describe('fitWheel', () => {
  const area: Rect = { left: 20, right: 500, top: 40, bottom: 400 }

  function isInside(center: { x: number; y: number }, rect: Rect): boolean {
    return (
      center.x - OUTER_RADIUS >= rect.left - 1e-9 &&
      center.x + OUTER_RADIUS <= rect.right + 1e-9 &&
      center.y - OUTER_RADIUS >= rect.top - 1e-9 &&
      center.y + OUTER_RADIUS <= rect.bottom + 1e-9
    )
  }

  it('garde le disque entier dans la zone, depuis chacun des quatre coins', () => {
    const corners = [
      { x: area.left, y: area.top },
      { x: area.right, y: area.top },
      { x: area.left, y: area.bottom },
      { x: area.right, y: area.bottom },
    ]
    for (const corner of corners) {
      const center = fitWheel(corner, area)
      expect(isInside(center, area), `coin=${JSON.stringify(corner)}`).toBe(true)
    }
  })

  it('ne déplace pas une roue déjà entièrement dans la zone', () => {
    const wanted = { x: 260, y: 220 }
    expect(fitWheel(wanted, area)).toEqual(wanted)
  })

  it('centre plutôt que de coller au bord quand la zone est plus étroite que la roue', () => {
    const narrow: Rect = { left: 0, right: OUTER_RADIUS, top: 0, bottom: OUTER_RADIUS }
    expect(fitWheel({ x: 0, y: OUTER_RADIUS }, narrow)).toEqual({
      x: OUTER_RADIUS / 2,
      y: OUTER_RADIUS / 2,
    })
  })
})
