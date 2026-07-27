import { createAudioEngine } from './audio/engine'
import {
  DEFAULT_TUNING,
  TUNINGS,
  gainForImpact,
  midiForLength,
  midiToFreq,
  panForX,
  retuneBars,
  tuningById,
} from './core/music'
import type { Tuning } from './core/music'
import { DT, addBar, createWorld, spawnBall, stepWorld } from './core/physics'
import type { Bar, ImpactEvent, Vec2 } from './core/types'
import { attachInput } from './ui/input'
import { noteName } from './ui/notation'
import { createEffects, createRenderer } from './ui/renderer'
import { buildSurpriseScene } from './ui/scene'
import { measureSceneArea, segmentIntersectsRect } from './ui/scene-area'
import type { Draft } from './ui/renderer'

const MIN_BAR_LENGTH = 24
/**
 * Retard maximal que la boucle accepte de rattraper en une frame. Au-delà, on abandonne le reliquat
 * plutôt que de spiraler — cas d'un onglet resté caché, pas d'une simulation trop lente.
 * L'écrêtage du temps écoulé et le budget de pas doivent décrire **le même** budget : quand les deux
 * divergeaient (250 ms d'un côté, 10 pas ≈ 83 ms de l'autre), toute frame longue jetait du temps
 * simulé par construction.
 */
const MAX_CATCH_UP_SECONDS = 0.25
const MAX_STEPS_PER_FRAME = Math.round(MAX_CATCH_UP_SECONDS / DT)

const canvas = document.querySelector<HTMLCanvasElement>('#stage')
const hint = document.querySelector<HTMLParagraphElement>('#hint')
const tuningLabel = document.querySelector<HTMLSpanElement>('#tuning-label')
if (!canvas) throw new Error('Élément #stage introuvable')

const renderer = createRenderer(canvas)
const effects = createEffects()
const audio = createAudioEngine()
const world = createWorld(renderer.resize())

let draft: Draft | null = null
let impactsTotal = 0
let droppedSteps = 0
let fps = 60
let sceneSeed = 7
let interacted = false
/** Vrai dès que la scène appartient à l'utilisateur : on ne la régénère plus sous ses doigts. */
let userOwnsScene = false
let tuning: Tuning = DEFAULT_TUNING

function placeBar(a: Vec2, b: Vec2): Bar | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < MIN_BAR_LENGTH) return null
  return addBar(world, a, b, midiForLength(length, tuning, world.bounds.w))
}

function applyTuning(next: Tuning): void {
  tuning = next
  if (tuningLabel) tuningLabel.textContent = tuning.label
  // Réaccorder ce qui est déjà posé : sans ça, changer de gamme ne s'entendrait qu'aux barres
  // suivantes, et la boucle « je change, j'entends » ne se ferme pas.
  retuneBars(world.bars, tuning, world.bounds.w)
}

function dropBall(point: Vec2): number {
  // Teintes froides pour les billes : la couleur chaude est réservée aux barres, qui portent la hauteur.
  const hue = 190 + ((world.nextBallId * 37) % 90)
  return spawnBall(world, point, { x: 0, y: 0 }, { hue }).id
}

function handleImpacts(events: readonly ImpactEvent[]): void {
  for (const event of events) {
    // Résolution directe dans `world.bars` (quelques dizaines d'entrées, quelques impacts par
    // frame) : un index parallèle serait un état redondant, qu'une suppression de barre en US3
    // désynchroniserait en silence.
    const bar = world.bars.find((candidate) => candidate.id === event.barId)
    if (!bar) continue
    impactsTotal++
    const gain = gainForImpact(event.speed)
    if (gain <= 0) continue
    audio.play({
      barId: bar.id,
      freq: midiToFreq(bar.midi),
      gain,
      pan: panForX(event.point.x, world.bounds.w),
    })
    effects.addImpact(event, bar.midi, gain)
  }
}

function advance(seconds: number): void {
  const steps = Math.max(0, Math.round(seconds / DT))
  for (let i = 0; i < steps; i++) handleImpacts(stepWorld(world, DT))
}

function clearAll(): void {
  world.bars.length = 0
  world.balls.length = 0
  effects.clear()
  impactsTotal = 0
}

/**
 * Barres qui passent derrière un élément de HUD. Sans ce compteur, le chevauchement constaté sur un
 * téléphone en paysage n'était visible que sur une capture regardée à l'œil : aucune assertion ne
 * pouvait l'attraper, puisqu'il se joue à l'intérieur du canvas.
 */
function countBarsUnderHud(): number {
  const hudRects = Array.from(document.querySelectorAll<HTMLElement>('[data-hud]'))
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)

  let count = 0
  for (const bar of world.bars) {
    if (hudRects.some((rect) => segmentIntersectsRect(bar.a, bar.b, rect))) count++
  }
  return count
}

function countBarsOutOfBounds(): number {
  let count = 0
  for (const bar of world.bars) {
    for (const point of [bar.a, bar.b]) {
      if (point.x < 0 || point.x > world.bounds.w || point.y < 0 || point.y > world.bounds.h) {
        count++
        break
      }
    }
  }
  return count
}

function loadSurprise(): void {
  clearAll()
  buildSurpriseScene(
    world.bounds,
    sceneSeed,
    (a, b) => {
      placeBar(a, b)
    },
    measureSceneArea(world.bounds),
  )
}

function fadeHint(): void {
  if (interacted) return
  interacted = true
  hint?.setAttribute('data-faded', 'true')
}

