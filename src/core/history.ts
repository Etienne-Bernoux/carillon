/**
 * Historique annulable de la scène (US3, C4/C5). On stocke des instantanés complets de la liste
 * de barres — pas un journal de commandes inversibles : quelques dizaines de barres, une pile
 * bornée, c'est négligeable en mémoire et bien plus simple à rendre correct.
 *
 * Les billes ne font jamais partie de l'historique : elles sont éphémères.
 */

import type { Bar, Emitter, Vec2 } from './types'

/** Nombre d'états annulables conservés par défaut. */
export const DEFAULT_HISTORY_LIMIT = 40

export interface HistoryOptions {
  limit: number
}

/**
 * Un état annulable. La gamme en fait partie : sans elle, annuler un changement de gamme
 * réaccordait les barres mais laissait l'interface annoncer l'ancienne — l'instrument jouait une
 * gamme et l'écran en affichait une autre.
 */
export interface Snapshot {
  bars: Bar[]
  emitters: Emitter[]
  tuningId: string
}

export interface History {
  /** Enregistre l'état courant AVANT une modification. */
  push(bars: readonly Bar[], emitters: readonly Emitter[], tuningId: string): void
  /** Retourne l'état à restaurer, ou null si rien à annuler. Retire l'entrée de la pile. */
  undo(): Snapshot | null
  /** Nombre d'états annulables disponibles. */
  depth(): number
  clear(): void
}

function cloneVec2(v: Vec2): Vec2 {
  return { x: v.x, y: v.y }
}

// Copie manuelle plutôt que structuredClone : Bar est un objet plat sans cycle ni type spécial
// (Map, Date...), donc la copie champ à champ évite le coût de sérialisation générique de
// structuredClone pour un gain nul de correction ici.
//
// `lastHitAt` est délibérément **exclu** : c'est l'horodatage du dernier impact, donc de l'état de
// rendu transitoire, pas de l'état d'édition. L'inclure avait deux conséquences fâcheuses — la
// déduplication ne se déclenchait jamais dans une scène vivante (une bille qui rebondit suffit à
// « changer » la scène), et annuler faisait reculer une lueur.
function cloneBar(bar: Bar): Bar {
  return {
    id: bar.id,
    a: cloneVec2(bar.a),
    b: cloneVec2(bar.b),
    restitution: bar.restitution,
    midi: bar.midi,
    lastHitAt: -1,
  }
}

function cloneBars(bars: readonly Bar[]): Bar[] {
  return bars.map(cloneBar)
}

/**
 * `nextAt` est exclu, exactement comme `lastHitAt` pour une barre : c'est une échéance qui avance
 * toute seule, pas de l'état d'édition. La recopier faisait restaurer une échéance **dans le passé**,
 * et la source rattrapait son retard par une rafale de billes en une frame, en perdant la phase du
 * motif. C'est `undo` qui réarme, à partir du temps courant.
 */
function cloneEmitter(emitter: Emitter): Emitter {
  return {
    id: emitter.id,
    pos: cloneVec2(emitter.pos),
    period: emitter.period,
    nextAt: 0,
    hue: emitter.hue,
  }
}

function emittersEqual(a: readonly Emitter[], b: readonly Emitter[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const first = a[i]
    const second = b[i]
    // `nextAt` est exclu : c'est une échéance qui avance toute seule, comme `lastHitAt` pour une
    // barre. L'inclure désactiverait la déduplication dès qu'une source tourne.
    if (!first || !second) return false
    if (first.id !== second.id || first.period !== second.period || !vecEqual(first.pos, second.pos)) {
      return false
    }
  }
  return true
}

function vecEqual(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

function barEqual(a: Bar, b: Bar): boolean {
  // Pas de `lastHitAt` ici : cf. cloneBar.
  return (
    a.id === b.id &&
    a.restitution === b.restitution &&
    a.midi === b.midi &&
    vecEqual(a.a, b.a) &&
    vecEqual(a.b, b.b)
  )
}

function barsEqual(a: readonly Bar[], b: readonly Bar[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const barA = a[i]
    const barB = b[i]
    if (!barA || !barB || !barEqual(barA, barB)) return false
  }
  return true
}

// Une limite <= 0 viderait la pile à chaque push (plus aucun undo possible) : on borne à 1 plutôt
// que de laisser l'appelant désactiver silencieusement l'historique.
function normalizeLimit(limit: number): number {
  return Math.max(1, limit)
}

export function createHistory(options?: Partial<HistoryOptions>): History {
  const limit = normalizeLimit(options?.limit ?? DEFAULT_HISTORY_LIMIT)
  const stack: Snapshot[] = []

  return {
    push(bars: readonly Bar[], emitters: readonly Emitter[], tuningId: string): void {
      const snapshot: Snapshot = {
        bars: cloneBars(bars),
        emitters: emitters.map(cloneEmitter),
        tuningId,
      }
      const top = stack[stack.length - 1]
      // Déduplication : un geste qui ne change rien (attraper puis relâcher au même endroit, ou
      // taper une barre pour l'entendre) ne doit pas consommer une place d'annulation.
      if (
        top &&
        top.tuningId === snapshot.tuningId &&
        barsEqual(top.bars, snapshot.bars) &&
        emittersEqual(top.emitters, snapshot.emitters)
      ) {
        return
      }
      stack.push(snapshot)
      if (stack.length > limit) stack.shift()
    },
    undo(): Snapshot | null {
      return stack.pop() ?? null
    },
    depth(): number {
      return stack.length
    },
    clear(): void {
      stack.length = 0
    },
  }
}
