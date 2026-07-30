/**
 * Timbres. Pur, sans Web Audio : ce fichier ne décrit **que des nombres**, et l'adaptateur audio les
 * lit. C'est ce qui rend un instrument testable sans navigateur — et ce qui empêche un réglage de
 * timbre de se cacher dans le moteur, où rien ne peut l'asserter.
 *
 * Décision structurante : **un instrument est une paire de voix**, pas une voix unique.
 *
 * Un carillon réel ne sonne pas de la même façon dans le grave et dans l'aigu, et un instrument dont
 * les vingt barres partagent exactement la même enveloppe s'entend comme un synthétiseur monotone. On
 * donne donc à chaque instrument une voix **grave** et une voix **aiguë**, séparées par une note de
 * bascule : chaque scène combine ainsi deux sons sans qu'on ait à choisir quoi que ce soit, et sans
 * ajouter un mode — l'US6 a établi qu'on n'introduit pas de mode quand on peut s'en passer.
 */

export type OscKind = 'sine' | 'triangle' | 'square' | 'sawtooth'

export interface Voice {
  /** forme d'onde porteuse */
  wave: OscKind
  /** seconde forme d'onde, légèrement désaccordée, pour l'épaisseur ; absente = voix nue */
  layer?: OscKind
  /** désaccord de la seconde couche, en cents */
  detuneCents: number
  /** attaque en secondes — très courte évite le clic, plus longue adoucit l'entrée */
  attackSeconds: number
  /** décroissance de référence, en secondes, avant correction par le registre */
  decaySeconds: number
  /**
   * Facteur du filtre passe-bas, en multiples de la fréquence jouée. Bas = sourd et boisé,
   * haut = brillant et verrier.
   */
  filterRatio: number
  /** résonance du filtre ; au-delà de ~4 elle chante et colore fortement */
  filterQ: number
  /**
   * Exposant de raccourcissement dans l'aigu. 0 = toutes les notes durent pareil ; 1 = la durée est
   * inversement proportionnelle à la fréquence (comportement d'un carillon).
   */
  brightnessDecay: number
  /**
   * Bornes du rapport de durée entre le grave et l'aigu, **explicites** et non partagées.
   *
   * Le carillon historique bornait ce rapport à `[0,35 ; 1]` : ses notes graves ne sonnent donc **pas**
   * plus longtemps que sa décroissance de référence. Une cloche de verre, elle, doit pouvoir tenir plus
   * longtemps dans le grave. Laisser une borne commune aurait soit changé le timbre de référence, soit
   * bridé les nouveaux — et le premier serait passé inaperçu, faute d'oreille dans une suite de tests.
   */
  decayRatioMin: number
  decayRatioMax: number
  /**
   * Trois champs **optionnels**, absents de toutes les voix d'avant les percussions. Absent signifie le
   * comportement historique — 0 de bruit, aucune chute de hauteur, filtre passe-bas — ce qui évite de
   * recopier trois lignes neutres sur huit voix existantes.
   */
  /** proportion de bruit mêlée à l'oscillateur, 0..1. C'est lui qui fait une caisse ou une cymbale. */
  noise?: number
  /**
   * Facteur appliqué à la fréquence sur la durée de la note. 1 = hauteur tenue ; 0,25 = deux octaves
   * plus bas à l'extinction. C'est **la** signature d'une grosse caisse : le « boum » est une chute de
   * hauteur, pas un timbre.
   */
  pitchDrop?: number
  /** `highpass` pour une cymbale : sans ça le bruit sonne comme un souffle, pas comme du métal. */
  filterType?: 'lowpass' | 'highpass'
}

