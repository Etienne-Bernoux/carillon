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
import { createHistory } from './core/history'
import { hitTestBars } from './core/hit-test'
import { attachInput } from './ui/input'
import type { Gesture } from './ui/input'
import { noteName } from './ui/notation'
import { NO_INTERACTION, createEffects, createRenderer } from './ui/renderer'
import { buildSurpriseScene } from './ui/scene'
import { measureSceneArea, segmentIntersectsRect } from './ui/scene-area'
import type { SceneArea } from './ui/scene'
import type { Draft, Interaction } from './ui/renderer'

const MIN_BAR_LENGTH = 24
/** Largeur de la bande, au bord de l'écran, où relâcher une barre la supprime. */
const DELETE_EDGE = 14
/**
 * Retard maximal que la boucle accepte de rattraper en une frame. Au-delà, on abandonne le reliquat
 * plutôt que de spiraler — cas d'un onglet resté caché, pas d'une simulation trop lente.
 * L'écrêtage du temps écoulé et le budget de pas doivent décrire **le même** budget : quand les deux
 * divergeaient (250 ms d'un côté, 10 pas ≈ 83 ms de l'autre), toute frame longue jetait du temps
 * simulé par construction.
 */
const MAX_CATCH_UP_SECONDS = 0.25
const MAX_STEPS_PER_FRAME = Math.round(MAX_CATCH_UP_SECONDS / DT)

/**
 * Le narrowing d'un `const` ne traverse pas une fonction déclarée (hoisting) : un `if (!canvas)
 * throw` ne suffit donc pas à rendre `canvas` non-nullable dans les gestionnaires de gestes.
 * On rend le type honnête une fois, plutôt que de re-tester partout.
 * Cf. docs/solutions/narrowing-typescript-et-hoisting.md
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Élément ${selector} introuvable`)
  return element
}

const canvas = requireElement<HTMLCanvasElement>('#stage')
const hint = document.querySelector<HTMLParagraphElement>('#hint')
const tuningLabel = document.querySelector<HTMLSpanElement>('#tuning-label')

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
let interaction: Interaction = { ...NO_INTERACTION }
let dragArea: SceneArea | null = null
/**
 * Instantané pris à la préhension mais **pas encore empilé** : au `pointerdown` on ne sait pas
 * encore si le geste va modifier quoi que ce soit. Taper une barre pour l'entendre est un geste
 * explicitement non destructif — il ne doit pas consommer une place d'annulation, et surtout pas
 * évincer l'instantané d'une vraie suppression.
 */
let pendingSnapshot: Bar[] | null = null
const history = createHistory()

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

function labelFor(length: number): string {
  return length < MIN_BAR_LENGTH ? '—' : noteName(midiForLength(length, tuning, world.bounds.w))
}

/** Vrai si relâcher ici jette la barre. Bande au bord de l'écran, atteignable au doigt. */
function inDeleteZone(point: Vec2): boolean {
  return (
    point.x <= DELETE_EDGE ||
    point.y <= DELETE_EDGE ||
    point.x >= world.bounds.w - DELETE_EDGE ||
    point.y >= world.bounds.h - DELETE_EDGE
  )
}

function playBar(bar: Bar, gain: number): void {
  audio.play({
    barId: bar.id,
    freq: midiToFreq(bar.midi),
    gain,
    pan: panForX((bar.a.x + bar.b.x) / 2, world.bounds.w),
  })
}

function removeBar(id: number): void {
  const index = world.bars.findIndex((bar) => bar.id === id)
  if (index >= 0) world.bars.splice(index, 1)
}

/** Valide l'instantané de préhension au moment où le geste devient réellement modifiant. */
function commitPending(): void {
  if (!pendingSnapshot) return
  history.push(pendingSnapshot, tuning.id)
  pendingSnapshot = null
}

/**
 * Borne un déplacement pour garder la barre dans la zone — **sauf** si elle est plus grande que la
 * zone sur cet axe, cas où aucune position ne satisfait la contrainte et où borner reviendrait à
 * imposer un mouvement puis à figer la barre contre le bord.
 */
