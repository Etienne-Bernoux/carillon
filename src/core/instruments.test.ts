import { describe, expect, it } from 'vitest'

import {
  DEFAULT_INSTRUMENT,
  INSTRUMENTS,
  MAX_DECAY_SECONDS,
  MIN_DECAY_SECONDS,
  decayForNote,
  instrumentById,
  voiceForMidi,
} from './instruments'
import { midiToFreq } from './music'

describe('catalogue', () => {
  it('l’ordre est figé — l’index voyagera dans les liens de partage', () => {
    expect(INSTRUMENTS.map((instrument) => instrument.id)).toEqual([
      'carillon',
      'bois',
      'verre',
      'corde',
      // Ajoutées **en fin** : l'index voyage dans les liens depuis le format v2.
      'percussions',
    ])
  })

  it('tient sur 6 bits, comme les gammes', () => {
    expect(INSTRUMENTS.length).toBeLessThanOrEqual(64)
  })

  it('le carillon reste le défaut', () => {
    expect(DEFAULT_INSTRUMENT.id).toBe('carillon')
    expect(INSTRUMENTS[0]).toBe(DEFAULT_INSTRUMENT)
  })

  it('un identifiant inconnu retombe sur le défaut, sans lever', () => {
    expect(instrumentById('inexistant')).toBe(DEFAULT_INSTRUMENT)
    expect(instrumentById('')).toBe(DEFAULT_INSTRUMENT)
    expect(instrumentById('verre').id).toBe('verre')
  })

  it('chaque instrument a un nom et un nom court non vides et distincts', () => {
    const labels = INSTRUMENTS.map((i) => i.label)
    const shorts = INSTRUMENTS.map((i) => i.short)
    expect(new Set(labels).size).toBe(INSTRUMENTS.length)
    expect(new Set(shorts).size).toBe(INSTRUMENTS.length)
    expect(labels.every((l) => l.length > 2)).toBe(true)
    expect(shorts.every((s) => s.length > 2 && s.length <= 10)).toBe(true)
  })
})

describe('le timbre historique ne change pas', () => {
  /**
   * Formule d'avant l'US8, reproduite ici **volontairement en dur** : c'est un test doré. Si le
   * carillon change de son, ce test doit rougir — et non « le son a l'air pareil à l'oreille », que
   * personne ne vérifie deux mois plus tard.
   */
  function historicDecay(freq: number): number {
    const BASE_DECAY_SECONDS = 0.9
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
    return BASE_DECAY_SECONDS * clamp(880 / Math.max(freq, 1), 0.35, 1)
  }

  it('la décroissance du carillon est identique à l’ancienne formule, sur toute l’étendue', () => {
    const carillon = instrumentById('carillon')
    // Toute l'étendue jouable : la gamme part de A3 (57) et couvre ~3 octaves.
    for (let midi = 40; midi <= 108; midi += 1) {
      const freq = midiToFreq(midi)
      const voice = voiceForMidi(carillon, midi)
      expect(decayForNote(voice, freq)).toBeCloseTo(historicDecay(freq), 10)
    }
  })

  it('les deux voix du carillon sont identiques : son timbre ne dépend pas du registre', () => {
    const carillon = instrumentById('carillon')
    expect(carillon.low).toEqual(carillon.high)
  })
})

