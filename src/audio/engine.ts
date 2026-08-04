/**
 * Adaptateur Web Audio : la seule partie du projet qui touche le DOM/l'API navigateur.
 * Volontairement mince — toute décision testable (hauteur, gain, budget de polyphonie) vit
 * dans music.ts et budget.ts ; ici on ne fait que router le son.
 */

import type { Voice } from '../core/instruments'
import { createRng } from '../core/rng'
import { VoiceBudget } from './budget'

export interface NoteRequest {
  freq: number
  gain: number
  pan: number
  /** identifiant de la barre source, utilisé par le budget de polyphonie */
  barId: number
  /**
   * Timbre à jouer. Décrit **hors** de ce fichier (`core/instruments.ts`) : le moteur reste mince et
   * ne décide rien, il route. C'est ce qui rend un timbre assertable sans navigateur.
   */
  voice: Voice
  /** durée de la décroissance, calculée par le cœur — le moteur ne recalcule pas de musique */
  decaySeconds: number
}

export interface AudioEngine {
  unlock(): Promise<void>
  ready(): boolean
  play(note: NoteRequest): void
  setMuted(muted: boolean): void
  muted(): boolean
  playedCount(): number
  /**
   * Libère les créneaux de polyphonie retenus. Sert à **mesurer** : le budget compte les voix depuis
   * l'horloge audio, que `advance()` ne fait pas avancer, donc une salve simulée laisse ses créneaux
   * réservés et la salve suivante peut être refusée en bloc. Sans ce point d'entrée, « ce timbre produit
   * des notes » dépend de ce que les timbres précédents ont joué — une preuve qui dépend de la charge de
   * la machine, ce que la méthode de ce dépôt interdit.
   *
   * N'existe pas pour le produit : rien dans l'interface ne l'appelle.
   */
  releaseVoices(): void
}

/** graine de l'impulsion de réverbe : le timbre doit être identique d'une session à l'autre */
const REVERB_SEED = 0x5eed

/** durée de la queue de réverbe procédurale, en secondes */
const REVERB_SECONDS = 1.8

/*
 * Gains de la chaîne de sortie, **nommés** parce que la mesure hors ligne doit reproduire exactement la
 * chaîne réelle. Des valeurs recopiées à la main dans les deux endroits divergeraient, et la mesure
 * finirait par certifier un signal que personne n'entend.
 */
const DRY_GAIN = 0.8
const WET_GAIN = 0.25

export function createAudioEngine(budget: VoiceBudget = new VoiceBudget()): AudioEngine {
  let context: AudioContext | null = null
  let masterGain: GainNode | null = null
  let convolver: ConvolverNode | null = null
  let dryGain: GainNode | null = null
  let isMuted = false
  let played = 0

  function ready(): boolean {
    return context !== null
  }

  async function unlock(): Promise<void> {
    if (context) {
      if (context.state === 'suspended') {
        await context.resume()
      }
      return
    }

    const ctx = new AudioContext()
    context = ctx

    const compressorNode = ctx.createDynamicsCompressor()
    configureLimiter(compressorNode)
    compressorNode.connect(ctx.destination)

    const master = ctx.createGain()
    master.gain.value = isMuted ? 0 : 1
    master.connect(compressorNode)

    const dry = ctx.createGain()
    dry.gain.value = DRY_GAIN
    dry.connect(master)

    const wet = ctx.createGain()
    wet.gain.value = WET_GAIN
    const conv = ctx.createConvolver()
    conv.buffer = buildReverbImpulse(ctx)
    conv.connect(wet)
    wet.connect(master)

    // `compressorNode` et `wet` ne sont pas conservés en variables : le graphe audio les maintient
    // vivants tant qu'ils sont connectés à la destination.
    masterGain = master
    convolver = conv
    dryGain = dry

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
  }

  function setMuted(muted: boolean): void {
    isMuted = muted
    if (masterGain && context) {
      const target = muted ? 0 : 1
      masterGain.gain.setValueAtTime(masterGain.gain.value, context.currentTime)
      masterGain.gain.linearRampToValueAtTime(target, context.currentTime + 0.05)
    }
  }

  function muted(): boolean {
    return isMuted
  }

  function playedCount(): number {
    return played
  }

  function play(note: NoteRequest): void {
    const ctx = context
    if (!ctx || !dryGain || !convolver) return

    const now = ctx.currentTime
    // La décroissance vient du cœur (`decayForNote`) : elle dépend du timbre **et** du registre, et
    // c'est une décision musicale — elle n'a donc rien à faire dans l'adaptateur.
    const { voice, decaySeconds } = note
    const lifetimeSeconds = voice.attackSeconds + decaySeconds + 0.05

    // La durée réservée doit être la durée réelle de la voix : une constante de 1 s retenait un
    // slot 2,7× trop longtemps dans l'aigu, ce qui plafonnait le débit à 24 notes/s et faisait
    // taire une scène dense alors que le CPU était libre.
    if (!budget.claim(note.barId, now * 1000, lifetimeSeconds * 1000)) return

    buildVoice(ctx, note, now, [dryGain, convolver])
    played += 1
  }

  return {
    unlock,
    ready,
    play,
    setMuted,
    muted,
    playedCount,
    releaseVoices: () => budget.reset(),
  }
}