function clampDelta(delta: number, min: number, max: number, low: number, high: number): number {
  if (max - min > high - low) return delta
  return Math.max(low - min, Math.min(high - max, delta))
}

/** Repousse `target` sur le cercle de rayon MIN_BAR_LENGTH autour de `anchor` s'il est trop près. */
function extendToMinLength(anchor: Vec2, target: Vec2): Vec2 {
  const dx = target.x - anchor.x
  const dy = target.y - anchor.y
  const length = Math.hypot(dx, dy)
  if (length >= MIN_BAR_LENGTH) return target
  if (length < 1e-6) return { x: anchor.x + MIN_BAR_LENGTH, y: anchor.y }
  const scale = MIN_BAR_LENGTH / length
  return { x: anchor.x + dx * scale, y: anchor.y + dy * scale }
}

function undo(): void {
  const restored = history.undo()
  if (!restored) return
  world.bars.length = 0
  world.bars.push(...restored.bars)
  // La gamme fait partie de l'état : sans ça, annuler un changement de gamme réaccordait les barres
  // mais laissait le libellé — donc l'interface annonçait une gamme que l'instrument ne jouait plus.
  if (restored.tuningId !== tuning.id) applyTuning(tuningById(restored.tuningId))
  pendingSnapshot = null
  interaction = { ...NO_INTERACTION }
  userOwnsScene = true
}

function handleGesture(gesture: Gesture): void {
  switch (gesture.type) {
    case 'hover':
      interaction = {
        hoveredBarId: gesture.hit?.bar.id ?? null,
        hoveredKind: gesture.hit?.kind ?? null,
        pendingDeleteBarId: null,
      }
      canvas.style.cursor = gesture.hit ? 'grab' : 'crosshair'
      break

    case 'draft': {
      const length = Math.hypot(gesture.b.x - gesture.a.x, gesture.b.y - gesture.a.y)
      draft = { a: gesture.a, b: gesture.b, label: labelFor(length) }
      break
    }

    case 'draft-cancel':
      draft = null
      break

    case 'create-bar':
      // L'instantané est pris avant la modification, jamais après : c'est ce qui rend l'annulation
      // capable de faire disparaître la barre qu'on vient de créer.
      history.push(world.bars, tuning.id)
      if (placeBar(gesture.a, gesture.b)) userOwnsScene = true
      fadeHint()
      break

    case 'drop-ball':
      dropBall(gesture.point)
      fadeHint()
      break

    case 'grab':
      pendingSnapshot = world.bars.map((bar) => ({ ...bar, a: { ...bar.a }, b: { ...bar.b } }))
      // Zone mesurée une fois par geste, pas à chaque mouvement : lire le DOM à 120 Hz pendant un
      // glisser force un recalcul de mise en page à chaque frame.
      dragArea = measureSceneArea(world.bounds)
      interaction = {
        hoveredBarId: gesture.hit.bar.id,
        hoveredKind: gesture.hit.kind,
        pendingDeleteBarId: null,
      }
      fadeHint()
      break

    case 'drag': {
      const { bar } = gesture.hit
      const area = dragArea ?? measureSceneArea(world.bounds)
      commitPending()
      if (gesture.hit.kind === 'body') {
        // On borne le **déplacement**, pas les extrémités : borner chaque extrémité séparément
        // raccourcirait la barre contre un bord, donc changerait sa note — un déplacement doit
        // conserver la hauteur (critère C2). La barre butte, le pointeur continue, et c'est lui qui
        // décide de la suppression : on peut donc encore jeter une barre par le bord.
        const minX = Math.min(bar.a.x, bar.b.x)
        const maxX = Math.max(bar.a.x, bar.b.x)
        const minY = Math.min(bar.a.y, bar.b.y)
        const maxY = Math.max(bar.a.y, bar.b.y)
        // Une barre plus large que la zone ne peut pas y tenir : la borner imposerait un déplacement
        // dans un sens quel que soit le geste, puis la figerait contre le bord. On la laisse libre
        // sur cet axe.
        const dx = clampDelta(gesture.delta.x, minX, maxX, area.left, area.right)
        const dy = clampDelta(gesture.delta.y, minY, maxY, area.top, area.bottom)
        for (const point of [bar.a, bar.b]) {
          point.x += dx
          point.y += dy
        }
      } else {
        // Étirer par une extrémité : l'autre ne bouge pas, et la note suit la nouvelle longueur.
        const end = gesture.hit.kind === 'endA' ? bar.a : bar.b
        const anchor = gesture.hit.kind === 'endA' ? bar.b : bar.a
        const target = {
          x: Math.max(area.left, Math.min(area.right, gesture.point.x)),
          y: Math.max(area.top, Math.min(area.bottom, gesture.point.y)),
        }
        // Plancher de longueur, sinon on peut réduire une barre à zéro : elle devient invisible,
        // l'étiquette annonce « — » et la note jouée est celle de la plus courte possible. La
        // création interdit déjà ça, l'édition doit tenir le même invariant.
        const pushed = extendToMinLength(anchor, target)
        end.x = pushed.x
        end.y = pushed.y
        bar.midi = midiForLength(
          Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y),
          tuning,
          world.bounds.w,
        )
      }
      const pendingDelete = inDeleteZone(gesture.point)
      interaction = {
        hoveredBarId: bar.id,
        hoveredKind: gesture.hit.kind,
        pendingDeleteBarId: pendingDelete ? bar.id : null,
      }
      draft = pendingDelete
        ? null
        : { a: bar.a, b: bar.b, label: labelFor(Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y)) }
      userOwnsScene = true
      break
    }

    case 'release':
      draft = null
      dragArea = null
      // Une interruption système (geste de bord du navigateur, appel entrant) ne doit pas être lue
      // comme une intention de jeter la barre.
      if (gesture.cancelled) {
        pendingSnapshot = null
      } else if (inDeleteZone(gesture.point)) {
        commitPending()
        removeBar(gesture.hit.bar.id)
      } else {
        playBar(gesture.hit.bar, 0.5)
      }
      pendingSnapshot = null
      interaction = { ...NO_INTERACTION }
      break

    case 'tap-bar':
      // Aucun instantané validé : écouter une barre ne modifie rien.
      pendingSnapshot = null
      // Taper une barre la fait sonner sans rien modifier : c'est comment on apprend la
      // correspondance entre la couleur d'une barre et sa hauteur.
      playBar(gesture.hit.bar, 0.65)
      gesture.hit.bar.lastHitAt = world.time
      fadeHint()
      break
  }
}

