import { describe, expect, it } from 'vitest'

import { DEFAULT_INSTRUMENT, INSTRUMENTS } from './instruments'
import { DEFAULT_TUNING, TUNINGS } from './music'
import { NATURES } from './nature'
import { createRng } from './rng'
import { MAX_BARS, MAX_EMITTERS, decodeScene, encodeScene, encodedLength, normalizeAngle } from './share'
import type { SharedScene } from './share'

const TUNING_IDS = TUNINGS.map((tuning) => tuning.id)
const INSTRUMENT_IDS = INSTRUMENTS.map((instrument) => instrument.id)

function scene(barCount: number, emitterCount = 2, tuningId = DEFAULT_TUNING.id): SharedScene {
  const rng = createRng(4242)
  return {
    tuningId,
    instrumentId: DEFAULT_INSTRUMENT.id,
    bpm: 96,
    bars: Array.from({ length: barCount }, (_, i) => ({
      mx: rng(),
      my: rng(),
      len: 0.05 + rng() * 0.5,
      angle: rng() * Math.PI,
      natureIndex: i % NATURES.length,
    })),
    emitters: Array.from({ length: emitterCount }, (_, i) => ({
      x: rng(),
      y: rng(),
      divisionIndex: i % 5,
    })),
  }
}

describe('E1 — aller-retour fidèle', () => {
  it('rend la même géométrie à la précision de quantification près', () => {
    const original = scene(18)
    const decoded = decodeScene(encodeScene(original, TUNING_IDS, INSTRUMENT_IDS), TUNING_IDS, INSTRUMENT_IDS)

    expect(decoded).not.toBeNull()
    expect(decoded?.tuningId).toBe(original.tuningId)
    expect(decoded?.bars).toHaveLength(original.bars.length)

    for (const [i, bar] of original.bars.entries()) {
      const back = decoded?.bars[i]
      // 1/4096 de la plage : sur un écran de 1280 px, 0,32 px. La tolérance est exprimée en fraction
      // et non en pixels — c'est tout l'objet de l'encodage relatif.
      for (const key of ['mx', 'my', 'len'] as const) {
        expect(Math.abs((back?.[key] ?? -1) - bar[key])).toBeLessThan(1 / 4000)
      }
      // L'angle est quantifié sur π : 0,04° de précision.
      expect(Math.abs((back?.angle ?? -1) - bar.angle)).toBeLessThan(Math.PI / 4000)
    }
  })

  it('conserve les sources et leur division', () => {
    const original = scene(4, 5)
    const decoded = decodeScene(encodeScene(original, TUNING_IDS, INSTRUMENT_IDS), TUNING_IDS, INSTRUMENT_IDS)

    expect(decoded?.emitters).toHaveLength(5)
    for (const [i, emitter] of original.emitters.entries()) {
      const back = decoded?.emitters[i]
      expect(Math.abs((back?.x ?? -1) - emitter.x)).toBeLessThan(1 / 4000)
      // `y` aussi : sans cette ligne, intervertir x et y dans l'encodeur passait les 167 tests.
      expect(Math.abs((back?.y ?? -1) - emitter.y)).toBeLessThan(1 / 4000)
      // La division est un **index** : elle se conserve exactement, sans quantification.
      expect(back?.divisionIndex).toBe(emitter.divisionIndex)
    }
  })

  it('conserve chacune des gammes du catalogue', () => {
    for (const tuning of TUNINGS) {
      const decoded = decodeScene(
        encodeScene(scene(3, 1, tuning.id), TUNING_IDS, INSTRUMENT_IDS),
        TUNING_IDS,
        INSTRUMENT_IDS,
      )
      expect(decoded?.tuningId).toBe(tuning.id)
    }
  })
})

// L'invariance d'écran est prouvée dans `share-layout.test.ts`, par le vrai chemin
// pixels → fractions → encodage → pixels sur deux écrans réels. Les deux tests qui vivaient ici
// comparaient `midiForLength(len·w, T, w)` à `midiForLength(len·1280, T, 1280)` : le `w` se simplifie,
// c'était une identité arithmétique vraie quoi que fasse l'encodeur.

