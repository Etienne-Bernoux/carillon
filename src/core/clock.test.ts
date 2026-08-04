import { describe, expect, it } from 'vitest'

import {
  BEATS_PER_BAR,
  DEFAULT_BPM,
  DIVISIONS,
  MAX_BPM,
  MIN_BPM,
  barPosition,
  barSeconds,
  clampBpm,
  divisionAt,
  divisionLabel,
  divisionSeconds,
  divisionShortLabel,
  gridTimeAfter,
} from './clock'
import { labelWidthBudget } from './wheel'

describe('horloge — grille', () => {
  it('rend toujours un instant strictement postérieur', () => {
    for (const division of DIVISIONS) {
      for (const time of [0, 0.0001, 1, 1.5, 2.5, 7.31, 123.456]) {
        expect(gridTimeAfter(time, division, DEFAULT_BPM)).toBeGreaterThan(time)
      }
    }
  })

  it('rend un instant strictement postérieur même pile SUR un pas de grille', () => {
    // Le cas qui casse une boucle d'émission : si l'instant « suivant » vaut l'instant courant,
    // `while (nextAt <= time)` ne progresse jamais. Le flottant rend ce cas fréquent, pas rare.
    for (const division of DIVISIONS) {
      const step = divisionSeconds(division, DEFAULT_BPM)
      for (let k = 1; k <= 64; k += 1) {
        const onGrid = k * step
        expect(gridTimeAfter(onGrid, division, DEFAULT_BPM)).toBeGreaterThan(onGrid)
      }
    }
  })

  it('ne dérive pas après 10 000 pas en cascade', () => {
    const division = 1 / 3 // le pire cas : un pas non représentable en binaire
    const step = divisionSeconds(division, DEFAULT_BPM)
    let time = 0
    for (let i = 1; i <= 10_000; i += 1) {
      time = gridTimeAfter(time, division, DEFAULT_BPM)
      // l'écart au pas théorique doit rester une erreur de flottant, pas une dérive qui s'accumule
      expect(Math.abs(time - i * step)).toBeLessThan(1e-9)
    }
  })

  it('deux sources de même division restent en phase indéfiniment', () => {
    const division = 1 / 4
    // La source A part de 0, la source B d'un instant quelconque au milieu d'un pas : au bout d'un
    // pas, les deux doivent viser **exactement** le même instant. C'est ça, « en phase » — pas
    // « à peu près en phase », qui laisserait passer une dérive lente.
    let a = 0
    let b = 0.037
    for (let bar = 0; bar < 200; bar += 1) {
      for (let k = 0; k < 4; k += 1) {
        a = gridTimeAfter(a, division, DEFAULT_BPM)
        b = gridTimeAfter(b, division, DEFAULT_BPM)
      }
      expect(b).toBe(a)
    }
  })

  it('une division plus fine émet exactement autant de fois de plus', () => {
    const window = barSeconds(DEFAULT_BPM) * 8
    const count = (division: number) => {
      let time = 0
      let n = 0
      while ((time = gridTimeAfter(time, division, DEFAULT_BPM)) <= window) n += 1
      return n
    }
    expect(count(1)).toBe(8)
    expect(count(1 / 2)).toBe(16)
    expect(count(1 / 4)).toBe(32)
    expect(count(1 / 3)).toBe(24)
    expect(count(1 / 8)).toBe(64)
  })
})