export interface Instrument {
  readonly id: string
  readonly label: string
  /** nom compact, pour le mode icône des petits écrans */
  readonly short: string
  /** voix des barres longues (notes graves) */
  readonly low: Voice
  /** voix des barres courtes (notes aiguës) */
  readonly high: Voice
  /**
   * Note MIDI de bascule entre les deux voix. Sous cette note, la voix grave ; à partir d'elle, la
   * voix aiguë. Exprimée en MIDI et non en fraction de l'étendue : une gamme peut changer de tonique,
   * et le point de bascule doit rester une **hauteur réelle**, pas une position dans un tableau.
   */
  readonly crossoverMidi: number
}

/**
 * Nommé à part pour que `DEFAULT_INSTRUMENT` n'ait pas à indexer un tableau (donc pas de `!`), et
 * reproduit à l'identique du son d'avant l'US8 : c'est le timbre historique du projet, il reste le
 * défaut et sert de référence d'écoute.
 */
const CARILLON: Instrument = {
  id: 'carillon',
  label: 'Carillon',
  short: 'Carillon',
  low: {
    wave: 'sine',
    layer: 'triangle',
    detuneCents: 6,
    attackSeconds: 0.003,
    decaySeconds: 0.9,
    filterRatio: 4,
    filterQ: 0.7,
    brightnessDecay: 1,
    decayRatioMin: 0.35,
    decayRatioMax: 1,
  },
  high: {
    wave: 'sine',
    layer: 'triangle',
    detuneCents: 6,
    attackSeconds: 0.003,
    decaySeconds: 0.9,
    filterRatio: 4,
    filterQ: 0.7,
    brightnessDecay: 1,
    decayRatioMin: 0.35,
    decayRatioMax: 1,
  },
  crossoverMidi: 69,
}

/**
 * **L'ordre est figé** : son index voyagera dans les liens de partage, comme celui des gammes. On
 * ajoute à la fin, jamais en tête, et le catalogue ne peut pas dépasser 64 entrées (6 bits). Un test
 * l'épingle.
 */
