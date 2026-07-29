import { DEFAULT_BPM, DIVISIONS, MAX_BPM, MIN_BPM, clampBpm, nearestDivisionIndex } from './clock'
import { NATURES } from './nature'


/**
 * Encodage d'une scène pour la mettre dans une URL. Pur, déterministe, sans DOM.
 *
 * Deux décisions structurantes :
 *
 * 1. **On encode une barre par son milieu, sa longueur et son angle**, jamais par ses deux
 *    extrémités. Deux formats ont été essayés et mesurés avant celui-ci :
 *    — normaliser chaque extrémité par sa propre dimension **déforme** les barres dès que le rapport
 *      d'aspect change : 13 notes sur 15 décalées, jusqu'à 5 demi-tons ;
 *    — tout normaliser par la largeur préserve les notes, mais une scène de bureau s'ouvre sur
 *      téléphone en un bandeau écrasé dans le tiers haut de l'écran.
 *    Milieu + longueur + angle permet les deux : le **milieu** suit l'écran (donc la scène le
 *    remplit), tandis que la **longueur** reste une fraction de la largeur — celle dont dépend la
 *    hauteur de note (US2) — et l'**angle** est conservé tel quel. On repositionne sans déformer.
 * 2. **On n'encode pas les notes**, seulement la géométrie et la gamme. Les encoder toutes deux
 *    permettrait un lien incohérent, où une barre sonnerait autre chose que sa longueur.
 */

/**
 * Version du format.
 *
 * On **écrit** toujours la version courante et on **lit** toutes les versions connues : un lien déjà émis
 * doit continuer de s'ouvrir, sinon partager une scène serait une promesse à durée limitée. La v1
 * n'encodait ni la nature des barres, ni le tempo, ni l'instrument — un lien v1 se relit donc avec des
 * murs, le tempo par défaut et l'instrument par défaut. Ce qui manque prend sa valeur par défaut ;
 * jamais une valeur inventée.
 */
const VERSION = '3'
const KNOWN_VERSIONS = ['1', '2', '3']
/** 12 bits par coordonnée : 1/4096 de la zone, soit 0,3 px sur un écran de 1280. */
const QUANTUM = 4096
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
/** Au-delà, l'URL cesse d'être partageable ; on tronque plutôt que de produire un lien inutilisable. */
const MAX_BARS = 120
const MAX_EMITTERS = 16
/** Période encodée sur 6 bits, de MIN_PERIOD à 4 s. */
const PERIOD_STEPS = 64
const PERIOD_MAX = 4
/** Une longueur peut valoir jusqu'à une largeur d'écran entière. */
const LEN_RANGE = 1
/** v1 : version (1) + gamme (1) + compte de barres (2) + compte de sources (2) */
const HEADER_V1 = 6
/** v2 : + instrument (1) + tempo (1) */
const HEADER_V2 = 8
/** v3 : + compte de points de lâcher (2) */
const HEADER_V3 = 10
/** Au-delà, l'URL cesse d'être partageable. */
const MAX_DROPPERS = 16
/** 6 bits de tempo entre MIN_BPM et MAX_BPM, soit une résolution d'environ 1,7 BPM */
const TEMPO_STEPS = 64

export interface SharedBar {
  /** index dans `NATURES` (cf. `nature.ts`) ; absent d'un lien v1, qui vaut alors « mur » */
  natureIndex: number
  /** milieu : fraction de la largeur du viewport */
  mx: number
  /** milieu : fraction de la hauteur de la zone de jeu */
  my: number
  /** longueur, en fraction de la **largeur** du viewport — c'est elle qui porte la note */
  len: number
  /** orientation en radians, dans [0, π) : une barre n'a pas de sens */
  angle: number
}

export interface SharedEmitter {
  x: number
  y: number
  /**
   * Index dans `DIVISIONS` (cf. `clock.ts`). Un lien v1 encodait une **période libre en secondes** : à la
   * relecture on la rapproche de la division la plus voisine, ce qui garde le lien lisible à la grille
   * près plutôt que de le rejeter.
   */
  divisionIndex: number
}

export interface SharedDropper {
  x: number
  y: number
}

export interface SharedScene {
  tuningId: string
  /** identifiant d'instrument ; par défaut sur un lien v1 */
  instrumentId: string
  /** tempo en battements par minute ; par défaut sur un lien v1 */
  bpm: number
  bars: SharedBar[]
  emitters: SharedEmitter[]
  /**
   * Points de lâcher. Absents d'un lien v1 ou v2 : une scène partagée y perdait donc ses billes qui
   * reviennent, et un air composé — qui ne tient que par une bille recyclée — arrivait **silencieux**.
   */
  droppers: SharedDropper[]
}

