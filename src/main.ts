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
import type { Bar, Emitter, ImpactEvent, Vec2 } from './core/types'
import { MAX_BALLS, addEmitter, removeEmitter, runEmitters } from './core/emitter'
import { createHistory } from './core/history'
import { decodeScene, encodeScene, fromShared, toShared } from './core/share'
import type { SharedScene } from './core/share'
import { hitTestWorld } from './core/hit-test'
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
/** Ordre **figé** : l'index de gamme voyage dans l'URL, le réordonner casserait les liens existants. */
const TUNING_IDS = TUNINGS.map((candidate) => candidate.id)
let interaction: Interaction = { ...NO_INTERACTION }
let dragArea: SceneArea | null = null
/**
 * Instantané pris à la préhension mais **pas encore empilé** : au `pointerdown` on ne sait pas
 * encore si le geste va modifier quoi que ce soit. Taper une barre pour l'entendre est un geste
 * explicitement non destructif — il ne doit pas consommer une place d'annulation, et surtout pas
 * évincer l'instantané d'une vraie suppression.
 */
let pendingSnapshot: { bars: Bar[]; emitters: Emitter[] } | null = null
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
  for (let i = 0; i < steps; i++) {
    runEmitters(world, (pos, hue) => {
      spawnBall(world, { x: pos.x, y: pos.y }, { x: 0, y: 0 }, { hue })
    })
    handleImpacts(stepWorld(world, DT))
  }
}

function clearAll(): void {
  world.bars.length = 0
  world.balls.length = 0
  world.emitters.length = 0
  effects.clear()
  impactsTotal = 0
}

/**
 * Barres qui passent derrière un élément de HUD. Sans ce compteur, le chevauchement constaté sur un
 * téléphone en paysage n'était visible que sur une capture regardée à l'œil : aucune assertion ne
 * pouvait l'attraper, puisqu'il se joue à l'intérieur du canvas.
 */
function countUnderHud(): number {
  const hudRects = Array.from(document.querySelectorAll<HTMLElement>('[data-hud]'))
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)

  let count = 0
  for (const bar of world.bars) {
    if (hudRects.some((rect) => segmentIntersectsRect(bar.a, bar.b, rect))) count++
  }
  // Les sources comptent aussi : un compteur qui n'en regarde qu'une partie rend l'assertion
  // structurellement aveugle à la nouvelle entité.
  for (const emitter of world.emitters) {
    if (hudRects.some((rect) => segmentIntersectsRect(emitter.pos, emitter.pos, rect))) count++
  }
  return count
}

function outOfBounds(point: Vec2): boolean {
  return point.x < 0 || point.x > world.bounds.w || point.y < 0 || point.y > world.bounds.h
}

function countOutOfBounds(): number {
  let count = 0
  for (const bar of world.bars) {
    if (outOfBounds(bar.a) || outOfBounds(bar.b)) count++
  }
  for (const emitter of world.emitters) {
    if (outOfBounds(emitter.pos)) count++
  }
  return count
}

function loadSurprise(): void {
  clearAll()
  buildSurpriseScene(
    world.bounds,
    sceneSeed,
    {
      bar: (a, b) => {
        placeBar(a, b)
      },
      emitter: (pos) => {
        addEmitter(world, pos)
      },
    },
    measureSceneArea(world.bounds),
  )
}

/** Préfixe du fragment d'URL qui porte une scène. */
const SHARE_KEY = '#s='

/**
 * Repères du partage : **x rapporté à la largeur du viewport, y à la hauteur de la zone de jeu**.
 *
 * Deux essais avant celui-ci. Rapporter x à `area.left` faisait déborder le contenu de la différence
 * de marge entre deux écrans, et l'écrêtage qui suivait raccourcissait des barres. Rapporter *y* à la
 * largeur préservait les notes exactement — mais une scène de bureau s'ouvrait sur téléphone en un
 * bandeau écrasé dans le tiers haut, avec deux tiers d'écran vide : fidèle et laid.
 *
 * L'arbitrage est donc assumé : **la scène remplit l'écran du destinataire**, et la note des barres
 * les plus diagonales peut se décaler d'un degré. C'est imperceptible pour qui n'a pas l'original sous
 * les yeux, alors qu'un lien qui s'ouvre en bandeau minuscule ressemble à un produit cassé.
 */
