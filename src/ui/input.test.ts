import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Grab } from '../core/hit-test'
import type { Bar, Vec2 } from '../core/types'
import { LONG_PRESS_MS, attachInput } from './input'
import type { Gesture } from './input'

/**
 * Faux canvas : la machine à gestes n'a besoin que d'écouter des événements et de connaître son
 * rectangle. Un vrai DOM coûterait une dépendance pour vérifier une machine à états.
 */
function harness(hit: Grab | null = null) {
  const listeners = new Map<string, (event: PointerEvent) => void>()
  const canvas = {
    addEventListener: (type: string, handler: (event: PointerEvent) => void) => {
      listeners.set(type, handler)
    },
    removeEventListener: (type: string) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
    style: {},
    // Cast assumé : `attachInput` n'utilise du canvas que ces cinq membres. Fournir un
    // `HTMLCanvasElement` complet exigerait jsdom, soit une dépendance de test pour vérifier une
    // machine à états pure. À retirer si un vrai DOM entre un jour dans la suite de tests.
  } as unknown as HTMLCanvasElement

  const gestures: Gesture[] = []
  let firstGestures = 0

  attachInput(canvas, {
    onFirstGesture: () => firstGestures++,
    hitTest: () => hit,
    onGesture: (gesture) => gestures.push(gesture),
  })

  function send(type: string, x: number, y: number, pointerType = 'mouse', pointerId = 1): void {
    listeners.get(type)?.({ pointerId, pointerType, clientX: x, clientY: y } as PointerEvent)
  }

  return {
    gestures,
    types: () => gestures.map((gesture) => gesture.type),
    firstGestures: () => firstGestures,
    down: (x: number, y: number, pointerType?: string) => send('pointerdown', x, y, pointerType),
    move: (x: number, y: number, pointerType?: string) => send('pointermove', x, y, pointerType),
    up: (x: number, y: number, pointerType?: string) => send('pointerup', x, y, pointerType),
    cancel: (x: number, y: number) => send('pointercancel', x, y),
  }
}

function fakeHit(kind: 'body' | 'endA' | 'endB' = 'body'): Grab {
  const bar: Bar = {
    id: 7,
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    restitution: 0.8,
    midi: 60,
    lastHitAt: -1,
  }
  return { target: 'bar', bar, kind, distance: 2 }
}