function encode12(value: number): string {
  const clamped = Math.max(0, Math.min(QUANTUM - 1, Math.round(value * (QUANTUM - 1))))
  return (ALPHABET[clamped >> 6] ?? 'A') + (ALPHABET[clamped & 63] ?? 'A')
}

function decode12(text: string, at: number): number | null {
  const high = ALPHABET.indexOf(text[at] ?? '')
  const low = ALPHABET.indexOf(text[at + 1] ?? '')
  if (high < 0 || low < 0) return null
  return ((high << 6) | low) / (QUANTUM - 1)
}

/**
 * Entier sur 12 bits (deux caractères). Les compteurs passaient par l'encodeur 6 bits, qui plafonne à
 * 63 : au-delà de 63 barres, l'en-tête annonçait un compte faux et le lien devenait indécodable —
 * exactement au moment où la troncature à 120 barres était censée le sauver.
 */
function encodeInt12(value: number): string {
  const clamped = Math.max(0, Math.min(QUANTUM - 1, Math.round(value)))
  return (ALPHABET[clamped >> 6] ?? 'A') + (ALPHABET[clamped & 63] ?? 'A')
}

function decodeInt12(text: string, at: number): number | null {
  const high = ALPHABET.indexOf(text[at] ?? '')
  const low = ALPHABET.indexOf(text[at + 1] ?? '')
  if (high < 0 || low < 0) return null
  return (high << 6) | low
}

/** Ramène un angle dans [0, π) : une barre n'a pas de sens, donc θ et θ+π sont la même barre. */
export function normalizeAngle(angle: number): number {
  const wrapped = angle % Math.PI
  return wrapped < 0 ? wrapped + Math.PI : wrapped
}

function encode6(value: number): string {
  return ALPHABET[Math.max(0, Math.min(63, Math.round(value)))] ?? 'A'
}

function decode6(text: string, at: number): number | null {
  const index = ALPHABET.indexOf(text[at] ?? '')
  return index < 0 ? null : index
}

/**
 * Plancher de période **du format**, et non de l'émetteur. Les sources s'expriment désormais en
 * divisions de mesure (cf. `clock.ts`), mais les liens déjà émis encodent une période libre en
 * secondes : cette borne appartient donc au format, qu'on ne touche plus, et la relecture rapproche la
 * valeur de la division la plus voisine.
 */
const MIN_PERIOD = 0.15

function encodeTempo(bpm: number): string {
  const span = MAX_BPM - MIN_BPM
  const ratio = (clampBpm(bpm) - MIN_BPM) / span
  return encode6(ratio * (TEMPO_STEPS - 1))
}

function decodeTempo(text: string, at: number): number | null {
  const raw = decode6(text, at)
  if (raw === null) return null
  return MIN_BPM + (raw / (TEMPO_STEPS - 1)) * (MAX_BPM - MIN_BPM)
}

/*
 * `encodePeriod` a été retiré : la v2 n'écrit plus de période libre, seulement un index de division.
 * `decodePeriod` reste, parce qu'il faut continuer de **lire** les liens v1.
 */
function decodePeriod(text: string, at: number): number | null {
  const raw = decode6(text, at)
  if (raw === null) return null
  return MIN_PERIOD + (raw / (PERIOD_STEPS - 1)) * (PERIOD_MAX - MIN_PERIOD)
}

/** Liste des gammes connues, dans un ordre **figé** : l'index voyage dans l'URL. */
export function encodeScene(
  scene: SharedScene,
  tuningIds: readonly string[],
  instrumentIds: readonly string[]
): string {
  const tuningIndex = Math.max(0, tuningIds.indexOf(scene.tuningId))
  const instrumentIndex = Math.max(0, instrumentIds.indexOf(scene.instrumentId))
  const bars = scene.bars.slice(0, MAX_BARS)
  const emitters = scene.emitters.slice(0, MAX_EMITTERS)

  const droppers = scene.droppers.slice(0, MAX_DROPPERS)
  const parts = [
    VERSION,
    encode6(tuningIndex),
    encode6(instrumentIndex),
    encodeTempo(scene.bpm),
    encodeInt12(bars.length),
    encodeInt12(emitters.length),
    encodeInt12(droppers.length),
  ]
  for (const bar of bars) {
    parts.push(
      encode12(bar.mx),
      encode12(bar.my),
      encode12(bar.len / LEN_RANGE),
      encode12(normalizeAngle(bar.angle) / Math.PI),
      encode6(bar.natureIndex),
    )
  }
  for (const emitter of emitters) {
    parts.push(encode12(emitter.x), encode12(emitter.y), encode6(emitter.divisionIndex))
  }
  for (const dropper of droppers) {
    parts.push(encode12(dropper.x), encode12(dropper.y))
  }
  return parts.join('')
}

