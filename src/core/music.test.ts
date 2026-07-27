import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TUNING,
  MIN_IMPACT_SPEED,
  TUNINGS,
  gainForImpact,
  midiForLength,
  midiToFreq,
  panForX,
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
  const lengths = Array.from({ length: 661 }, (_, i) => 40 + i) // 40..700 px

  for (const tuning of TUNINGS) {
    it(`est monotone décroissant pour ${tuning.id}`, () => {
      const midis = lengths.map((len) => midiForLength(len, tuning))
      for (let i = 1; i < midis.length; i += 1) {
        expect(midis[i]!).toBeLessThanOrEqual(midis[i - 1]!)
      }
    })

    it(`plafonne aux bornes pour ${tuning.id}`, () => {
      const short = midiForLength(10, tuning)
      const atMin = midiForLength(40, tuning)
      const long = midiForLength(5000, tuning)
      const atMax = midiForLength(700, tuning)
      expect(short).toBe(atMin)
      expect(long).toBe(atMax)
    })

    it(`couvre tous les degrés de la gamme sur la plage utile pour ${tuning.id}`, () => {
      const midis = new Set(lengths.map((len) => midiForLength(len, tuning)))
      const expectedDegreeCount = tuning.scale.length * 3 // ~3 octaves
      expect(midis.size).toBe(expectedDegreeCount)
    })

    it(`ne retourne que des entiers pour ${tuning.id}`, () => {
      for (const len of [40, 123.4, 400, 699.9, 700]) {
        expect(Number.isInteger(midiForLength(len, tuning))).toBe(true)
      }
    })
  }
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