function shareOrigin(): { x: number; y: number; width: number; height: number } {
  const area = measureSceneArea(world.bounds)
  return { x: 0, y: area.top, width: world.bounds.w, height: Math.max(1, area.bottom - area.top) }
}

function sharedScene(): SharedScene {
  const origin = shareOrigin()
  return {
    tuningId: tuning.id,
    bars: world.bars.map((bar) => ({
      mx: toShared((bar.a.x + bar.b.x) / 2, origin.x, origin.width),
      my: toShared((bar.a.y + bar.b.y) / 2, origin.y, origin.height),
      // La longueur est rapportée à la largeur : c'est elle qui porte la note.
      len: Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y) / origin.width,
      angle: Math.atan2(bar.b.y - bar.a.y, bar.b.x - bar.a.x),
    })),
    emitters: world.emitters.map((emitter) => ({
      x: toShared(emitter.pos.x, origin.x, origin.width),
      y: toShared(emitter.pos.y, origin.y, origin.height),
      period: emitter.period,
    })),
  }
}

function applyShared(shared: SharedScene): void {
  clearAll()
  applyTuning(tuningById(shared.tuningId))

  const area = measureSceneArea(world.bounds)
  const origin = shareOrigin()
  // Sur un écran proportionnellement plus court, une barre peut tomber sous la zone : on la borne
  // plutôt que de la laisser passer derrière le HUD. Seules les barres qui ne rentrent pas voient
  // leur note bouger — compromis assumé, et documenté au plan.
  const place = (fx: number, fy: number): Vec2 => ({
    x: Math.max(0, Math.min(world.bounds.w, fromShared(fx, origin.x, origin.width))),
    y: Math.max(area.top, Math.min(area.bottom, fromShared(fy, origin.y, origin.height))),
  })

  for (const bar of shared.bars) {
    // On repositionne le **milieu** puis on redessine la barre avec sa longueur (fraction de la
    // largeur) et son angle : la scène remplit l'écran du destinataire sans qu'aucune barre soit
    // déformée, donc sans qu'aucune note ne change.
    const mid = place(bar.mx, bar.my)
    const half = (bar.len * origin.width) / 2
    const dx = Math.cos(bar.angle) * half
    const dy = Math.sin(bar.angle) * half
    const [a, b] = fitInside({ x: mid.x - dx, y: mid.y - dy }, { x: mid.x + dx, y: mid.y + dy }, area)
    // Une barre courte sur grand écran devient plus courte que le minimum jouable sur un téléphone.
    // On l'allonge autour de son milieu au lieu de la refuser : perdre des barres d'un lien reçu est
    // pire qu'une note un peu plus aiguë sur les plus petites.
    placeBar(...atLeastPlayable(a, b))
  }
  for (const emitter of shared.emitters) {
    addEmitter(world, place(emitter.x, emitter.y), { period: emitter.period })
  }
  // La scène vient de quelqu'un d'autre : on ne la régénère pas au redimensionnement.
  userOwnsScene = true
}

/**
 * Fait rentrer un segment dans la zone en le **translatant**, pas en le raccourcissant : raccourcir
 * changerait sa note. Redessiner une barre depuis son milieu peut envoyer ses extrémités hors zone —
 * deux barres passaient derrière le HUD en paysage — alors qu'un simple décalage suffit presque
 * toujours. On ne borne un axe que si la barre y est plus grande que la zone, cas où aucune position
 * ne satisfait la contrainte (même raisonnement que le déplacement à la main, US3).
 */
function fitInside(a: Vec2, b: Vec2, area: SceneArea): [Vec2, Vec2] {
  const dx = clampDelta(0, Math.min(a.x, b.x), Math.max(a.x, b.x), area.left, area.right)
  const dy = clampDelta(0, Math.min(a.y, b.y), Math.max(a.y, b.y), area.top, area.bottom)
  return [
    { x: a.x + dx, y: a.y + dy },
    { x: b.x + dx, y: b.y + dy },
  ]
}

