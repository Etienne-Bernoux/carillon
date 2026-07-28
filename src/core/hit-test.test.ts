import { describe, expect, it } from 'vitest'
import { MOUSE_RADII, TOUCH_RADII, hitTestBars, hitTestWorld } from './hit-test'
import type { Bar, Emitter } from './types'

function bar(id: number, ax: number, ay: number, bx: number, by: number, midi = 60): Bar {
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by }, restitution: 0.8, midi, lastHitAt: -1 }
}

describe('C1 — hitTestBars', () => {
  const horizontal = bar(0, 100, 200, 400, 200)

  it('ne touche rien loin de toute barre', () => {
    expect(hitTestBars([horizontal], { x: 250, y: 400 })).toBeNull()
  })

  it('attrape le corps au milieu de la barre', () => {
    const hit = hitTestBars([horizontal], { x: 250, y: 204 })
    expect(hit?.kind).toBe('body')
    expect(hit?.bar.id).toBe(0)
    expect(hit?.distance).toBeCloseTo(4, 5)
  })

  it('attrape l’extrémité A près de a, l’extrémité B près de b', () => {
    expect(hitTestBars([horizontal], { x: 104, y: 200 })?.kind).toBe('endA')
    expect(hitTestBars([horizontal], { x: 396, y: 200 })?.kind).toBe('endB')
  })

  it('préfère l’extrémité au corps quand les deux sont à portée', () => {
    // À 6 px du bout : le corps est aussi à portée, mais accorder doit gagner sur déplacer.
    const hit = hitTestBars([horizontal], { x: 106, y: 202 })
    expect(hit?.kind).toBe('endA')
  })

  it('sur une barre plus courte que le rayon de préhension, l’extrémité gagne', () => {
    const tiny = bar(1, 500, 500, 512, 500)
    const hit = hitTestBars([tiny], { x: 506, y: 500 })
    expect(hit?.kind).toBe('endA')
    expect(hit?.bar.id).toBe(1)
  })

  it('choisit la barre la plus proche entre deux candidates', () => {
    const near = bar(1, 100, 210, 400, 210)
    const far = bar(2, 100, 190, 400, 190)
    // y = 208 : 2 px de `near`, 18 px de `far`.
    expect(hitTestBars([far, near], { x: 250, y: 208 })?.bar.id).toBe(1)
  })

  it('est déterministe sur deux barres exactement superposées', () => {
    const first = bar(1, 100, 200, 400, 200)
    const second = bar(2, 100, 200, 400, 200)
    const a = hitTestBars([first, second], { x: 250, y: 200 })
    const b = hitTestBars([first, second], { x: 250, y: 200 })
    expect(a?.bar.id).toBe(b?.bar.id)
    // Comparaison stricte au parcours ⇒ la première rencontrée gagne, donc le plus petit id.
    expect(a?.bar.id).toBe(1)
  })

  it('a un rayon de préhension plus généreux au doigt qu’à la souris', () => {
    const point = { x: 250, y: 216 }
    expect(hitTestBars([horizontal], point, MOUSE_RADII)).toBeNull()
    expect(hitTestBars([horizontal], point, TOUCH_RADII)?.kind).toBe('body')
  })

  it('gère une barre dégénérée (deux extrémités confondues) sans jeter', () => {
    const degenerate = bar(3, 300, 300, 300, 300)
    expect(hitTestBars([degenerate], { x: 302, y: 300 })?.kind).toBe('endA')
    expect(hitTestBars([degenerate], { x: 900, y: 900 })).toBeNull()
  })

  it('ne touche rien quand la liste est vide', () => {
    expect(hitTestBars([], { x: 0, y: 0 })).toBeNull()
  })

  it('le corps sous le doigt bat l’extrémité lointaine d’une autre barre', () => {
    // Défaut réel avant correction : l'arbitrage « toute extrémité bat tout corps » était global,
    // donc appuyer pile au milieu d'une barre pouvait étirer la barre voisine — on éditait un autre
    // objet que celui visé.
    const target = bar(1, 100, 300, 500, 300)
    // Extrémité de la voisine à ~21 px du point visé, donc dans le rayon tactile (24 px), alors que
    // le corps de la cible est à 0 px : c'est le cas où l'ancien arbitrage global se trompait d'objet.
    const neighbour = bar(2, 320, 308, 800, 380)
    const hit = hitTestBars([target, neighbour], { x: 300, y: 300 }, TOUCH_RADII)
    expect(hit?.bar.id).toBe(1)
    expect(hit?.kind).toBe('body')
  })

  it('reste attrapable par le corps même si une extrémité traîne dans le rayon', () => {
    const long = bar(1, 100, 300, 500, 300)
    const hit = hitTestBars([long], { x: 300, y: 302 })
    expect(hit?.kind).toBe('body')
  })

  it('privilégie toujours l’extrémité quand on vise vraiment le bout', () => {
    const long = bar(1, 100, 300, 500, 300)
    expect(hitTestBars([long], { x: 498, y: 300 })?.kind).toBe('endB')
  })
})

describe('D4 — préhension générique (barres et sources)', () => {
  const horizontal = bar(0, 100, 200, 500, 200)

  function emitter(id: number, x: number, y: number): Emitter {
    return { id, pos: { x, y }, period: 0.9, nextAt: 0.9, hue: 200 }
  }

  it('ne touche rien loin de tout', () => {
    expect(hitTestWorld([horizontal], [emitter(0, 800, 600)], { x: 300, y: 500 })).toBeNull()
  })

  it('attrape une source quand on la vise', () => {
    const grab = hitTestWorld([horizontal], [emitter(0, 800, 600)], { x: 804, y: 603 })
    expect(grab?.target).toBe('emitter')
  })

  it('attrape la barre quand aucune source n’est à portée', () => {
    const grab = hitTestWorld([horizontal], [emitter(0, 800, 600)], { x: 300, y: 202 })
    expect(grab?.target).toBe('bar')
    expect(grab?.target === 'bar' && grab.kind).toBe('body')
  })

  it('préfère la source au corps d’une barre quand elle est posée dessus', () => {
    // Cas réel : on pose une source sur une barre. Viser la source doit l'attraper, pas la barre.
    const grab = hitTestWorld([horizontal], [emitter(0, 300, 200)], { x: 302, y: 201 })
    expect(grab?.target).toBe('emitter')
  })

  it('ne laisse pas une source lointaine battre le corps sous le doigt', () => {
    // Même défaut que celui corrigé en US3 pour les extrémités, mais entre catégories cette fois.
    const grab = hitTestWorld([horizontal], [emitter(0, 316, 208)], { x: 300, y: 200 }, TOUCH_RADII)
    expect(grab?.target).toBe('bar')
  })

  it('fonctionne sans aucune source', () => {
    expect(hitTestWorld([horizontal], [], { x: 300, y: 202 })?.target).toBe('bar')
  })
})
