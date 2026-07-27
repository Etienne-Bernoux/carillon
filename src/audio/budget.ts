/**
 * Politique de polyphonie : protège l'oreille (pas de spam sur une même barre) et le CPU
 * (pas plus de N voix simultanées). Pur et testable — tout est calculé à partir de `nowMs`
 * fourni par l'appelant, pas de callback ni d'horloge interne.
 */

export interface BudgetOptions {
  maxVoices: number
  retriggerMs: number
}

export const DEFAULT_BUDGET: BudgetOptions = {
  maxVoices: 24,
  retriggerMs: 25,
}

interface Voice {
  barId: number
  startedAt: number
  endsAt: number
}

export class VoiceBudget {
  private readonly options: BudgetOptions
  private voices: Voice[] = []
  private lastTriggerByBar = new Map<number, number>()

  constructor(options?: Partial<BudgetOptions>) {
    this.options = { ...DEFAULT_BUDGET, ...options }
  }

  claim(barId: number, nowMs: number, durationMs: number): boolean {
    this.expireVoices(nowMs)

    const lastTrigger = this.lastTriggerByBar.get(barId)
    if (lastTrigger !== undefined && nowMs - lastTrigger < this.options.retriggerMs) {
      return false
    }

    if (this.voices.length >= this.options.maxVoices) {
      return false
    }

    this.voices.push({ barId, startedAt: nowMs, endsAt: nowMs + durationMs })
    this.lastTriggerByBar.set(barId, nowMs)
    return true
  }

  activeVoices(nowMs: number): number {
    this.expireVoices(nowMs)
    return this.voices.length
  }

  reset(): void {
    this.voices = []
    this.lastTriggerByBar.clear()
  }

  private expireVoices(nowMs: number): void {
    this.voices = this.voices.filter((voice) => voice.endsAt > nowMs)
  }
}