export const INSTRUMENTS: readonly Instrument[] = [
  CARILLON,
  {
    id: 'bois',
    label: 'Bois (marimba)',
    short: 'Bois',
    // Le bois est **court** et sourd : c'est la décroissance rapide et le filtre bas qui font le
    // marimba, pas la forme d'onde. Dans le grave on garde un peu de longueur, sinon les notes basses
    // disparaissent avant d'être perçues comme des notes.
    low: {
      wave: 'triangle',
      layer: 'sine',
      detuneCents: 3,
      attackSeconds: 0.002,
      decaySeconds: 0.42,
      filterRatio: 2.6,
      filterQ: 1.1,
      brightnessDecay: 0.6,
      decayRatioMin: 0.5,
      decayRatioMax: 1.3,
    },
    high: {
      wave: 'triangle',
      detuneCents: 0,
      attackSeconds: 0.001,
      decaySeconds: 0.22,
      filterRatio: 3.2,
      filterQ: 0.9,
      brightnessDecay: 0.9,
      decayRatioMin: 0.4,
      decayRatioMax: 1,
    },
    crossoverMidi: 69,
  },
  {
    id: 'verre',
    label: 'Verre (cloches)',
    short: 'Verre',
    // Le verre **tient** : décroissance longue, filtre haut, résonance marquée. Le désaccord plus
    // large donne les battements caractéristiques d'une cloche.
    low: {
      wave: 'sine',
      layer: 'sine',
      detuneCents: 14,
      attackSeconds: 0.006,
      decaySeconds: 2.6,
      filterRatio: 7,
      filterQ: 2.2,
      brightnessDecay: 0.35,
      decayRatioMin: 0.6,
      decayRatioMax: 1.2,
    },
    high: {
      wave: 'sine',
      layer: 'triangle',
      detuneCents: 11,
      attackSeconds: 0.004,
      decaySeconds: 1.7,
      filterRatio: 9,
      filterQ: 2.6,
      brightnessDecay: 0.5,
      decayRatioMin: 0.5,
      decayRatioMax: 1.1,
    },
    crossoverMidi: 72,
  },
  {
    id: 'corde',
    label: 'Corde (pizzicato)',
    short: 'Corde',
    // Une corde pincée est **riche puis étouffée** : dent de scie filtrée bas, décroissance moyenne.
    // Dans l'aigu on passe au carré, plus mordant, comme un pizzicato près du chevalet.
    low: {
      wave: 'sawtooth',
      layer: 'triangle',
      detuneCents: 8,
      attackSeconds: 0.002,
      decaySeconds: 0.7,
      filterRatio: 2.2,
      filterQ: 3.2,
      brightnessDecay: 0.8,
      decayRatioMin: 0.45,
      decayRatioMax: 1.15,
    },
    high: {
      wave: 'square',
      layer: 'sine',
      detuneCents: 5,
      attackSeconds: 0.001,
      decaySeconds: 0.34,
      filterRatio: 2.8,
      filterQ: 2.4,
      brightnessDecay: 1,
      decayRatioMin: 0.4,
      decayRatioMax: 1,
    },
    crossoverMidi: 67,
  },
  {
    id: 'percussions',
    label: 'Percussions',
    short: 'Perc.',
    /*
     * Une percussion est **non accordée**, alors que tout le produit repose sur la hauteur venue de la
     * géométrie. On ne renonce donc pas au mapping : on fait varier le **type de fût** selon le registre.
     * Une barre longue frappe une grosse caisse, une barre courte une cymbale — et la hauteur continue
     * de moduler l'instrument, comme une caisse qu'on accorde.
     */
    low: {
      // Grosse caisse : sinus qui **chute** de deux octaves en s'éteignant, filtre bas, très court.
      wave: 'sine',
      detuneCents: 0,
      attackSeconds: 0.001,
      decaySeconds: 0.28,
      filterRatio: 1.6,
      filterQ: 0.9,
      brightnessDecay: 0.3,
      decayRatioMin: 0.7,
      decayRatioMax: 1.4,
      noise: 0.12,
      pitchDrop: 0.25,
    },
    high: {
      // Cymbale : surtout du bruit, filtre **passe-haut**, extinction immédiate.
      wave: 'square',
      detuneCents: 0,
      attackSeconds: 0.0008,
      decaySeconds: 0.13,
      filterRatio: 2.2,
      filterQ: 0.8,
      brightnessDecay: 0.5,
      decayRatioMin: 0.5,
      decayRatioMax: 1,
      noise: 0.85,
      filterType: 'highpass',
    },
    crossoverMidi: 69,
  },
] as const

export const DEFAULT_INSTRUMENT: Instrument = CARILLON

export function instrumentById(id: string): Instrument {
  return INSTRUMENTS.find((instrument) => instrument.id === id) ?? DEFAULT_INSTRUMENT
}

/** Voix à employer pour une note donnée : c'est ici que la combinaison grave/aigu se décide. */
export function voiceForMidi(instrument: Instrument, midi: number): Voice {
  return midi < instrument.crossoverMidi ? instrument.low : instrument.high
}

/**
 * Durée réelle d'une note : la décroissance de la voix, raccourcie dans l'aigu selon
 * `brightnessDecay`. Bornée pour qu'une note ne soit jamais inaudiblement courte ni interminable —
 * la borne haute est aussi ce qui protège le budget de polyphonie, qui réserve un créneau pour la
 * durée annoncée.
 */
export const MIN_DECAY_SECONDS = 0.08
export const MAX_DECAY_SECONDS = 3.2

export function decayForNote(voice: Voice, freq: number): number {
  const reference = 880
  const raw = reference / Math.max(freq, 1)
  const ratio = Math.min(Math.max(raw, voice.decayRatioMin), voice.decayRatioMax)
  const scaled = voice.decaySeconds * Math.pow(ratio, voice.brightnessDecay)
  return Math.min(Math.max(scaled, MIN_DECAY_SECONDS), MAX_DECAY_SECONDS)
}