/**
 * Construit et démarre **une** voix. Prend un `BaseAudioContext` et non l'`AudioContext` vivant : c'est
 * ce qui permet de rendre exactement le même son **hors ligne** pour le mesurer. Si la mesure passait
 * par un chemin audio différent, elle porterait sur autre chose que ce qu'on entend — et l'assertion
 * « pas d'écrêtage » serait creuse.
 */
/**
 * Réglages du limiteur de sortie, **explicites**.
 *
 * Les valeurs par défaut d'un `DynamicsCompressor` (seuil −24 dB, coude 30 dB, ratio 12, attaque 3 ms)
 * laissent passer le transitoire : mesuré par rendu hors ligne, 24 notes simultanées au gain maximal
 * sortaient à une crête de **1,38** au carillon et **1,45** au verre — donc en écrêtage franc, sur les
 * quatre instruments. Le compresseur était là depuis l'US1 et n'a jamais été réglé.
 *
 * Une attaque courte, un coude serré et un ratio élevé en font un vrai limiteur ; le gain de sortie
 * compense la réduction pour que les scènes clairsemées ne perdent pas en volume.
 */
function configureLimiter(node: DynamicsCompressorNode): void {
  node.threshold.value = -14
  node.knee.value = 4
  node.ratio.value = 20
  node.attack.value = 0.001
  node.release.value = 0.18
}

function buildVoice(
  ctx: BaseAudioContext,
  note: NoteRequest,
  startAt: number,
  destinations: readonly AudioNode[]
): void {
  const { voice, decaySeconds } = note
  const peakGain = clamp(note.gain, 0, 1)
  const lifetimeSeconds = voice.attackSeconds + decaySeconds + 0.05

  const carrier = ctx.createOscillator()
  carrier.type = voice.wave
  carrier.frequency.value = note.freq
  /*
   * Chute de hauteur : c'est **la** signature d'une grosse caisse. Le « boum » n'est pas un timbre mais
   * une fréquence qui s'effondre pendant l'extinction.
   */
  if (voice.pitchDrop !== undefined && voice.pitchDrop !== 1) {
    carrier.frequency.exponentialRampToValueAtTime(
      Math.max(note.freq * voice.pitchDrop, 20),
      startAt + decaySeconds
    )
  }

  // Seconde couche **optionnelle** : une voix nue (le marimba aigu) doit pouvoir l'être vraiment.
  // Créer un oscillateur muet à la place coûterait du CPU pour rien à chaque note.
  const layer = voice.layer ? ctx.createOscillator() : null
  if (layer && voice.layer) {
    layer.type = voice.layer
    layer.frequency.value = note.freq
    layer.detune.value = voice.detuneCents
  }

  /*
   * Bruit blanc mêlé à l'oscillateur : c'est lui qui fait une caisse ou une cymbale. Le tampon est
   * partagé et seedé, donc deux sessions entendent la même cymbale.
   */
  const noiseAmount = voice.noise ?? 0
  let noise: AudioBufferSourceNode | null = null
  let noiseGain: GainNode | null = null
  if (noiseAmount > 0) {
    noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer(ctx)
    noise.loop = true
    noiseGain = ctx.createGain()
    noiseGain.gain.value = noiseAmount
    noise.connect(noiseGain)
  }

  const voiceGain = ctx.createGain()
  voiceGain.gain.setValueAtTime(0.0001, startAt)
  voiceGain.gain.exponentialRampToValueAtTime(Math.max(peakGain, 0.0001), startAt + voice.attackSeconds)
  voiceGain.gain.exponentialRampToValueAtTime(
    0.0001,
    startAt + voice.attackSeconds + decaySeconds
  )

  const filter = ctx.createBiquadFilter()
  filter.type = voice.filterType ?? 'lowpass'
  // Un passe-haut à 400 Hz minimum laisserait passer tout le grave d'une cymbale : la borne basse ne
  // vaut que pour un passe-bas, où elle empêche d'étouffer une note grave.
  filter.frequency.value =
    filter.type === 'highpass'
      ? clamp(note.freq * voice.filterRatio, 1200, 14000)
      : clamp(note.freq * voice.filterRatio, 400, 12000)
  filter.Q.value = voice.filterQ

  const panner = ctx.createStereoPanner()
  panner.pan.value = clamp(note.pan, -1, 1)

  carrier.connect(voiceGain)
  layer?.connect(voiceGain)
  noiseGain?.connect(voiceGain)
  voiceGain.connect(filter)
  filter.connect(panner)
  for (const destination of destinations) panner.connect(destination)

  const stopAt = startAt + lifetimeSeconds
  carrier.start(startAt)
  carrier.stop(stopAt)
  layer?.start(startAt)
  layer?.stop(stopAt)
  noise?.start(startAt)
  noise?.stop(stopAt)

  carrier.onended = () => {
    carrier.disconnect()
    layer?.disconnect()
    noise?.disconnect()
    noiseGain?.disconnect()
    voiceGain.disconnect()
    filter.disconnect()
    panner.disconnect()
  }
}

