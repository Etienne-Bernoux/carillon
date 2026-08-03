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
    nature: 'wall',
    hitsLeft: 3,
    absentUntil: -1,
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
    // `hover` reconstruit un état de mise en évidence : il reste émis au **changement de cible** et
    // nulle part ailleurs. Le suivi continu, lui, est un geste distinct — c'est l'objet du test suivant.
    expect(h.types().filter((type) => type === 'hover')).toEqual(['hover'])
  })

  it('suit le pointeur libre à chaque mouvement, pour viser dans une roue ouverte', () => {
    /*
     * Sans ce geste, promener la souris dans une roue épinglée ne produisait **aucun** événement :
     * `hover` n'est émis qu'au changement de cible, et la cible ne change pas dans un disque. On
     * choisissait donc à l'aveugle, sans jamais voir le secteur sous le curseur.
     */
    const h = harness(fakeHit())
    h.move(50, 0)
    h.move(52, 0)
    h.move(54, 0)
    const moves = h.gestures.filter((gesture) => gesture.type === 'pointer-move')
    expect(moves).toHaveLength(3)
    expect(moves.at(-1)).toMatchObject({ point: { x: 54, y: 0 } })
  })

  it('ne suit pas le pointeur au doigt : il n’y a pas de pointeur libre au tactile', () => {
    const h = harness(fakeHit())
    h.move(50, 0, 'touch')
    expect(h.types()).not.toContain('pointer-move')
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

  it('appui long sur une barre : il agit **sans** voler le geste d’écoute', () => {
    /*
     * Ce test asseyait l'inverse jusqu'à l'US9 — « pas d'appui long sur une barre » — et son motif
     * était bon : le relâchement qui suit ne doit pas faire sonner la barre par-dessus. La décision a
     * changé (l'appui long change la nature de la barre), le motif est conservé : on exige toujours
     * qu'aucun `tap` ne soit émis, et le `release` porte `handled` pour que le gestionnaire ne décide
     * rien de plus.
     */
    const h = harness(fakeHit())
    h.down(50, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.up(50, 0)

    expect(h.types()).toEqual(['grab', 'long-press', 'long-press-end', 'release'])
    // Le geste d'écoute n'est pas volé : pas de `tap`, donc la barre ne sonne pas.
    expect(h.types()).not.toContain('tap')
    const press = h.gestures.find((g) => g.type === 'long-press')
    expect(press?.hit?.target).toBe('bar')
    const release = h.gestures.find((g) => g.type === 'release')
    expect(release?.handled).toBe(true)
  })

  it('le pointeur reste suivi après un appui long, et le relâchement dit où', () => {
    /*
     * C'est ce qui rend un choix radial visable dans le même geste que son ouverture. Avant l'US16, le
     * mouvement était **supprimé** après un appui long : rien ne pouvait suivre le doigt.
     */
    const h = harness(fakeHit())
    h.down(50, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.move(50, -60)
    h.move(90, -20)
    h.up(90, -20)

    const aims = h.gestures.filter((g) => g.type === 'long-press-move')
    expect(aims).toHaveLength(2)
    expect(aims[0]).toMatchObject({ point: { x: 50, y: -60 } })
    expect(aims[1]).toMatchObject({ point: { x: 90, y: -20 } })
    const end = h.gestures.find((g) => g.type === 'long-press-end')
    expect(end).toMatchObject({ point: { x: 90, y: -20 }, cancelled: false })
    // Le mouvement d'après l'appui long ne dessine pas et ne déplace pas la barre.
    expect(h.types()).not.toContain('drag')
    expect(h.types()).not.toContain('draft')
  })

  it('la visée commence dès le premier pixel, sans attendre le seuil de tap', () => {
    // Sinon la roue ne réagirait pas dans ses 14 premiers pixels, ce qui se lit comme un widget mort.
    const h = harness(null)
    h.down(300, 300)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.move(303, 301)

    expect(h.types()).toContain('long-press-move')
  })

  it('un appui long interrompu par le système est annoncé comme tel', () => {
    const h = harness(null)
    h.down(300, 300)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.cancel(300, 300)

    expect(h.gestures.find((g) => g.type === 'long-press-end')).toMatchObject({ cancelled: true })
  })

  it('sans appui long, aucun geste de visée n’est émis', () => {
    // Test de non-vol : les quatre gestes historiques gardent exactement leur séquence.
    const empty = harness(null)
    empty.down(100, 100)
    empty.move(140, 100)
    empty.up(140, 100)
    expect(empty.types()).toEqual(['draft', 'draft-cancel', 'create-bar'])

    const bar = harness(fakeHit())
    bar.down(50, 0)
    bar.up(50, 0)
    expect(bar.types()).toEqual(['grab', 'tap'])
  })

  it('un appui long sur une source n’émet rien : taper une source change déjà son rythme', () => {
    const h = harness({ target: 'emitter', emitter: { id: 1 } } as never)
    h.down(50, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    h.up(50, 0)

    expect(h.types()).not.toContain('long-press')
    expect(h.types()).toEqual(['grab', 'tap'])
  })
})
