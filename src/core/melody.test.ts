import { describe, expect, it } from 'vitest'

import {
  MELODIES,
  MIN_NOTE_SECONDS,
  composeMelody,
  lengthForMidi,
  playedMidis,
  tuningForMelody,
} from './melody'
import { midiForLength } from './music'
import type { Bounds } from './types'

const DESKTOP: Bounds = { w: 1280, h: 800 }

describe('catalogue d’airs', () => {
  it('chaque air a un nom, des degrés et autant de durées que de notes', () => {
    expect(MELODIES.length).toBeGreaterThan(0)
    for (const melody of MELODIES) {
      expect(melody.label.length).toBeGreaterThan(2)
      expect(melody.degrees.length).toBe(melody.beats.length)
      expect(melody.degrees.length).toBeGreaterThanOrEqual(4)
      expect(melody.degrees.length).toBeLessThanOrEqual(8)
    }
  })

  it('AE5 — chaque air trouve une gamme qui **contient** ses notes', () => {
    // Sans cela, une note tomberait sur le degré le plus proche : ce serait déformer l'air, pas le
    // transposer. C'est la différence entre « Ode à la joie » et quelque chose qui y ressemble.
    for (const melody of MELODIES) {
      const tuning = tuningForMelody(melody)
      expect(tuning, melody.label).not.toBeNull()
      for (const degree of melody.degrees) {
        expect(tuning!.scale, `${melody.label} degré ${degree}`).toContain(degree % 12)
      }
    }
  })
})

describe('inverser la géométrie vers la hauteur', () => {
  it('la longueur rendue produit bien la hauteur demandée', () => {
    const tuning = tuningForMelody(MELODIES[0]!)!
    for (const degree of [0, 2, 4, 7, 9]) {
      const midi = tuning.rootMidi + 12 + degree
      const length = lengthForMidi(midi, tuning, DESKTOP.w)
      if (length === null) continue
      expect(midiForLength(length, tuning, DESKTOP.w)).toBe(midi)
    }
  })

  it('une hauteur hors d’atteinte rend null plutôt que la plus proche', () => {
    const tuning = tuningForMelody(MELODIES[0]!)!
    expect(lengthForMidi(tuning.rootMidi - 60, tuning, DESKTOP.w)).toBeNull()
    expect(lengthForMidi(tuning.rootMidi + 200, tuning, DESKTOP.w)).toBeNull()
  })
})

describe('composer une scène qui joue l’air', () => {
  it('AE1 — la scène composée joue exactement l’incipit, dans l’ordre', { timeout: 40_000 }, () => {
    /*
     * Le contrat de ce module. Il n'est vérifiable que parce que le pas de simulation est déterministe :
     * on rejoue la scène depuis zéro et on compare la suite de hauteurs.
     */
    let composed = 0
    for (let seed = 1; seed <= 12; seed += 1) {
      const scene = composeMelody({ bounds: DESKTOP, seed })
      if (!scene) continue
      composed += 1
      const root = tuningForMelody(scene.melody)!.rootMidi
      const wanted = scene.melody.degrees.map((degree) => root + 12 + degree)
      const played = playedMidis(scene, DESKTOP)
      expect(played.slice(0, wanted.length), `graine ${seed} — ${scene.melody.label}`).toEqual(wanted)
    }
    expect(composed).toBeGreaterThan(0)
  })

  it('AE2 — aucun intervalle de l’incipit ne fond deux notes en une', { timeout: 40_000 }, () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const scene = composeMelody({ bounds: DESKTOP, seed })
      if (!scene) continue
      for (const gap of scene.gaps) {
        expect(gap, `graine ${seed}`).toBeGreaterThanOrEqual(MIN_NOTE_SECONDS)
      }
    }
  })

  it('AE3 — même graine, même scène', { timeout: 40_000 }, () => {
    const first = composeMelody({ bounds: DESKTOP, seed: 7 })
    const second = composeMelody({ bounds: DESKTOP, seed: 7 })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('AE4 — sans budget, rien n’est composé et rien ne lève', { timeout: 40_000 }, () => {
    // C'est le chemin de repli : l'appelant produit alors la scène ordinaire.
    expect(composeMelody({ bounds: DESKTOP, seed: 1, attempts: 0 })).toBeNull()
  })

  it('toutes les barres tiennent dans l’aire de jeu', { timeout: 40_000 }, () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const scene = composeMelody({ bounds: DESKTOP, seed })
      if (!scene) continue
      for (const bar of scene.bars) {
        for (const point of [bar.a, bar.b]) {
          expect(point.x).toBeGreaterThan(0)
          expect(point.x).toBeLessThan(DESKTOP.w)
          expect(point.y).toBeGreaterThan(0)
          expect(point.y).toBeLessThan(DESKTOP.h)
        }
      }
    }
  })

  it('un air demandé nommément est bien celui qui est composé', { timeout: 40_000 }, () => {
    for (const melody of MELODIES) {
      const scene = composeMelody({ bounds: DESKTOP, seed: 3, melodyId: melody.id, attempts: 40 })
      if (!scene) continue
      expect(scene.melody.id).toBe(melody.id)
    }
  })

  it('SC1 — la recherche converge sur au moins la moitié des graines', { timeout: 40_000 }, () => {
    // Critère de succès du plan. Mesuré ici pour qu'une régression de la recherche soit visible.
    let ok = 0
    const total = 16
    for (let seed = 1; seed <= total; seed += 1) {
      if (composeMelody({ bounds: DESKTOP, seed })) ok += 1
    }
    console.log(`  [mélodie] convergence : ${ok}/${total} graines`)
    expect(ok / total).toBeGreaterThanOrEqual(0.5)
  })
})
