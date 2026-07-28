import { describe, expect, it } from 'vitest'
import { DEFAULT_HISTORY_LIMIT, createHistory } from './history'
import type { Bar } from './types'

const TUNING = 'pentatonic-minor'

function makeBar(id: number, midi: number, ax = 0, ay = 0, bx = 100, by = 0): Bar {
  return {
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    restitution: 0.8,
    midi,
    lastHitAt: -1,
  }
}

function expectSameBar(actual: Bar | undefined, expected: Bar): void {
  expect(actual).toBeDefined()
  expect(actual?.a).toEqual(expected.a)
  expect(actual?.b).toEqual(expected.b)
  expect(actual?.midi).toEqual(expected.midi)
}

describe('createHistory — C4 : 20 gestes enchaînés', () => {
  it('restaure les 20 états intermédiaires, dans l’ordre inverse', () => {
    const history = createHistory()
    let bars: Bar[] = Array.from({ length: 20 }, (_, i) => makeBar(i, 60 + i))
    const expectedUndos: Bar[][] = []

    for (let step = 0; step < 20; step++) {
      history.push(bars, [], TUNING)
      // L'instantané attendu après cet undo est l'état juste avant la modification.
      expectedUndos.unshift(bars.map((bar) => ({ ...bar, a: { ...bar.a }, b: { ...bar.b } })))
      bars = bars.map((bar, i) => (i === step ? { ...bar, midi: bar.midi + 12, b: { x: bar.b.x + 5, y: bar.b.y } } : bar))
    }

    expect(history.depth()).toBe(20)

    for (const expected of expectedUndos) {
      const restored = history.undo()?.bars ?? null
      expect(restored).not.toBeNull()
      expect(restored).toHaveLength(20)
      for (let i = 0; i < 20; i++) {
        expectSameBar(restored?.[i], expected[i] as Bar)
      }
    }

    expect(history.depth()).toBe(0)
    expect(history.undo()?.bars ?? null).toBeNull()
  })
})

describe('createHistory — isolation (copie profonde)', () => {
  it('muter la barre du monde après push ne change pas l’instantané', () => {
    const history = createHistory()
    const bar = makeBar(1, 60)
    const bars = [bar]

    history.push(bars, [], TUNING)
    bar.midi = 999
    bar.a.x = 12345

    const restored = history.undo()?.bars ?? null
    expect(restored).not.toBeNull()
    expect(restored?.[0]?.midi).toBe(60)
    expect(restored?.[0]?.a.x).toBe(0)
  })

  it('muter le résultat d’un undo ne change pas ce qui reste dans la pile', () => {
    const history = createHistory()
    history.push([makeBar(1, 60)], [], TUNING)
    history.push([makeBar(1, 62)], [], TUNING)

    const first = history.undo()?.bars ?? null
    expect(first).not.toBeNull()
    if (first) {
      const b = first[0]
      if (b) {
        b.midi = 111
        b.a.x = 999
      }
    }

    const second = history.undo()?.bars ?? null
    expect(second).not.toBeNull()
    expect(second?.[0]?.midi).toBe(60)
    expect(second?.[0]?.a.x).toBe(0)
  })
})

describe('createHistory — C5 : pile bornée', () => {
  it('pousser limit + 10 états laisse depth() === limit, et garde les plus récents', () => {
    const limit = 5
    const history = createHistory({ limit })

    for (let i = 0; i < limit + 10; i++) {
      history.push([makeBar(1, 60 + i)], [], TUNING)
    }

    expect(history.depth()).toBe(limit)

    // Les push valaient midi = 60..74 (15 pushes). Après troncature à 5, il reste les 5 plus
    // récents : 70, 71, 72, 73, 74. Le plus ancien récupérable (premier undo) est le dernier
    // poussé, 74 ; le dernier récupérable (5e undo) est le plus ancien conservé, 70.
    const expectedMidiDescending = [74, 73, 72, 71, 70]
    for (const expectedMidi of expectedMidiDescending) {
      const restored = history.undo()?.bars ?? null
      expect(restored?.[0]?.midi).toBe(expectedMidi)
    }
    expect(history.undo()?.bars ?? null).toBeNull()
  })

  it('undo() sur une pile vide retourne null sans jeter', () => {
    const history = createHistory()
    expect(() => history.undo()?.bars ?? null).not.toThrow()
    expect(history.undo()?.bars ?? null).toBeNull()
  })

  it('limit est borné à 1 même si on passe 0 ou un nombre négatif', () => {
    const zero = createHistory({ limit: 0 })
    zero.push([makeBar(1, 60)], [], TUNING)
    zero.push([makeBar(1, 61)], [], TUNING)
    expect(zero.depth()).toBe(1)

    const negative = createHistory({ limit: -10 })
    negative.push([makeBar(1, 60)], [], TUNING)
    negative.push([makeBar(1, 61)], [], TUNING)
    expect(negative.depth()).toBe(1)
  })

  it('sans options, la limite par défaut est DEFAULT_HISTORY_LIMIT', () => {
    const history = createHistory()
    for (let i = 0; i < DEFAULT_HISTORY_LIMIT + 3; i++) {
      history.push([makeBar(1, 60 + i)], [], TUNING)
    }
    expect(history.depth()).toBe(DEFAULT_HISTORY_LIMIT)
  })
})