describe('E3 — robustesse d’un lien trafiqué', () => {
  const valid = encodeScene(scene(6, 2), TUNING_IDS, INSTRUMENT_IDS)

  const hostile = [
    '',
    ' ',
    '0',
    '1',
    '2AAA',
    'x' + valid.slice(1),
    valid.slice(0, valid.length - 1),
    valid.slice(0, 12),
    valid + 'AA',
    `${valid}!!!`,
    '1' + '~'.repeat(40),
    '1zzzz' + 'A'.repeat(500),
    'null',
    'undefined',
    '1AAA' + 'A'.repeat(1000),
    // Longueur **correcte**, caractère invalide au milieu du corps : c'est le seul cas qui exerce les
    // gardes de décodage des coordonnées. Sans lui, les retirer laissait toute la suite verte, alors
    // que `decode12` rendrait des coordonnées négatives injectées dans la physique.
    `${valid.slice(0, 20)}!${valid.slice(21)}`,
  ]

  for (const [i, input] of hostile.entries()) {
    it(`ne jette pas et refuse l’entrée hostile #${i}`, () => {
      expect(() => decodeScene(input, TUNING_IDS, INSTRUMENT_IDS)).not.toThrow()
      expect(decodeScene(input, TUNING_IDS, INSTRUMENT_IDS)).toBeNull()
    })
  }

  it('accepte le lien valide de référence (sinon les cas hostiles ne prouveraient rien)', () => {
    expect(decodeScene(valid, TUNING_IDS, INSTRUMENT_IDS)).not.toBeNull()
  })

  it('retombe sur la première gamme si l’index est hors catalogue', () => {
    const forged = encodeScene(scene(1, 0), TUNING_IDS, INSTRUMENT_IDS)
    // On force un index de gamme très au-delà du catalogue.
    const tampered = `${forged[0]}_${forged.slice(2)}`
    expect(decodeScene(tampered, TUNING_IDS, INSTRUMENT_IDS)?.tuningId).toBe(TUNING_IDS[0])
  })
})

describe('E4 — budget de taille', () => {
  it('tient sous 1 500 caractères pour 60 barres et 8 sources', () => {
    const encoded = encodeScene(scene(60, 8), TUNING_IDS, INSTRUMENT_IDS)
    expect(encoded.length).toBe(encodedLength(60, 8))
    expect(encoded.length).toBeLessThan(1500)
  })

  it('tronque proprement au-delà des plafonds plutôt que de produire un lien géant', () => {
    const encoded = encodeScene(scene(400, 50), TUNING_IDS, INSTRUMENT_IDS)
    const decoded = decodeScene(encoded, TUNING_IDS, INSTRUMENT_IDS)
    expect(decoded?.bars).toHaveLength(MAX_BARS)
    expect(decoded?.emitters).toHaveLength(MAX_EMITTERS)
    expect(encoded.length).toBeLessThan(1500)
  })

  it('n’utilise que des caractères sûrs dans une URL', () => {
    const encoded = encodeScene(scene(30, 4), TUNING_IDS, INSTRUMENT_IDS)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(encoded)).toBe(encoded)
  })
})

describe('normalizeAngle', () => {
  it('ramène θ et θ+π à la même barre : une barre n’a pas de sens', () => {
    for (const angle of [0, 0.3, 1.2, 2.9]) {
      expect(normalizeAngle(angle + Math.PI)).toBeCloseTo(normalizeAngle(angle), 10)
      expect(normalizeAngle(-angle)).toBeGreaterThanOrEqual(0)
      expect(normalizeAngle(-angle)).toBeLessThan(Math.PI)
    }
  })
})