/**
 * Décode un lien. Retourne `null` sur **toute** anomalie — version inconnue, longueur incohérente,
 * caractère hors alphabet — plutôt que de jeter : c'est la seule entrée non maîtrisée du produit, et
 * un lien trafiqué doit simplement rendre la scène d'accueil.
 */
export function decodeScene(
  text: string,
  tuningIds: readonly string[],
  instrumentIds: readonly string[]
): SharedScene | null {
  // `typeof` est redondant pour le typage, mais l'entrée vient d'une URL : à l'exécution ce peut être
  // n'importe quoi.
  if (typeof text !== 'string' || text.length < HEADER_V1) return null
  const version = text[0] ?? ''
  if (!KNOWN_VERSIONS.includes(version)) return null

  const v3 = version === '3'
  const v2 = version === '2' || v3
  const header = v3 ? HEADER_V3 : v2 ? HEADER_V2 : HEADER_V1
  if (text.length < header) return null

  const tuningIndex = decode6(text, 1)
  const instrumentIndex = v2 ? decode6(text, 2) : 0
  const bpm = v2 ? decodeTempo(text, 3) : DEFAULT_BPM
  const barCount = decodeInt12(text, v2 ? 4 : 2)
  const emitterCount = decodeInt12(text, v2 ? 6 : 4)
  const dropperCount = v3 ? decodeInt12(text, 8) : 0
  if (tuningIndex === null || instrumentIndex === null || bpm === null) return null
  if (barCount === null || emitterCount === null || dropperCount === null) return null
  if (barCount > MAX_BARS || emitterCount > MAX_EMITTERS) return null
  if (dropperCount > MAX_DROPPERS) return null

  const barSize = v2 ? 9 : 8
  const emitterSize = 5
  if (text.length !== header + barCount * barSize + emitterCount * emitterSize + dropperCount * 4) {
    return null
  }

  const bars: SharedBar[] = []
  let at = header
  for (let i = 0; i < barCount; i++) {
    const mx = decode12(text, at)
    const my = decode12(text, at + 2)
    const len = decode12(text, at + 4)
    const angle = decode12(text, at + 6)
    // Un lien v1 ne porte pas de nature : ses barres sont des murs, le comportement historique.
    const natureIndex = v2 ? decode6(text, at + 8) : 0
    if (mx === null || my === null || len === null || angle === null || natureIndex === null) {
      return null
    }
    bars.push({
      mx,
      my,
      len: len * LEN_RANGE,
      angle: angle * Math.PI,
      natureIndex: natureIndex < NATURES.length ? natureIndex : 0,
    })
    at += barSize
  }

  const emitters: SharedEmitter[] = []
  for (let i = 0; i < emitterCount; i++) {
    const x = decode12(text, at)
    const y = decode12(text, at + 2)
    if (x === null || y === null) return null
    if (v2) {
      const divisionIndex = decode6(text, at + 4)
      if (divisionIndex === null) return null
      emitters.push({ x, y, divisionIndex: divisionIndex < DIVISIONS.length ? divisionIndex : 1 })
    } else {
      // v1 : période libre en secondes, rapprochée de la division la plus voisine.
      const period = decodePeriod(text, at + 4)
      if (period === null) return null
      emitters.push({ x, y, divisionIndex: nearestDivisionIndex(period, bpm) })
    }
    at += emitterSize
  }

  const droppers: SharedDropper[] = []
  for (let i = 0; i < dropperCount; i++) {
    const x = decode12(text, at)
    const y = decode12(text, at + 2)
    if (x === null || y === null) return null
    droppers.push({ x, y })
    at += 4
  }

  return {
    tuningId: tuningIds[tuningIndex] ?? tuningIds[0] ?? '',
    instrumentId: instrumentIds[instrumentIndex] ?? instrumentIds[0] ?? '',
    bpm,
    bars,
    emitters,
    droppers,
  }
}

/** Taille d'URL qu'occuperait cette scène, pour vérifier le budget sans construire l'URL. */
export function encodedLength(barCount: number, emitterCount: number, dropperCount = 0): number {
  return (
    HEADER_V3 +
    Math.min(barCount, MAX_BARS) * 9 +
    Math.min(emitterCount, MAX_EMITTERS) * 5 +
    Math.min(dropperCount, MAX_DROPPERS) * 4
  )
}

export { MAX_BARS, MAX_DROPPERS, MAX_EMITTERS }