attachInput(canvas, {
  onFirstGesture() {
    void audio.unlock()
  },
  onTap(point) {
    dropBall(point)
    fadeHint()
  },
  onBar(a, b) {
    if (placeBar(a, b)) userOwnsScene = true
    fadeHint()
  },
  onDraft(next) {
    if (!next) {
      draft = null
      return
    }
    const length = Math.hypot(next.b.x - next.a.x, next.b.y - next.a.y)
    draft = {
      a: next.a,
      b: next.b,
      label:
        length < MIN_BAR_LENGTH
          ? '—'
          : noteName(midiForLength(length, tuning, world.bounds.w)),
    }
  },
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
  button.addEventListener('click', () => {
    void audio.unlock()
    fadeHint()
    switch (button.dataset.control) {
      case 'tuning': {
        const index = TUNINGS.findIndex((candidate) => candidate.id === tuning.id)
        const next = TUNINGS[(index + 1) % TUNINGS.length]
        if (next) applyTuning(next)
        break
      }
      case 'surprise':
        sceneSeed += 1
        userOwnsScene = false
        loadSurprise()
        break
      case 'clear':
        userOwnsScene = true
        clearAll()
        break
      case 'mute': {
        const muted = !audio.muted()
        audio.setMuted(muted)
        button.setAttribute('aria-pressed', String(muted))
        button.textContent = muted ? 'Son coupé' : 'Son activé'
        break
      }
    }
  })
}

const resizeObserver = new ResizeObserver(() => {
  world.bounds = renderer.resize()
  // La scène générée est calculée pour un viewport donné : après une rotation d'écran ou un
  // redimensionnement de fenêtre, elle resterait hors champ. On la reconstruit à graine identique,
  // donc à l'identique, sauf si la scène appartient désormais à l'utilisateur.
  if (!userOwnsScene) loadSurprise()
})
resizeObserver.observe(canvas)

let previous: number | null = null
let accumulator = 0

function frame(now: number): void {
  // La première frame arrive longtemps après l'évaluation du module (chargement, premier paint) :
  // mesurer cet écart reviendrait à simuler un quart de seconde d'un coup dès le démarrage, et à en
  // jeter la moitié. Elle ne compte donc que pour un pas.
  const elapsed =
    previous === null ? DT : Math.min((now - previous) / 1000, MAX_CATCH_UP_SECONDS)
  previous = now
  if (elapsed > 0) fps += (1 / elapsed - fps) * 0.08

  accumulator += elapsed
  let steps = 0
  while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
    accumulator -= DT
    steps++
    handleImpacts(stepWorld(world, DT))
  }
  if (steps === MAX_STEPS_PER_FRAME) {
    // On jette le retard accumulé plutôt que de spiraler, mais on le compte : sinon la simulation
    // tournerait au ralenti en silence, avec des fps parfaits — c'est exactement le genre de panne
    // qu'aucune mesure de framerate ne révèle.
    droppedSteps += Math.floor(accumulator / DT)
    accumulator = 0
  }

  // Les effets avancent en temps **simulé**, pas en temps mural : après un écrêtage, les deux
  // horloges dériveraient et les ondes ne colleraient plus aux impacts.
  effects.advance(steps * DT)
  renderer.draw(world, effects, draft)
  requestAnimationFrame(frame)
}

// Le libellé de gamme est écrit depuis l'état, jamais laissé au littéral HTML : sinon l'UI pourrait
// annoncer une gamme que l'instrument ne joue pas, et rien ne le signalerait.
applyTuning(DEFAULT_TUNING)
loadSurprise()
requestAnimationFrame(frame)

interface CarillonDebug {
  version: 1
  addBar(ax: number, ay: number, bx: number, by: number): number
  dropBall(x: number, y: number): number
  advance(seconds: number): void
  reset(): void
  setMuted(muted: boolean): void
  setTuning(id: string): void
  stats(): {
    fps: number
    balls: number
    bars: number
    /** collisions physiques, y compris celles trop douces pour sonner */
    impacts: number
    /** voix audio réellement jouées ; toujours ≤ impacts */
    notes: number
    /** pas de simulation abandonnés faute de temps ; doit rester à 0 */
    droppedSteps: number
    /** barres dont une extrémité sort du viewport ; doit rester à 0 */
    barsOutOfBounds: number
    /** barres qui passent derrière un élément de HUD ; doit rester à 0 */
    barsUnderHud: number
    /** identifiant de la gamme courante */
    tuning: string
    /** nombre de hauteurs distinctes présentes sur la scène — mesure la richesse musicale */
    distinctPitches: number
  }
}

declare global {
  interface Window {
    __carillon?: CarillonDebug
  }
}

window.__carillon = {
  version: 1,
  addBar: (ax, ay, bx, by) => placeBar({ x: ax, y: ay }, { x: bx, y: by })?.id ?? -1,
  dropBall: (x, y) => dropBall({ x, y }),
  advance,
  reset: () => {
    userOwnsScene = true
    clearAll()
  },
  setMuted: (muted) => audio.setMuted(muted),
  setTuning: (id) => applyTuning(tuningById(id)),
  stats: () => ({
    fps: Math.round(fps),
    balls: world.balls.length,
    bars: world.bars.length,
    impacts: impactsTotal,
    notes: audio.playedCount(),
    droppedSteps,
    barsOutOfBounds: countBarsOutOfBounds(),
    barsUnderHud: countBarsUnderHud(),
    tuning: tuning.id,
    distinctPitches: new Set(world.bars.map((bar) => bar.midi)).size,
  }),
}