describe('un instrument combine deux voix', () => {
  it('la bascule se fait sur une hauteur réelle, pas sur une position', () => {
    for (const instrument of INSTRUMENTS) {
      const below = voiceForMidi(instrument, instrument.crossoverMidi - 1)
      const at = voiceForMidi(instrument, instrument.crossoverMidi)
      expect(below).toBe(instrument.low)
      expect(at).toBe(instrument.high)
    }
  })

  it('les instruments autres que le carillon ont deux voix réellement différentes', () => {
    for (const instrument of INSTRUMENTS.filter((i) => i.id !== 'carillon')) {
      expect(instrument.low).not.toEqual(instrument.high)
    }
  })

  it('chaque instrument a un caractère mesurable, pas seulement un nom', () => {
    const at = (id: string, midi: number) => {
      const instrument = instrumentById(id)
      return decayForNote(voiceForMidi(instrument, midi), midiToFreq(midi))
    }
    // Le bois est court, le verre tient : c'est ce qui les distingue à l'oreille, et c'est chiffrable.
    const midi = 72
    expect(at('bois', midi)).toBeLessThan(at('carillon', midi))
    expect(at('verre', midi)).toBeGreaterThan(at('carillon', midi))
    // Et le rapport est **audible**, pas marginal : au moins du simple au double entre bois et verre.
    expect(at('verre', midi) / at('bois', midi)).toBeGreaterThan(2)
  })
})

describe('bornes de durée', () => {
  it('une note n’est jamais inaudiblement courte ni interminable, sur tout le catalogue', () => {
    for (const instrument of INSTRUMENTS) {
      for (let midi = 24; midi <= 120; midi += 1) {
        const decay = decayForNote(voiceForMidi(instrument, midi), midiToFreq(midi))
        expect(decay).toBeGreaterThanOrEqual(MIN_DECAY_SECONDS)
        expect(decay).toBeLessThanOrEqual(MAX_DECAY_SECONDS)
      }
    }
  })

  it('la durée décroît quand la note monte, pour tout instrument', () => {
    for (const instrument of INSTRUMENTS) {
      // Comparaison **à voix constante** : entre les deux registres, l'instrument change de voix, donc
      // la durée peut légitimement remonter. C'est la monotonie de la formule qu'on teste ici.
      for (const voice of [instrument.low, instrument.high]) {
        let previous = Number.POSITIVE_INFINITY
        for (let midi = 40; midi <= 100; midi += 4) {
          const decay = decayForNote(voice, midiToFreq(midi))
          expect(decay).toBeLessThanOrEqual(previous + 1e-12)
          previous = decay
        }
      }
    }
  })

  it('une fréquence absurde ne casse rien', () => {
    const voice = DEFAULT_INSTRUMENT.low
    expect(Number.isFinite(decayForNote(voice, 0))).toBe(true)
    expect(Number.isFinite(decayForNote(voice, -100))).toBe(true)
    expect(Number.isFinite(decayForNote(voice, 1e9))).toBe(true)
  })
})

describe('les percussions gardent le mapping de la géométrie', () => {
  it('le registre décide du fût : grosse caisse en bas, cymbale en haut', () => {
    // Une percussion est non accordée, mais on ne renonce pas au mapping : c'est le **type** de fût qui
    // suit le registre, et la hauteur continue de moduler l'instrument.
    const perc = instrumentById('percussions')
    expect(perc.low.pitchDrop).toBeLessThan(1)
    expect(perc.low.noise ?? 0).toBeLessThan(0.3)
    expect(perc.high.noise ?? 0).toBeGreaterThan(0.5)
    expect(perc.high.filterType).toBe('highpass')
  })

  it('une percussion est nettement plus courte que tout le reste du catalogue', () => {
    const midi = 72
    const decay = (id: string) => {
      const instrument = instrumentById(id)
      return decayForNote(voiceForMidi(instrument, midi), midiToFreq(midi))
    }
    for (const other of INSTRUMENTS.filter((i) => i.id !== 'percussions')) {
      expect(decay('percussions'), other.label).toBeLessThan(decay(other.id))
    }
  })

  it('les autres instruments n’ont ni bruit ni chute de hauteur', () => {
    // Les trois champs sont optionnels, et absent doit signifier le comportement historique.
    for (const instrument of INSTRUMENTS.filter((i) => i.id !== 'percussions')) {
      for (const voice of [instrument.low, instrument.high]) {
        expect(voice.noise ?? 0, instrument.label).toBe(0)
        expect(voice.pitchDrop ?? 1, instrument.label).toBe(1)
        expect(voice.filterType ?? 'lowpass', instrument.label).toBe('lowpass')
      }
    }
  })
})

