import { describe, expect, it } from 'vitest'
import type { Bar } from './types'
import {
  DEFAULT_TUNING,
  MAX_LENGTH_RATIO,
  MIN_IMPACT_SPEED,
  MIN_LENGTH_RATIO,
  TUNINGS,
  gainForImpact,
  midiForLength,
  midiToFreq,
  panForX,
  retuneBars,
  tuningById,
} from './music'

describe('TUNINGS', () => {
  it('propose au moins 5 gammes', () => {
    expect(TUNINGS.length).toBeGreaterThanOrEqual(5)
  })

  it('DEFAULT_TUNING fait partie de TUNINGS', () => {
    expect(TUNINGS).toContain(DEFAULT_TUNING)
  })
})

describe('midiForLength', () => {
  /** Largeur de référence : les bornes relatives y valent 38,4 → 704 px, la plage historique. */
  const DESKTOP = 1280
  // Bornes lues depuis les constantes exportées, pas re-codées en littéraux : sinon changer un ratio
  // de conception laissait tous les tests verts, les deux côtés saturant de façon cohérente.
  const MIN = DESKTOP * MIN_LENGTH_RATIO
  const MAX = DESKTOP * MAX_LENGTH_RATIO
  const lengths = Array.from({ length: Math.round(MAX - MIN) + 1 }, (_, i) => MIN + i)

  for (const tuning of TUNINGS) {
    it(`est monotone décroissant pour ${tuning.id}`, () => {
      const midis = lengths.map((len) => midiForLength(len, tuning, DESKTOP))
      for (let i = 1; i < midis.length; i += 1) {
        expect(midis[i]!).toBeLessThanOrEqual(midis[i - 1]!)
      }
    })

    it(`plafonne aux bornes pour ${tuning.id}`, () => {
      expect(midiForLength(1, tuning, DESKTOP)).toBe(midiForLength(MIN, tuning, DESKTOP))
      expect(midiForLength(50_000, tuning, DESKTOP)).toBe(midiForLength(MAX, tuning, DESKTOP))
    })

    it(`couvre tous les degrés de la gamme sur la plage utile pour ${tuning.id}`, () => {
      const midis = new Set(lengths.map((len) => midiForLength(len, tuning, DESKTOP)))
      expect(midis.size).toBe(tuning.scale.length * 3) // ~3 octaves
    })

    it(`ne retourne que des entiers pour ${tuning.id}`, () => {
      for (const len of [MIN, 123.4, 400, 703.9, MAX]) {
        expect(Number.isInteger(midiForLength(len, tuning, DESKTOP))).toBe(true)
      }
    })
  }

  it('B2 — est invariant d’échelle : même ratio longueur/largeur, même hauteur', () => {
    // C'est tout l'objet de l'US2 : en pixels absolus, un téléphone ne jouait que deux hauteurs.
    for (const tuning of TUNINGS) {
      for (const ratio of [0.04, 0.08, 0.15, 0.25, 0.35, 0.45, 0.54]) {
        const reference = midiForLength(1280 * ratio, tuning, 1280)
        for (const width of [320, 375, 768, 1920, 3840]) {
          expect(midiForLength(width * ratio, tuning, width)).toBe(reference)
        }
      }
    }
  })

  it('reste défini si la largeur de scène est absurde', () => {
    for (const width of [0, -100, Number.NaN]) {
      expect(Number.isFinite(midiForLength(120, DEFAULT_TUNING, width))).toBe(true)
    }
  })
})

describe('midiToFreq', () => {
  it('midiToFreq(69) === 440 (la du milieu)', () => {
    expect(midiToFreq(69)).toBe(440)
  })

  it('une octave au-dessus double la fréquence', () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 5)
  })
})

describe('gainForImpact', () => {
  it('retourne 0 sous le seuil MIN_IMPACT_SPEED', () => {
    expect(gainForImpact(0)).toBe(0)
    expect(gainForImpact(MIN_IMPACT_SPEED - 1)).toBe(0)
  })

  it('est monotone croissante au-dessus du seuil', () => {
    const speeds = [MIN_IMPACT_SPEED, 100, 300, 600, 1000, 1500, 2000, 2500, 3000]
    const gains = speeds.map(gainForImpact)
    for (let i = 1; i < gains.length; i += 1) {
      expect(gains[i]!).toBeGreaterThanOrEqual(gains[i - 1]!)
    }
  })

  it('plafonne à 1 vers 2500 px/s et au-delà', () => {
    expect(gainForImpact(2500)).toBeCloseTo(1, 5)
    expect(gainForImpact(4000)).toBe(1)
  })

  it('a une courbe concave (sqrt) : le gain croît plus vite au début', () => {
    const low = gainForImpact(MIN_IMPACT_SPEED + 100) - gainForImpact(MIN_IMPACT_SPEED)
    const high = gainForImpact(2500) - gainForImpact(2400)
    expect(low).toBeGreaterThan(high)
  })
})