describe('createHistory — déduplication', () => {
  it('deux push consécutifs d’états identiques ne créent qu’une entrée', () => {
    const history = createHistory()
    history.push([makeBar(1, 60)], [], TUNING)
    history.push([makeBar(1, 60)], [], TUNING)
    expect(history.depth()).toBe(1)
  })

  it('un push d’un état réellement différent en crée une deuxième', () => {
    const history = createHistory()
    history.push([makeBar(1, 60)], [], TUNING)
    history.push([makeBar(1, 62)], [], TUNING)
    expect(history.depth()).toBe(2)
  })

  it('la déduplication ne compare que les valeurs, pas les références', () => {
    const history = createHistory()
    const first = [makeBar(1, 60, 10, 20, 110, 20)]
    history.push(first, [], TUNING)
    // Objet différent en mémoire mais valeurs identiques : doit toujours dédupliquer.
    const second = [makeBar(1, 60, 10, 20, 110, 20)]
    history.push(second, [], TUNING)
    expect(history.depth()).toBe(1)
  })
})

describe('createHistory — clear', () => {
  it('remet la pile à zéro', () => {
    const history = createHistory()
    history.push([makeBar(1, 60)], [], TUNING)
    history.push([makeBar(1, 62)], [], TUNING)
    expect(history.depth()).toBe(2)

    history.clear()
    expect(history.depth()).toBe(0)
    expect(history.undo()?.bars ?? null).toBeNull()
  })
})

describe('déduplication et gamme — régressions de la revue US3', () => {
  function bar(lastHitAt: number): Bar {
    return {
      id: 1,
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      restitution: 0.8,
      midi: 60,
      lastHitAt,
    }
  }

  it('déduplique alors que `lastHitAt` a changé — le seul champ qui bouge en production', () => {
    // C'est ce cas qui manquait : tous les tests de dédup utilisaient lastHitAt: -1, donc la dédup
    // paraissait fonctionner alors qu'une bille qui rebondit suffisait à la désactiver. Conséquence
    // réelle : taper une barre pour l'écouter consommait une place d'annulation, et 40 taps
    // évinçaient l'instantané d'une vraie suppression.
    const history = createHistory()
    history.push([bar(-1)], [], TUNING)
    history.push([bar(12.5)], [], TUNING)
    history.push([bar(31.75)], [], TUNING)
    expect(history.depth()).toBe(1)
  })

  it('ne déduplique pas quand la gamme change, même à barres identiques', () => {
    const history = createHistory()
    history.push([bar(-1)], [], 'pentatonic-minor')
    history.push([bar(-1)], [], 'dorian')
    expect(history.depth()).toBe(2)
  })

  it('restitue la gamme d’avant le geste', () => {
    const history = createHistory()
    history.push([bar(-1)], [], 'hirajoshi')
    expect(history.undo()?.tuningId).toBe('hirajoshi')
  })

  it('n’expose jamais un `lastHitAt` restauré : c’est de l’état de rendu, pas d’édition', () => {
    const history = createHistory()
    history.push([bar(42)], [], TUNING)
    expect(history.undo()?.bars[0]?.lastHitAt).toBe(-1)
  })
})
