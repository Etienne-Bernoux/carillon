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
}

/** graine de l'impulsion de réverbe : le timbre doit être identique d'une session à l'autre */
const REVERB_SEED = 0x5eed

/** durée de la queue de réverbe procédurale, en secondes */
const REVERB_SECONDS = 1.8

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
    compressorNode.connect(ctx.destination)

    const master = ctx.createGain()
    master.gain.value = isMuted ? 0 : 1
    master.connect(compressorNode)

    const dry = ctx.createGain()
    dry.gain.value = 0.8
    dry.connect(master)

    const wet = ctx.createGain()
    wet.gain.value = 0.25
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

    const peakGain = clamp(note.gain, 0, 1)

    const carrier = ctx.createOscillator()
    carrier.type = voice.wave
    carrier.frequency.value = note.freq

    // Seconde couche **optionnelle** : une voix nue (le marimba aigu) doit pouvoir l'être vraiment.
    // Créer un oscillateur muet à la place coûterait du CPU pour rien à chaque note.
    const layer = voice.layer ? ctx.createOscillator() : null
    if (layer && voice.layer) {
      layer.type = voice.layer
      layer.frequency.value = note.freq
      layer.detune.value = voice.detuneCents
    }

    const voiceGain = ctx.createGain()
    voiceGain.gain.setValueAtTime(0.0001, now)
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(peakGain, 0.0001), now + voice.attackSeconds)
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + voice.attackSeconds + decaySeconds)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = clamp(note.freq * voice.filterRatio, 400, 12000)
    filter.Q.value = voice.filterQ

    const panner = ctx.createStereoPanner()
    panner.pan.value = clamp(note.pan, -1, 1)

    carrier.connect(voiceGain)
    layer?.connect(voiceGain)
    voiceGain.connect(filter)
    filter.connect(panner)
    panner.connect(dryGain)
    panner.connect(convolver)

    const stopAt = now + lifetimeSeconds
    carrier.start(now)
    carrier.stop(stopAt)
    layer?.start(now)
    layer?.stop(stopAt)

    carrier.onended = () => {
      carrier.disconnect()
      layer?.disconnect()
      voiceGain.disconnect()
      filter.disconnect()
      panner.disconnect()
    }

    played += 1
  }

  return { unlock, ready, play, setMuted, muted, playedCount }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Impulsion de réverbe générée procéduralement : bruit blanc à décroissance exponentielle.
 * Évite toute dépendance à un fichier audio externe.
 */
function buildReverbImpulse(ctx: AudioContext): AudioBuffer {
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