attachInput(canvas, {
  onFirstGesture() {
    void audio.unlock()
  },
  hitTest: (point, radii) => hitTestBars(world.bars, point, radii),
  onGesture: handleGesture,
})

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    undo()
  }
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
  button.addEventListener('click', () => {
    void audio.unlock()
    fadeHint()
    switch (button.dataset.control) {
      case 'tuning': {
        const index = TUNINGS.findIndex((candidate) => candidate.id === tuning.id)
        const next = TUNINGS[(index + 1) % TUNINGS.length]
        if (next) {
          // L'instantané porte la gamme d'**avant** le changement : c'est elle qu'il faut restaurer.
          history.push(world.bars, tuning.id)
          applyTuning(next)
        }
        break
      }
      case 'undo':
        undo()
        break
      case 'surprise':
        history.push(world.bars, tuning.id)
        sceneSeed += 1
        userOwnsScene = false
        loadSurprise()
        break
      case 'clear':
        history.push(world.bars, tuning.id)
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
  renderer.draw(world, effects, draft, interaction)
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
  undo(): void
  /** Géométrie des barres : sans elle, toute assertion sur un déplacement passerait par des pixels. */
  bars(): Array<{ id: number; ax: number; ay: number; bx: number; by: number; midi: number }>
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
    /** nombre de gestes annulables empilés */
    undoDepth: number
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
  undo,
  bars: () =>
    world.bars.map((bar) => ({
      id: bar.id,
      ax: bar.a.x,
      ay: bar.a.y,
      bx: bar.b.x,
      by: bar.b.y,
      midi: bar.midi,
    })),
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
    undoDepth: history.depth(),
    distinctPitches: new Set(world.bars.map((bar) => bar.midi)).size,
  }),
}