describe('E7 — un lien v1 continue de s’ouvrir', () => {
  /*
   * Encodeur **v1**, reproduit en dur : c'est un test doré. Partager une scène ne doit pas être une
   * promesse à durée limitée, donc le format doit rester lisible d'une version à l'autre. Si la
   * relecture v1 casse, ce test rougit — et non « ça a l'air de marcher », que personne ne revérifie.
   *
   * v1 : version(1) + gamme(1) + barres(2) + sources(2), puis 8 caractères par barre
   * (mx, my, longueur, angle sur 12 bits) et 5 par source (x, y sur 12 bits + période sur 6 bits).
   */
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const six = (value: number) => ALPHABET[Math.max(0, Math.min(63, Math.round(value)))] ?? 'A'
  const twelve = (fraction: number) => {
    const q = Math.max(0, Math.min(4095, Math.round(fraction * 4095)))
    return `${six(Math.floor(q / 64))}${six(q % 64)}`
  }
  const int12 = (value: number) => twelve(value / 4095)

  function encodeV1(
    tuningIndex: number,
    bars: { mx: number; my: number; len: number; angle: number }[],
    emitters: { x: number; y: number; period: number }[]
  ): string {
    const parts = ['1', six(tuningIndex), int12(bars.length), int12(emitters.length)]
    for (const bar of bars) {
      parts.push(twelve(bar.mx), twelve(bar.my), twelve(bar.len), twelve(bar.angle / Math.PI))
    }
    for (const emitter of emitters) {
      const ratio = (emitter.period - 0.15) / (4 - 0.15)
      parts.push(twelve(emitter.x), twelve(emitter.y), six(ratio * 63))
    }
    return parts.join('')
  }

  it('un lien v1 se relit : sa géométrie et sa gamme sont conservées', () => {
    const link = encodeV1(
      2,
      [
        { mx: 0.25, my: 0.4, len: 0.3, angle: 0.5 },
        { mx: 0.75, my: 0.6, len: 0.12, angle: 2.1 },
      ],
      [{ x: 0.5, y: 0.1, period: 1.25 }]
    )
    const decoded = decodeScene(link, TUNING_IDS, INSTRUMENT_IDS)

    expect(decoded).not.toBeNull()
    expect(decoded?.tuningId).toBe(TUNING_IDS[2])
    expect(decoded?.bars).toHaveLength(2)
    expect(Math.abs((decoded?.bars[0]?.mx ?? -1) - 0.25)).toBeLessThan(1 / 4000)
    expect(Math.abs((decoded?.bars[1]?.len ?? -1) - 0.12)).toBeLessThan(1 / 4000)
    expect(decoded?.emitters).toHaveLength(1)
  })

  it('ce qui manque à la v1 prend sa valeur par défaut, jamais une valeur inventée', () => {
    const link = encodeV1(0, [{ mx: 0.5, my: 0.5, len: 0.2, angle: 1 }], [])
    const decoded = decodeScene(link, TUNING_IDS, INSTRUMENT_IDS)

    // Pas de nature dans la v1 : ses barres sont des murs, le comportement historique.
    expect(decoded?.bars[0]?.natureIndex).toBe(0)
    expect(NATURES[decoded?.bars[0]?.natureIndex ?? -1]).toBe('wall')
    // Pas de tempo ni d'instrument : les défauts.
    expect(decoded?.bpm).toBe(96)
    expect(decoded?.instrumentId).toBe(INSTRUMENT_IDS[0])
  })

  it('la période libre d’une source v1 devient la division la plus voisine', () => {
    // 1,25 s à 96 BPM vaut exactement une demi-mesure, soit l'index 1.
    const link = encodeV1(0, [], [{ x: 0.5, y: 0.2, period: 1.25 }])
    const decoded = decodeScene(link, TUNING_IDS, INSTRUMENT_IDS)
    expect(decoded?.emitters[0]?.divisionIndex).toBe(1)
  })

  it('une version inconnue est refusée, pas devinée', () => {
    const link = encodeV1(0, [{ mx: 0.5, my: 0.5, len: 0.2, angle: 1 }], [])
    expect(decodeScene(`9${link.slice(1)}`, TUNING_IDS, INSTRUMENT_IDS)).toBeNull()
    expect(decodeScene(`3${link.slice(1)}`, TUNING_IDS, INSTRUMENT_IDS)).toBeNull()
  })
})

describe('E8 — la v2 transporte ce que la v1 perdait', () => {
  it('la nature de chaque barre fait l’aller-retour', () => {
    const original = scene(NATURES.length * 2)
    const decoded = decodeScene(
      encodeScene(original, TUNING_IDS, INSTRUMENT_IDS),
      TUNING_IDS,
      INSTRUMENT_IDS
    )
    expect(decoded?.bars.map((bar) => bar.natureIndex)).toEqual(
      original.bars.map((bar) => bar.natureIndex)
    )
  })

  it('l’instrument fait l’aller-retour, pour chacun du catalogue', () => {
    for (const instrument of INSTRUMENTS) {
      const original = { ...scene(2, 0), instrumentId: instrument.id }
      const decoded = decodeScene(
        encodeScene(original, TUNING_IDS, INSTRUMENT_IDS),
        TUNING_IDS,
        INSTRUMENT_IDS
      )
      expect(decoded?.instrumentId).toBe(instrument.id)
    }
  })

  it('le tempo fait l’aller-retour, à la résolution de son encodage près', () => {
    // 6 bits entre 60 et 168 BPM : un pas vaut environ 1,7 BPM.
    for (const bpm of [60, 96, 120, 132, 168]) {
      const decoded = decodeScene(
        encodeScene({ ...scene(1, 0), bpm }, TUNING_IDS, INSTRUMENT_IDS),
        TUNING_IDS,
        INSTRUMENT_IDS
      )
      expect(Math.abs((decoded?.bpm ?? -1) - bpm)).toBeLessThan(1.8)
    }
  })

  it('un index de nature hors catalogue retombe sur « mur » au lieu de casser le lien', () => {
    const encoded = encodeScene(scene(1, 0), TUNING_IDS, INSTRUMENT_IDS)
    // Dernier caractère d'une barre = sa nature ; « _ » vaut 63, largement hors catalogue.
    const tampered = `${encoded.slice(0, -1)}_`
    const decoded = decodeScene(tampered, TUNING_IDS, INSTRUMENT_IDS)
    expect(decoded?.bars[0]?.natureIndex).toBe(0)
  })
})

