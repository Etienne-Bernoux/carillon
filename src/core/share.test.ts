import { describe, expect, it } from 'vitest'
import { MIN_PERIOD } from './emitter'
import { DEFAULT_TUNING, TUNINGS } from './music'
import { createRng } from './rng'
import { MAX_BARS, MAX_EMITTERS, decodeScene, encodeScene, encodedLength, normalizeAngle } from './share'
import type { SharedScene } from './share'

const TUNING_IDS = TUNINGS.map((tuning) => tuning.id)

function scene(barCount: number, emitterCount = 2, tuningId = DEFAULT_TUNING.id): SharedScene {
  const rng = createRng(4242)
  return {
    tuningId,
    bars: Array.from({ length: barCount }, () => ({
      mx: rng(),
      my: rng(),
      len: 0.05 + rng() * 0.5,
      angle: rng() * Math.PI,
    })),
    emitters: Array.from({ length: emitterCount }, () => ({
      x: rng(),
      y: rng(),
      period: MIN_PERIOD + rng() * 2,
    })),
  }
}

describe('E1 — aller-retour fidèle', () => {
  it('rend la même géométrie à la précision de quantification près', () => {
    const original = scene(18)
    const decoded = decodeScene(encodeScene(original, TUNING_IDS), TUNING_IDS)

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

  it('conserve les sources et leur période', () => {
    const original = scene(4, 5)
    const decoded = decodeScene(encodeScene(original, TUNING_IDS), TUNING_IDS)

    expect(decoded?.emitters).toHaveLength(5)
    for (const [i, emitter] of original.emitters.entries()) {
      const back = decoded?.emitters[i]
      expect(Math.abs((back?.x ?? -1) - emitter.x)).toBeLessThan(1 / 4000)
      // `y` aussi : sans cette ligne, intervertir x et y dans l'encodeur passait les 167 tests.
      expect(Math.abs((back?.y ?? -1) - emitter.y)).toBeLessThan(1 / 4000)
      // Période sur 6 bits entre MIN_PERIOD et 4 s : un pas vaut 61 ms.
      expect(Math.abs((back?.period ?? -1) - emitter.period)).toBeLessThan(0.04)
    }
  })

  it('conserve chacune des gammes du catalogue', () => {
    for (const tuning of TUNINGS) {
      const decoded = decodeScene(encodeScene(scene(3, 1, tuning.id), TUNING_IDS), TUNING_IDS)
      expect(decoded?.tuningId).toBe(tuning.id)
    }
  })
})

// L'invariance d'écran est prouvée dans `share-layout.test.ts`, par le vrai chemin
// pixels → fractions → encodage → pixels sur deux écrans réels. Les deux tests qui vivaient ici
// comparaient `midiForLength(len·w, T, w)` à `midiForLength(len·1280, T, 1280)` : le `w` se simplifie,
// c'était une identité arithmétique vraie quoi que fasse l'encodeur.

describe('E3 — robustesse d’un lien trafiqué', () => {
  const valid = encodeScene(scene(6, 2), TUNING_IDS)

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
      expect(() => decodeScene(input, TUNING_IDS)).not.toThrow()
      expect(decodeScene(input, TUNING_IDS)).toBeNull()
    })
  }

  it('accepte le lien valide de référence (sinon les cas hostiles ne prouveraient rien)', () => {
    expect(decodeScene(valid, TUNING_IDS)).not.toBeNull()
  })

  it('retombe sur la première gamme si l’index est hors catalogue', () => {
    const forged = encodeScene(scene(1, 0), TUNING_IDS)
    // On force un index de gamme très au-delà du catalogue.
    const tampered = `${forged[0]}_${forged.slice(2)}`
    expect(decodeScene(tampered, TUNING_IDS)?.tuningId).toBe(TUNING_IDS[0])
  })
})

describe('E4 — budget de taille', () => {
  it('tient sous 1 500 caractères pour 60 barres et 8 sources', () => {
    const encoded = encodeScene(scene(60, 8), TUNING_IDS)
    expect(encoded.length).toBe(encodedLength(60, 8))
    expect(encoded.length).toBeLessThan(1500)
  })

  it('tronque proprement au-delà des plafonds plutôt que de produire un lien géant', () => {
    const encoded = encodeScene(scene(400, 50), TUNING_IDS)
    const decoded = decodeScene(encoded, TUNING_IDS)
    expect(decoded?.bars).toHaveLength(MAX_BARS)
    expect(decoded?.emitters).toHaveLength(MAX_EMITTERS)
    expect(encoded.length).toBeLessThan(1500)
  })

  it('n’utilise que des caractères sûrs dans une URL', () => {
    const encoded = encodeScene(scene(30, 4), TUNING_IDS)
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
