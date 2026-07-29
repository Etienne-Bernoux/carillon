
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

/** Version du format. Un lien d'une autre version est ignoré, jamais une erreur. */
const VERSION = '1'
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
/** version (1) + gamme (1) + compte de barres (2) + compte de sources (2) */
const HEADER = 6

export interface SharedBar {
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
  period: number
}

export interface SharedScene {
  tuningId: string
  bars: SharedBar[]
  emitters: SharedEmitter[]
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

function encodePeriod(period: number): string {
  const span = PERIOD_MAX - MIN_PERIOD
  const ratio = (Math.max(MIN_PERIOD, Math.min(PERIOD_MAX, period)) - MIN_PERIOD) / span
  return encode6(ratio * (PERIOD_STEPS - 1))
}

function decodePeriod(text: string, at: number): number | null {
  const raw = decode6(text, at)
  if (raw === null) return null
  return MIN_PERIOD + (raw / (PERIOD_STEPS - 1)) * (PERIOD_MAX - MIN_PERIOD)
}

/** Liste des gammes connues, dans un ordre **figé** : l'index voyage dans l'URL. */
export function encodeScene(scene: SharedScene, tuningIds: readonly string[]): string {
  const tuningIndex = Math.max(0, tuningIds.indexOf(scene.tuningId))
  const bars = scene.bars.slice(0, MAX_BARS)
  const emitters = scene.emitters.slice(0, MAX_EMITTERS)

  const parts = [VERSION, encode6(tuningIndex), encodeInt12(bars.length), encodeInt12(emitters.length)]
  for (const bar of bars) {
    parts.push(
      encode12(bar.mx),
      encode12(bar.my),
      encode12(bar.len / LEN_RANGE),
      encode12(normalizeAngle(bar.angle) / Math.PI),
    )
  }
  for (const emitter of emitters) {
    parts.push(encode12(emitter.x), encode12(emitter.y), encodePeriod(emitter.period))
  }
  return parts.join('')
}

/**
 * Décode un lien. Retourne `null` sur **toute** anomalie — version inconnue, longueur incohérente,
 * caractère hors alphabet — plutôt que de jeter : c'est la seule entrée non maîtrisée du produit, et
 * un lien trafiqué doit simplement rendre la scène d'accueil.
 */
export function decodeScene(text: string, tuningIds: readonly string[]): SharedScene | null {
  // `typeof` est redondant pour le typage, mais l'entrée vient d'une URL : à l'exécution ce peut être
  // n'importe quoi.
  if (typeof text !== 'string' || text.length < HEADER || text[0] !== VERSION) return null

  const tuningIndex = decode6(text, 1)
  const barCount = decodeInt12(text, 2)
  const emitterCount = decodeInt12(text, 4)
  if (tuningIndex === null || barCount === null || emitterCount === null) return null
  if (barCount > MAX_BARS || emitterCount > MAX_EMITTERS) return null

  const expected = HEADER + barCount * 8 + emitterCount * 5
  if (text.length !== expected) return null

  const bars: SharedBar[] = []
  let at = HEADER
  for (let i = 0; i < barCount; i++) {
    const mx = decode12(text, at)
    const my = decode12(text, at + 2)
    const len = decode12(text, at + 4)
    const angle = decode12(text, at + 6)
    if (mx === null || my === null || len === null || angle === null) return null
    bars.push({ mx, my, len: len * LEN_RANGE, angle: angle * Math.PI })
    at += 8
  }

  const emitters: SharedEmitter[] = []
  for (let i = 0; i < emitterCount; i++) {
    const x = decode12(text, at)
    const y = decode12(text, at + 2)
    const period = decodePeriod(text, at + 4)
    if (x === null || y === null || period === null) return null
    emitters.push({ x, y, period })
    at += 5
  }

  return { tuningId: tuningIds[tuningIndex] ?? tuningIds[0] ?? '', bars, emitters }
}

/** Taille d'URL qu'occuperait cette scène, pour vérifier le budget sans construire l'URL. */
export function encodedLength(barCount: number, emitterCount: number): number {
  return HEADER + Math.min(barCount, MAX_BARS) * 8 + Math.min(emitterCount, MAX_EMITTERS) * 5
}

export { MAX_BARS, MAX_EMITTERS }