/** Étire un segment autour de son milieu jusqu'à la longueur minimale jouable, s'il est trop court. */
function atLeastPlayable(a: Vec2, b: Vec2): [Vec2, Vec2] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length >= MIN_BAR_LENGTH) return [a, b]

  const midX = (a.x + b.x) / 2
  const midY = (a.y + b.y) / 2
  // Marge de 2 % : étirer à exactement le minimum laissait l'arrondi flottant repasser sous le seuil,
  // et `placeBar` refusait la barre — une barre perdue à chaque ouverture de lien sur petit écran.
  const half = (MIN_BAR_LENGTH * 1.02) / 2
  const ux = length < 1e-6 ? 1 : dx / length
  const uy = length < 1e-6 ? 0 : dy / length
  return [
    { x: midX - ux * half, y: midY - uy * half },
    { x: midX + ux * half, y: midY + uy * half },
  ]
}

function shareLink(): string {
  return `${location.origin}${location.pathname}${SHARE_KEY}${encodeScene(sharedScene(), TUNING_IDS)}`
}

/** Scène portée par l'URL, ou `null`. Un lien illisible rend `null`, jamais une erreur. */
function sceneFromUrl(): SharedScene | null {
  const hash = location.hash
  if (!hash.startsWith(SHARE_KEY)) return null
  return decodeScene(hash.slice(SHARE_KEY.length), TUNING_IDS)
}

let announceTimer: ReturnType<typeof setTimeout> | null = null
const hintTemplate = hint?.innerHTML ?? ''

/**
 * Message éphémère, affiché dans la pastille d'astuce plutôt que dans un élément dédié : elle est déjà
 * la zone que l'œil regarde après une action, et l'ajouter ailleurs mangerait de la hauteur de jeu.
 */
function announce(text: string): void {
  if (!hint) return
  hint.textContent = text
  hint.removeAttribute('data-faded')
  if (announceTimer !== null) clearTimeout(announceTimer)
  announceTimer = setTimeout(() => {
    hint.innerHTML = hintTemplate
    if (interacted) hint.setAttribute('data-faded', 'true')
  }, 2200)
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
  history.push(pendingSnapshot.bars, pendingSnapshot.emitters, tuning.id)
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
  world.emitters.length = 0
  world.emitters.push(...restored.emitters)
  // Réarmer les échéances : un instantané ne porte pas de temps (cf. history.cloneEmitter), sinon
  // annuler ferait cracher une rafale de billes pour rattraper un retard fictif.
  for (const emitter of world.emitters) emitter.nextAt = world.time + emitter.period
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
      interaction =
        gesture.hit?.target === 'bar'
          ? { ...NO_INTERACTION, hoveredBarId: gesture.hit.bar.id, hoveredKind: gesture.hit.kind }
          : { ...NO_INTERACTION, hoveredEmitterId: gesture.hit?.emitter.id ?? null }
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
      history.push(world.bars, world.emitters, tuning.id)
      if (placeBar(gesture.a, gesture.b)) userOwnsScene = true
      fadeHint()
      break

    case 'long-press':
      // Appui long dans le vide : pose une source. C'est le seul idiome qui n'introduit pas de mode
      // et ne vole aucun geste existant.
      history.push(world.bars, world.emitters, tuning.id)
      {
        // Bornée à la création comme au déplacement : le HUD ne capture pas le pointeur (l'overlay
        // est en `pointer-events: none`), donc un appui long sur le titre poserait une source
        // derrière lui, hors d'atteinte.
        const area = measureSceneArea(world.bounds)
        addEmitter(world, {
          x: Math.max(area.left, Math.min(area.right, gesture.point.x)),
          y: Math.max(area.top, Math.min(area.bottom, gesture.point.y)),
        })
      }
      userOwnsScene = true
      fadeHint()
      break

    case 'drop-ball':
      dropBall(gesture.point)
      fadeHint()
      break

    case 'grab':
      pendingSnapshot = {
        bars: world.bars.map((bar) => ({ ...bar, a: { ...bar.a }, b: { ...bar.b } })),
        emitters: world.emitters.map((emitter) => ({ ...emitter, pos: { ...emitter.pos } })),
      }
      // Zone mesurée une fois par geste, pas à chaque mouvement : lire le DOM à 120 Hz pendant un
      // glisser force un recalcul de mise en page à chaque frame.
      dragArea = measureSceneArea(world.bounds)
      interaction =
        gesture.hit.target === 'bar'
          ? { ...NO_INTERACTION, hoveredBarId: gesture.hit.bar.id, hoveredKind: gesture.hit.kind }
          : { ...NO_INTERACTION, hoveredEmitterId: gesture.hit.emitter.id }
      fadeHint()
      break

    case 'drag': {
      const area = dragArea ?? measureSceneArea(world.bounds)
      commitPending()
      userOwnsScene = true

      if (gesture.hit.target === 'emitter') {
        const { emitter } = gesture.hit
        emitter.pos.x = Math.max(area.left, Math.min(area.right, gesture.point.x))
        emitter.pos.y = Math.max(area.top, Math.min(area.bottom, gesture.point.y))
        const doomed = inDeleteZone(gesture.point)
        interaction = {
          ...NO_INTERACTION,
          hoveredEmitterId: emitter.id,
          pendingDeleteEmitterId: doomed ? emitter.id : null,
        }
        break
      }

      const { bar } = gesture.hit
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
        ...NO_INTERACTION,
        hoveredBarId: bar.id,
        hoveredKind: gesture.hit.kind,
        pendingDeleteBarId: pendingDelete ? bar.id : null,
      }
      draft = pendingDelete
        ? null
        : { a: bar.a, b: bar.b, label: labelFor(Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y)) }
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
        if (gesture.hit.target === 'bar') removeBar(gesture.hit.bar.id)
        else removeEmitter(world, gesture.hit.emitter.id)
      } else if (gesture.hit.target === 'bar') {
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
      if (gesture.hit.target === 'bar') {
        playBar(gesture.hit.bar, 0.65)
        gesture.hit.bar.lastHitAt = world.time
      }
      fadeHint()
      break
  }
}