describe('panForX', () => {
  it('est centré (x au milieu de la largeur → pan 0)', () => {
    expect(panForX(400, 800)).toBe(0)
  })

  it('est borné à -0.8..0.8', () => {
    expect(panForX(0, 800)).toBeCloseTo(-0.8, 5)
    expect(panForX(800, 800)).toBeCloseTo(0.8, 5)
    expect(panForX(-1000, 800)).toBeGreaterThanOrEqual(-0.8)
    expect(panForX(10000, 800)).toBeLessThanOrEqual(0.8)
  })

  it('gère une largeur nulle sans jeter', () => {
    expect(panForX(50, 0)).toBe(0)
  })
})

describe('B5 — retuneBars', () => {
  function bars(): Bar[] {
    return [
      { id: 0, a: { x: 0, y: 0 }, b: { x: 60, y: 0 }, restitution: 0.8, midi: 0, lastHitAt: -1 },
      { id: 1, a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, restitution: 0.8, midi: 0, lastHitAt: -1 },
      { id: 2, a: { x: 10, y: 10 }, b: { x: 10, y: 610 }, restitution: 0.8, midi: 0, lastHitAt: -1 },
    ]
  }

  it('réaccorde toutes les barres sans en déplacer aucune', () => {
    const list = bars()
    const before = structuredClone(list)
    retuneBars(list, DEFAULT_TUNING, 1280)

    for (const [index, bar] of list.entries()) {
      expect(bar.a).toEqual(before[index]!.a)
      expect(bar.b).toEqual(before[index]!.b)
    }

    // Hauteurs attendues **en dur**, dérivées à la main. Les recalculer avec `midiForLength`
    // prouverait seulement que `retuneBars` appelle `midiForLength`, jamais que le résultat est
    // juste : les deux côtés de l'égalité dériveraient ensemble.
    //
    // Pentatonique mineure, tonique La3 (57), 3 octaves ⇒ degrés décroissants
    // [91, 88, 86, 84, 81, 79, 76, 74, 72, 69, 67, 64, 62, 60, 57]. À 1280 px de large, les bornes
    // valent 38,4 → 704 px, donc : 60 px → indice 0 (Si5) · 300 px → indice 6 (Mi5) ·
    // 600 px → indice 12 (Ré4).
    expect(list.map((bar) => bar.midi)).toEqual([91, 76, 62])
  })

  it('repart de la géométrie, donc ne dérive pas quand on réaccorde en boucle', () => {
    const list = bars()
    retuneBars(list, DEFAULT_TUNING, 1280)
    const stable = list.map((bar) => bar.midi)

    for (const tuning of TUNINGS) retuneBars(list, tuning, 1280)
    retuneBars(list, DEFAULT_TUNING, 1280)

    expect(list.map((bar) => bar.midi)).toEqual(stable)
  })

  it('change réellement les hauteurs quand la gamme change', () => {
    const list = bars()
    retuneBars(list, DEFAULT_TUNING, 1280)
    const pentatonic = list.map((bar) => bar.midi)

    const lydian = tuningById('lydian')
    retuneBars(list, lydian, 1280)

    expect(lydian.id).toBe('lydian')
    expect(list.map((bar) => bar.midi)).not.toEqual(pentatonic)
  })
})

describe('ordre figé du catalogue de gammes', () => {
  it('épingle l’ordre : son index voyage dans les liens partagés', () => {
    // Réordonner ou insérer une gamme en tête casserait **tous** les liens déjà émis, sans qu'aucun
    // autre test ne le voie (les autres bouclent sur le catalogue, donc sont insensibles à l'ordre).
    // Ajouter une gamme à la fin fait échouer ce test : c'est voulu, on met alors l'ajout ici aussi.
    expect(TUNINGS.map((tuning) => tuning.id)).toEqual([
      'pentatonic-minor',
      'pentatonic-major',
      'dorian',
      'hirajoshi',
      'lydian',
    ])
  })

  it('ne peut pas dépasser 64 gammes : l’index est encodé sur 6 bits', () => {
    expect(TUNINGS.length).toBeLessThanOrEqual(64)
  })
})