describe('horloge — tempo', () => {
  it('une mesure vaut quatre temps du tempo', () => {
    expect(barSeconds(120)).toBeCloseTo((60 / 120) * BEATS_PER_BAR, 10)
    expect(barSeconds(60)).toBeCloseTo(4, 10)
  })

  it('le tempo est borné, et une valeur absurde retombe sur le défaut', () => {
    expect(clampBpm(1)).toBe(MIN_BPM)
    expect(clampBpm(10_000)).toBe(MAX_BPM)
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_BPM)
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BPM)
  })

  it('doubler le tempo double le nombre d’émissions sur une même fenêtre', () => {
    const emissions = (bpm: number) => {
      let time = 0
      let n = 0
      while ((time = gridTimeAfter(time, 1 / 2, bpm)) <= 10) n += 1
      return n
    }
    // Le critère G7 : le débit suit le tempo, sans rafale ni silence au changement.
    const slow = emissions(60)
    const fast = emissions(120)
    expect(fast).toBe(slow * 2)
  })

  it('changer de tempo au milieu ne produit ni rafale ni trou', () => {
    // On avance à 60 BPM jusqu'à 5 s, puis on passe à 120 : l'instant suivant doit rester devant
    // nous et sur la nouvelle grille. Une échéance stockée (`nextAt`) aurait ici soit tiré une
    // rafale (échéance dans le passé), soit gelé la source (échéance trop loin).
    let time = 0
    while (time < 5) time = gridTimeAfter(time, 1 / 2, 60)
    const after = gridTimeAfter(time, 1 / 2, 120)
    expect(after).toBeGreaterThan(time)
    const step = divisionSeconds(1 / 2, 120)
    expect(Math.abs(after / step - Math.round(after / step))).toBeLessThan(1e-9)
    expect(after - time).toBeLessThanOrEqual(step + 1e-9)
  })
})

describe('horloge — divisions et mesures', () => {
  it('l’ordre des divisions est figé (il voyage dans les liens de partage)', () => {
    expect(DIVISIONS).toEqual([1, 1 / 2, 1 / 3, 1 / 4, 1 / 8])
  })

  it('un index de division hors catalogue retombe sur le défaut, sans lever', () => {
    expect(divisionAt(-1)).toBe(1 / 2)
    expect(divisionAt(99)).toBe(1 / 2)
    expect(divisionAt(0)).toBe(1)
  })

  it('la position dans la mesure repart de zéro à chaque mesure', () => {
    const length = barSeconds(DEFAULT_BPM)
    expect(barPosition(0, DEFAULT_BPM)).toEqual({ bar: 0, phase: 0 })
    const mid = barPosition(length * 2.5, DEFAULT_BPM)
    expect(mid.bar).toBe(2)
    expect(mid.phase).toBeCloseTo(0.5, 9)
    const next = barPosition(length * 3, DEFAULT_BPM)
    expect(next.bar).toBe(3)
    expect(next.phase).toBeCloseTo(0, 9)
  })
})

describe('noms courts des divisions', () => {
  it('comptent les émissions par mesure, dérivées du catalogue', () => {
    // Dérivé et non recopié : ajouter une division produit son nom court sans y penser, et une division
    // dont le nom mentirait sur son débit fait rougir ce test.
    DIVISIONS.forEach((division, index) => {
      expect(divisionShortLabel(index)).toBe(`${Math.round(1 / division)}×`)
    })
  })

  it('sont distincts, et tous plus courts que leur phrase', () => {
    const shorts = DIVISIONS.map((_, index) => divisionShortLabel(index))
    expect(new Set(shorts).size).toBe(DIVISIONS.length)
    // Un nom court qui n'est pas plus court ne sert à rien.
    shorts.forEach((short, index) => {
      expect(short.length).toBeLessThan(divisionLabel(index).length)
    })
  })

  it('tiennent dans le budget d’une roue à cinq secteurs', () => {
    /*
     * C'est la raison d'être de ces noms : les phrases ne tenaient pas et la roue affichait cinq fois le
     * même repli.
     *
     * La borne par caractère est **10 px**, et c'en est vraiment une : mesurés dans la page en
     * `700 14px` — la police du secteur visé, la plus large — les caractères que `divisionShortLabel`
     * peut produire valent au pire 9,56 px (`8`), puis 9,47 (`4`), 9,43 (`0`), 9,42 (`9`), 9,25 (`×`).
     * J'avais écrit 9 en le présentant comme majorant : c'était la **moyenne** par caractère du libellé
     * le plus étroit (« 1× », 16,26 px pour deux signes), donc une borne dérivée du meilleur cas. À dix
     * divisions, « 48× » aurait passé le test à 27 px pour 28,28 px réels, dans un budget de 28,17.
     */
    const WIDEST_CHAR_PX = 10
    const budget = labelWidthBudget(DIVISIONS.length)
    DIVISIONS.forEach((_, index) => {
      expect(divisionShortLabel(index).length * WIDEST_CHAR_PX).toBeLessThan(budget)
    })
  })
})