describe('machine à gestes', () => {
  // L'appui long repose sur un timer : on le pilote plutôt que d'attendre 500 ms par test.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('un tap dans le vide lâche une bille, sans jamais dessiner', () => {
    const h = harness(null)
    h.down(100, 100)
    h.move(104, 103)
    h.up(104, 103)

    expect(h.types()).toEqual(['draft-cancel', 'drop-ball'])
    expect(h.firstGestures()).toBe(1)
  })

  it('un glisser dans le vide dessine puis crée une barre', () => {
    const h = harness(null)
    h.down(100, 100)
    h.move(140, 100)
    h.move(200, 120)
    h.up(200, 120)

    expect(h.types()).toEqual(['draft', 'draft', 'draft-cancel', 'create-bar'])
    const created = h.gestures.at(-1)
    expect(created).toMatchObject({ type: 'create-bar', a: { x: 100, y: 100 }, b: { x: 200, y: 120 } })
  })

  it('respecte le seuil de 14 px : un micro-mouvement reste un tap', () => {
    const h = harness(null)
    h.down(100, 100)
    h.move(113, 100)
    h.up(113, 100)
    expect(h.types()).toEqual(['draft-cancel', 'drop-ball'])
  })

  it('un tap sur une barre la fait sonner et ne lâche pas de bille', () => {
    const h = harness(fakeHit())
    h.down(50, 0)
    h.up(52, 1)

    expect(h.types()).toEqual(['grab', 'tap'])
    expect(h.types()).not.toContain('drop-ball')
  })

  it('un glisser depuis une barre la déplace et ne crée jamais de barre', () => {
    const h = harness(fakeHit('body'))
    h.down(50, 0)
    h.move(80, 0)
    h.move(110, 10)
    h.up(110, 10)

    expect(h.types()).toEqual(['grab', 'drag', 'drag', 'release'])
    expect(h.types()).not.toContain('create-bar')
    // Le delta est relatif au point précédent, pas au départ : sinon la barre accélérerait.
    const drags = h.gestures.filter((gesture) => gesture.type === 'drag')
    expect(drags[1]).toMatchObject({ delta: { x: 30, y: 10 } })
  })

  it('émet le grab dès la préhension, avant tout mouvement', () => {
    const h = harness(fakeHit('endA'))
    h.down(0, 0)
    expect(h.types()).toEqual(['grab'])
    expect(h.gestures[0]).toMatchObject({ type: 'grab', hit: { kind: 'endA' } })
  })

  it('un geste interrompu par le système ne crée rien et ne lâche rien', () => {
    const h = harness(null)
    h.down(100, 100)
    h.move(200, 100)
    h.cancel(200, 100)

    expect(h.types()).toEqual(['draft', 'draft-cancel'])
    expect(h.types()).not.toContain('create-bar')
  })

  it('signale le survol au passage, et seulement sur changement', () => {
    const h = harness(fakeHit())
    h.move(50, 0)
    h.move(52, 0)
    h.move(54, 0)
    expect(h.types()).toEqual(['hover'])
  })

  it('n’émet pas de survol au doigt (il n’y a pas de survol tactile)', () => {
    const h = harness(fakeHit())
    h.move(50, 0, 'touch')
    expect(h.types()).toEqual([])
  })

  it('ignore un second pointeur pendant un geste en cours', () => {
    // Avec `harness(null)` ce test ne pouvait pas échouer : le premier `down` n'émet rien, donc
    // supprimer la garde n'aurait rien changé au compte. Avec une barre sous le pointeur, un second
    // `down` traité émettrait un deuxième `grab` — l'assertion contraint enfin quelque chose.
    const h = harness(fakeHit())
    h.down(50, 0)
    h.down(300, 300, 'mouse')
    expect(h.types()).toEqual(['grab'])
  })

  it('un second pointeur ne déplace pas l’origine du tracé en cours', () => {
    const h = harness(null)
    h.down(100, 100)
    h.down(300, 300)
    h.move(200, 100)
    h.up(200, 100)
    expect(h.gestures.at(-1)).toMatchObject({ type: 'create-bar', a: { x: 100, y: 100 } })
  })

  it('marque le relâchement comme interrompu quand le système reprend le pointeur', () => {
    const h = harness(fakeHit())
    h.down(50, 0)
    h.move(150, 0)
    h.cancel(150, 0)
    expect(h.gestures.at(-1)).toMatchObject({ type: 'release', cancelled: true })
  })

  it('émet toujours un relâchement, même interrompu sans mouvement : il éteint la mise en évidence', () => {
    const h = harness(fakeHit())
    h.down(50, 0)
    h.cancel(51, 0)
    expect(h.types()).toEqual(['grab', 'release'])
  })

  it('réémet le survol après un geste, même si le pointeur n’a pas quitté la barre', () => {
    // Sans remise à zéro de la clé de survol, les poignées restaient éteintes après un déplacement
    // jusqu'à ce qu'on quitte la barre et qu'on y revienne.
    const h = harness(fakeHit())
    h.move(50, 0)
    h.down(50, 0)
    h.move(150, 0)
    h.up(150, 0)
    h.move(150, 0)
    expect(h.types().filter((type) => type === 'hover')).toHaveLength(2)
  })

  it('ne déverrouille l’audio qu’une seule fois', () => {
    const h = harness(null)
    const tap = (point: Vec2): void => {
      h.down(point.x, point.y)
      h.up(point.x, point.y)
    }
    tap({ x: 10, y: 10 })
    tap({ x: 20, y: 20 })
    expect(h.firstGestures()).toBe(1)
  })

  it('un appui long dans le vide pose une source, et ne lâche pas de bille', () => {
    const h = harness(null)
    h.down(300, 300)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.up(300, 300)

    expect(h.types()).toContain('long-press')
    expect(h.types()).not.toContain('drop-ball')
    expect(h.gestures.find((g) => g.type === 'long-press')).toMatchObject({ point: { x: 300, y: 300 } })
  })

  it('un tap court lâche toujours une bille : l’appui long ne vole pas le geste', () => {
    const h = harness(null)
    h.down(300, 300)
    vi.advanceTimersByTime(LONG_PRESS_MS - 100)
    h.up(300, 300)

    expect(h.types()).toContain('drop-ball')
    expect(h.types()).not.toContain('long-press')
  })

  it('un glisser franc annule l’appui long', () => {
    const h = harness(null)
    h.down(300, 300)
    h.move(400, 300)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.up(400, 300)

    expect(h.types()).not.toContain('long-press')
    expect(h.types()).toContain('create-bar')
  })

  it('un tremblement sous le seuil de tap n’annule pas l’appui long', () => {
    const h = harness(null)
    h.down(300, 300)
    h.move(305, 302)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.up(305, 302)

    expect(h.types()).toContain('long-press')
  })

  it('pas d’appui long sur une barre : ce serait voler le geste d’écoute', () => {
    const h = harness(fakeHit())
    h.down(50, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.up(50, 0)

    expect(h.types()).not.toContain('long-press')
    expect(h.types()).toEqual(['grab', 'tap'])
  })
})