attachInput(canvas, {
  onFirstGesture() {
    void audio.unlock()
  },
  hitTest: (point, radii) => hitTestWorld(world.bars, world.emitters, point, radii),
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
          history.push(world.bars, world.emitters, tuning.id)
          applyTuning(next)
        }
        break
      }
      case 'share': {
        const link = shareLink()
        // `window.history` explicitement : `history` désigne ici l'historique d'annulation du produit.
        // Et `replaceState` plutôt que `pushState` : sinon chaque partage ajoute une entrée et le
        // bouton « retour » du navigateur devient inutilisable.
        window.history.replaceState(null, '', link)
        void navigator.clipboard?.writeText(link).then(
          () => announce('Lien copié'),
          // Le presse-papiers peut être refusé (permission, contexte non sécurisé) : l'URL est à jour
          // dans la barre d'adresse de toute façon, donc le partage reste possible.
          () => announce('Lien dans la barre d’adresse'),
        )
        break
      }
      case 'undo':
        undo()
        break
      case 'surprise':
        history.push(world.bars, world.emitters, tuning.id)
        sceneSeed += 1
        userOwnsScene = false
        loadSurprise()
        break
      case 'clear':
        history.push(world.bars, world.emitters, tuning.id)
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
    // Les sources émettent avant l'intégration du pas : une bille créée doit être simulée dès le pas
    // où elle apparaît, sinon elle « saute » d'un pas au premier affichage.
    runEmitters(world, (pos, hue) => {
      spawnBall(world, { x: pos.x, y: pos.y }, { x: 0, y: 0 }, { hue })
    })
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
const linked = sceneFromUrl()
if (linked) applyShared(linked)
else loadSurprise()
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
  shareLink(): string
  loadShared(code: string): boolean
  addEmitter(x: number, y: number, period?: number): number
  emitters(): Array<{ id: number; x: number; y: number; period: number }>
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
    /** nombre de sources périodiques posées */
    emitters: number
    /** plafond de billes vivantes, exposé pour que le harnais n'ait pas à le deviner */
    maxBalls: number
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
  shareLink,
  loadShared: (code) => {
    const shared = decodeScene(code, TUNING_IDS)
    if (!shared) return false
    applyShared(shared)
    return true
  },
  addEmitter: (x, y, period) =>
    addEmitter(world, { x, y }, period === undefined ? {} : { period }).id,
  emitters: () =>
    world.emitters.map((emitter) => ({
      id: emitter.id,
      x: emitter.pos.x,
      y: emitter.pos.y,
      period: emitter.period,
    })),
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
    barsOutOfBounds: countOutOfBounds(),
    barsUnderHud: countUnderHud(),
    tuning: tuning.id,
    undoDepth: history.depth(),
    emitters: world.emitters.length,
    maxBalls: MAX_BALLS,
    distinctPitches: new Set(world.bars.map((bar) => bar.midi)).size,
  }),
}
