import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BUDGET, VoiceBudget } from './budget'

describe('VoiceBudget', () => {
  let budget: VoiceBudget

  beforeEach(() => {
    budget = new VoiceBudget()
  })

  it('DEFAULT_BUDGET vaut 24 voix / 25 ms de retrigger', () => {
    expect(DEFAULT_BUDGET).toEqual({ maxVoices: 24, retriggerMs: 25 })
  })

  it('accepte jusqu’à maxVoices voix simultanées puis refuse la suivante', () => {
    for (let i = 0; i < 24; i += 1) {
      const accepted = budget.claim(1000 + i, 0, 1000)
      expect(accepted).toBe(true)
    }
    const twentyFifth = budget.claim(2000, 0, 1000)
    expect(twentyFifth).toBe(false)
  })

  it('une voix expirée libère sa place', () => {
    for (let i = 0; i < 24; i += 1) {
      budget.claim(1000 + i, 0, 100) // durée courte : expirent à t=100
    }
    expect(budget.claim(9999, 50, 100)).toBe(false) // toutes encore actives à t=50

    expect(budget.claim(9999, 150, 100)).toBe(true) // toutes expirées à t=150
  })

  it('refuse le retrigger de la même barre dans la fenêtre puis l’accepte après', () => {
    expect(budget.claim(42, 0, 500)).toBe(true)
    expect(budget.claim(42, 10, 500)).toBe(false) // 10ms < retriggerMs=25
    expect(budget.claim(42, 24, 500)).toBe(false) // encore dans la fenêtre
    expect(budget.claim(42, 25, 500)).toBe(true) // fenêtre écoulée
  })

  it('deux barres différentes au même instant sont toutes deux acceptées', () => {
    expect(budget.claim(1, 100, 500)).toBe(true)
    expect(budget.claim(2, 100, 500)).toBe(true)
  })

  it('reset() remet les compteurs à zéro', () => {
    for (let i = 0; i < 24; i += 1) {
      budget.claim(1000 + i, 0, 1000)
    }
    expect(budget.claim(2000, 0, 1000)).toBe(false)

    budget.reset()

    expect(budget.claim(2000, 0, 1000)).toBe(true)
    expect(budget.claim(42, 0, 500)).toBe(true) // retrigger aussi remis à zéro
  })

  it('activeVoices compte les voix encore actives et exclut les expirées', () => {
    budget.claim(1, 0, 100)
    budget.claim(2, 0, 100)
    expect(budget.activeVoices(50)).toBe(2)
    expect(budget.activeVoices(150)).toBe(0)
  })

  it('respecte des options personnalisées', () => {
    const small = new VoiceBudget({ maxVoices: 2, retriggerMs: 5 })
    expect(small.claim(1, 0, 1000)).toBe(true)
    expect(small.claim(2, 0, 1000)).toBe(true)
    expect(small.claim(3, 0, 1000)).toBe(false)
  })
})