/**
 * Rend une salve de notes **hors ligne** et renvoie la crête et l'énergie du signal.
 *
 * C'est la seule façon de vérifier « ça ne sature pas » autrement qu'à l'oreille : `notes > 0` compte
 * des appels, pas des décibels. La chaîne reproduite est celle de la sortie réelle — même
 * `buildVoice`, même gain maître, même réverbe procédurale — sinon la mesure ne dirait rien de ce
 * qu'on entend.
 */
export async function measurePeak(
  notes: readonly NoteRequest[],
  seconds: number
): Promise<{ peak: number; rms: number }> {
  const sampleRate = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate)

  // Chaîne identique à la sortie réelle, **compresseur compris** : c'est lui la protection contre
  // l'écrêtage, et une mesure qui l'omettrait ne dirait rien de ce qu'on entend.
  const compressor = ctx.createDynamicsCompressor()
  configureLimiter(compressor)
  compressor.connect(ctx.destination)

  const master = ctx.createGain()
  master.gain.value = 1
  master.connect(compressor)

  const dry = ctx.createGain()
  dry.gain.value = DRY_GAIN
  dry.connect(master)

  const wet = ctx.createGain()
  wet.gain.value = WET_GAIN
  wet.connect(master)

  const conv = ctx.createConvolver()
  conv.buffer = buildReverbImpulse(ctx)
  conv.connect(wet)

  for (const note of notes) buildVoice(ctx, note, 0, [dry, conv])

  const rendered = await ctx.startRendering()
  let peak = 0
  let sum = 0
  let count = 0
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel)
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i] ?? 0)
      if (value > peak) peak = value
      sum += value * value
      count += 1
    }
  }
  return { peak, rms: count > 0 ? Math.sqrt(sum / count) : 0 }
}

/**
 * Même salve, mais mesurée **avant** le compresseur. Le compresseur garantit presque à lui seul
 * `crête < 1` : mesurer seulement après lui donnerait une assertion toujours verte. Ce qu'on veut aussi
 * savoir, c'est s'il travaille trop — un compresseur écrasé « pompe », et c'est un défaut audible même
 * sans écrêtage.
 */
export async function measurePeakBeforeCompressor(
  notes: readonly NoteRequest[],
  seconds: number
): Promise<number> {
  const sampleRate = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate)

  const master = ctx.createGain()
  master.gain.value = 1
  master.connect(ctx.destination)

  const dry = ctx.createGain()
  dry.gain.value = DRY_GAIN
  dry.connect(master)

  const wet = ctx.createGain()
  wet.gain.value = WET_GAIN
  wet.connect(master)

  const conv = ctx.createConvolver()
  conv.buffer = buildReverbImpulse(ctx)
  conv.connect(wet)

  for (const note of notes) buildVoice(ctx, note, 0, [dry, conv])

  const rendered = await ctx.startRendering()
  let peak = 0
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel)
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i] ?? 0)
      if (value > peak) peak = value
    }
  }
  return peak
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Impulsion de réverbe générée procéduralement : bruit blanc à décroissance exponentielle.
 * Évite toute dépendance à un fichier audio externe.
 */
/** graine du bruit percussif ; comme la réverbe, le timbre doit être identique d'une session à l'autre */
const NOISE_SEED = 0x9e3d
/** une seconde de bruit suffit : aucune percussion ne dure plus longtemps */
const NOISE_SECONDS = 1

/**
 * Tampon de bruit blanc, **mémorisé par contexte**. Le régénérer à chaque note coûterait 48 000 tirages
 * par percussion, et la chaîne hors ligne comme la chaîne réelle doivent entendre le même bruit.
 */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx)
  if (cached) return cached
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const rng = createRng(NOISE_SEED)
  for (let i = 0; i < length; i += 1) data[i] = rng() * 2 - 1
  noiseBuffers.set(ctx, buffer)
  return buffer
}

function buildReverbImpulse(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * REVERB_SECONDS)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  // RNG seedé plutôt que Math.random : le timbre de la réverbe doit être le même d'une session à
  // l'autre, et STRATEGY.md pose le déterminisme comme décision structurante du projet.
  const rng = createRng(REVERB_SEED)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      const decay = Math.pow(1 - i / length, 2.5)
      data[i] = (rng() * 2 - 1) * decay
    }
  }
  return buffer
}
