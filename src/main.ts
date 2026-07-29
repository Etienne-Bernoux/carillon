import { createAudioEngine } from './audio/engine'
import { measurePeak, measurePeakBeforeCompressor } from './audio/engine'
import type { NoteRequest } from './audio/engine'
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
import {
  MAX_BALLS,
  addEmitter,
  cycleDivision,
  emitterPeriod,
  removeEmitter,
  runEmitters,
  runRespawns,
} from './core/emitter'
import { divisionAt, divisionLabel, gridTimeAfter, nearestDivisionIndex } from './core/clock'
import { createHistory } from './core/history'
import { cycleNature, natureLabel } from './core/nature'
import {
  DEFAULT_INSTRUMENT,
  INSTRUMENTS,
  decayForNote,
  voiceForMidi,
} from './core/instruments'
import type { Instrument } from './core/instruments'
import { MAX_PARTICLES } from './core/particles'
import { decodeScene, encodeScene } from './core/share'
import type { SharedScene } from './core/share'
import { placeSharedBar, placeSharedEmitter, toSharedBar, toSharedPoint } from './core/share-layout'
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
const tuningLabelShort = document.querySelector<HTMLSpanElement>('#tuning-label-short')
const instrumentLabel = document.querySelector<HTMLSpanElement>('#instrument-label')
const instrumentLabelShort = document.querySelector<HTMLSpanElement>('#instrument-label-short')
const muteLabel = document.querySelector<HTMLSpanElement>('#mute-label')

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
/**
 * Instrument courant. C'est un réglage de **lecture**, pas une donnée de scène : il ne change aucune
 * hauteur, seulement le timbre. Il vit donc hors de l'historique et hors du lien de partage, exactement
 * comme le silence — alors que la gamme, elle, réaccorde les barres et fait partie de l'état.
 */
let instrument: Instrument = DEFAULT_INSTRUMENT

/**
 * Temps de simulation jusqu'auquel les poignées de toutes les barres restent visibles. Déclenché par
 * le premier contact tactile : sans survol au doigt, rien n'annonçait qu'une barre s'attrape.
 */
let revealHandlesUntil = -1
const REVEAL_HANDLES_SECONDS = 5
let dragArea: SceneArea | null = null
/**
 * Scène reçue par lien, gardée telle quelle. Deux raisons, toutes deux trouvées en revue :
 * — au redimensionnement, on la **replace** depuis ses fractions au lieu de laisser des pixels
 *   absolus qui finissent derrière le HUD ;
 * — dès qu'on édite, on l'oublie **et** on nettoie l'URL, sinon un rechargement ressusciterait
 *   silencieusement la scène du lien en effaçant les modifications.
 */
let linkedScene: SharedScene | null = null
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
  // Tolérance d'un micromètre : `share-layout` produit des barres d'exactement `MIN_BAR_LENGTH`, et
  // l'erreur flottante les faisait repasser sous un seuil strict — une barre perdue par lien reçu.
  if (length < MIN_BAR_LENGTH - 1e-6) return null
  return addBar(world, a, b, midiForLength(length, tuning, world.bounds.w))
}

function applyTuning(next: Tuning): void {
  tuning = next
  if (tuningLabel) tuningLabel.textContent = tuning.label
  // Le nom court sert au mode icône des petits écrans : c'est le seul libellé qui porte un état, donc
  // le seul qu'on ne peut pas remplacer par un pictogramme.
  if (tuningLabelShort) tuningLabelShort.textContent = tuning.short
  // Réaccorder ce qui est déjà posé : sans ça, changer de gamme ne s'entendrait qu'aux barres
  // suivantes, et la boucle « je change, j'entends » ne se ferme pas.
  retuneBars(world.bars, tuning, world.bounds.w)
}

/**
 * Change d'instrument. Rien à réaccorder, contrairement à la gamme : le timbre ne touche aucune
 * hauteur. Les notes déjà en vol gardent le leur — une note est construite à l'attaque, et la
 * réécrire en cours de route produirait un saut audible sur une décroissance de cloche.
 */
function applyInstrument(next: Instrument): void {
  instrument = next
  if (instrumentLabel) instrumentLabel.textContent = instrument.label
  if (instrumentLabelShort) instrumentLabelShort.textContent = instrument.short
}

function dropBall(point: Vec2): number {
  // Teintes froides pour les billes : la couleur chaude est réservée aux barres, qui portent la hauteur.
  const hue = 190 + ((world.nextBallId * 37) % 90)
  return spawnBall(world, point, { x: 0, y: 0 }, { hue, recycle: true }).id
}

/**
 * Dernier impact **audible**, exposé au harnais. C'est l'ancre d'une assertion de visibilité : sans un
 * point de référence, « la gerbe se voit » ne peut se mesurer que par un œil humain sur une capture.
 */
let lastImpactPoint: Vec2 | null = null

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
    audio.play(noteFor(bar, gain, panForX(event.point.x, world.bounds.w)))
    effects.addImpact(event, bar.midi, gain)
    lastImpactPoint = { x: event.point.x, y: event.point.y }
  }
}

function advance(seconds: number): void {
  const steps = Math.max(0, Math.round(seconds / DT))
  for (let i = 0; i < steps; i++) {
    runRespawns(world, (pos, hue) => {
      spawnBall(world, { x: pos.x, y: pos.y }, { x: 0, y: 0 }, { hue, recycle: true })
    })
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
  /*
   * La file des retours **aussi**. Sans elle, « Effacer » ne vidait pas la scène : les billes recyclées
   * en attente revenaient à chaque mesure, indéfiniment, dans une scène sans aucune barre. Un contrôle
   * qui cesse de faire ce qu'il annonce.
   */
  world.respawns.length = 0
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

function sharedScene(): SharedScene {
  const area = measureSceneArea(world.bounds)
  const width = world.bounds.w
  return {
    tuningId: tuning.id,
    bars: world.bars.map((bar) => toSharedBar(bar.a, bar.b, area, width)),
    emitters: world.emitters.map((emitter) => ({
      ...toSharedPoint(emitter.pos, area, width),
      period: emitterPeriod(emitter, world.bpm),
    })),
  }
}

function applyShared(shared: SharedScene): void {
  clearAll()
  applyTuning(tuningById(shared.tuningId))

  const area = measureSceneArea(world.bounds)
  const width = world.bounds.w
  // Toute la géométrie vit dans `core/share-layout`, pur et testé : c'est là qu'on garantit qu'une
  // barre garde sa note, remplit l'écran et ne passe pas derrière le HUD.
  for (const bar of shared.bars) {
    placeBar(...placeSharedBar(bar, area, width, MIN_BAR_LENGTH))
  }
  // Scène neuve : les retours programmés par l'ancienne n'ont plus de point d'origine valide.
  world.respawns.length = 0
  for (const emitter of shared.emitters) {
    addEmitter(world, placeSharedEmitter(emitter, area, width), {
      // Les liens déjà émis portent une période libre en secondes : on la rapproche de la division la
      // plus voisine. Un lien ancien reste donc lisible, à la grille près.
      divisionIndex: nearestDivisionIndex(emitter.period, world.bpm),
    })
  }
  // La scène vient de quelqu'un d'autre : on ne la remplace pas par une scène surprise.
  userOwnsScene = true
  linkedScene = shared
}

/**
 * À appeler dès qu'un geste modifie la scène : le lien affiché ne la décrit plus. Le laisser dans
 * l'URL ferait ressusciter l'ancienne scène au moindre rechargement, alors qu'avant l'US5 un
 * rechargement donnait une scène neuve.
 */
function detachFromLink(): void {
  if (!linkedScene && !location.hash.startsWith(SHARE_KEY)) return
  linkedScene = null
  if (location.hash.startsWith(SHARE_KEY)) {
    window.history.replaceState(null, '', `${location.origin}${location.pathname}`)
  }
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
    // On coupe la région live le temps de remettre l'astuce : sinon un lecteur d'écran relit tout le
    // texte d'aide 2,2 s après chaque partage.
    hint.setAttribute('aria-live', 'off')
    hint.innerHTML = hintTemplate
    if (interacted) hint.setAttribute('data-faded', 'true')
    setTimeout(() => hint.setAttribute('aria-live', 'polite'), 50)
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

/**
 * Assemble une note. Un seul endroit décide du timbre : deux chemins (impact et écoute au tap)
 * dupliquaient déjà la fréquence et le panoramique, et auraient divergé sur la voix — le genre d'écart
 * qui fait qu'une barre sonne différemment selon la façon dont on la fait sonner.
 */
function noteFor(bar: Bar, gain: number, pan: number): NoteRequest {
  const voice = voiceForMidi(instrument, bar.midi)
  const freq = midiToFreq(bar.midi)
  return { barId: bar.id, freq, gain, pan, voice, decaySeconds: decayForNote(voice, freq) }
}

function playBar(bar: Bar, gain: number): void {
  audio.play(noteFor(bar, gain, panForX((bar.a.x + bar.b.x) / 2, world.bounds.w)))
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
  for (const emitter of world.emitters) {
    emitter.nextAt = gridTimeAfter(world.time, divisionAt(emitter.divisionIndex), world.bpm)
  }
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
      detachFromLink()
      if (placeBar(gesture.a, gesture.b)) userOwnsScene = true
      fadeHint()
      break

    case 'touch-hint':
      revealHandlesUntil = world.time + REVEAL_HANDLES_SECONDS
      break

    case 'long-press':
      /*
       * Appui long **sur une barre** : change sa nature. Le tap reste l'écoute — c'est comme ça qu'on
       * apprend le lien entre la couleur d'une barre et sa hauteur, et le lui voler serait payer une
       * fonction avec une autre.
       *
       * L'instantané validé est celui pris au `grab`, donc l'état d'**avant** le changement : c'est lui
       * qu'il faut restaurer.
       */
      if (gesture.hit?.target === 'bar') {
        commitPending()
        detachFromLink()
        const nature = cycleNature(gesture.hit.bar)
        announce(`Barre : ${natureLabel(nature)}`)
        userOwnsScene = true
        fadeHint()
        break
      }

      // Appui long dans le vide : pose une source. C'est le seul idiome qui n'introduit pas de mode
      // et ne vole aucun geste existant.
      history.push(world.bars, world.emitters, tuning.id)
      detachFromLink()
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
      detachFromLink()
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
      // `handled` : un appui long a déjà agi pendant cet appui, donc ce relâchement ne décide rien —
      // sans quoi il ferait sonner la barre par-dessus le changement de nature.
      if (gesture.cancelled || gesture.handled) {
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

    case 'tap':
      // Aucun instantané validé : écouter une barre ne modifie rien.
      pendingSnapshot = null
      if (gesture.hit.target === 'bar') {
        // Taper une barre la fait sonner sans rien modifier : c'est comment on apprend la
        // correspondance entre la couleur d'une barre et sa hauteur.
        playBar(gesture.hit.bar, 0.65)
        gesture.hit.bar.lastHitAt = world.time
      } else {
        /*
         * Taper une source change son **rythme**. C'est le seul geste qui construise un motif — sans
         * lui, toutes les sources partagent la même division et la scène n'a qu'une seule pulsation.
         * Aucun mode ajouté : une source est déjà une cible de geste (on la déplace en la glissant),
         * donc la toucher lui parle à elle. Et taper une source ne faisait **rien** jusqu'ici.
         */
        history.push(world.bars, world.emitters, tuning.id)
        detachFromLink()
        const index = cycleDivision(world, gesture.hit.emitter)
        announce(`Source : ${divisionLabel(index)}`)
        userOwnsScene = true
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
      case 'instrument': {
        const index = INSTRUMENTS.findIndex((candidate) => candidate.id === instrument.id)
        const next = INSTRUMENTS[(index + 1) % INSTRUMENTS.length]
        if (next) {
          applyInstrument(next)
          // Annoncé : le changement de timbre ne s'entend qu'au prochain impact, donc sans retour
          // immédiat on ne sait pas si le bouton a fait quelque chose.
          announce(`Instrument : ${next.label}`)
        }
        break
      }
      case 'share': {
        if (world.bars.length === 0 && world.emitters.length === 0) {
          // Un lien vers une scène vide ouvre une page définitivement blanche chez le destinataire,
          // sans même la régénération d'accueil. Atteignable en deux clics (Effacer puis Partager).
          announce('Rien à partager : la scène est vide')
          break
        }
        const link = shareLink()
        // `window.history` explicitement : `history` désigne ici l'historique d'annulation du produit.
        // Et `replaceState` plutôt que `pushState` : sinon chaque partage ajoute une entrée et le
        // bouton « retour » du navigateur devient inutilisable.
        window.history.replaceState(null, '', link)
        // L'optional chaining court-circuiterait le `.then` : sur une origine non sécurisée (http sur
        // une IP de LAN — le cas « je montre à quelqu'un sur le même réseau »), `clipboard` est
        // `undefined` et l'utilisateur cliquait sans le moindre retour visible.
        const copied = navigator.clipboard?.writeText(link)
        if (copied) {
          void copied.then(
            () => announce('Lien copié'),
            () => announce('Lien dans la barre d’adresse'),
          )
        } else {
          announce('Lien dans la barre d’adresse')
        }
        break
      }
      case 'undo':
        undo()
        break
      case 'surprise':
        history.push(world.bars, world.emitters, tuning.id)
        detachFromLink()
        sceneSeed += 1
        userOwnsScene = false
        loadSurprise()
        break
      case 'clear':
        history.push(world.bars, world.emitters, tuning.id)
        detachFromLink()
        userOwnsScene = true
        clearAll()
        break
      case 'mute': {
        const muted = !audio.muted()
        audio.setMuted(muted)
        button.setAttribute('aria-pressed', String(muted))
        // On écrit dans le libellé, pas dans le bouton : `button.textContent = …` effacerait le
        // pictogramme et le libellé accessible en même temps.
        if (muteLabel) muteLabel.textContent = muted ? 'Son coupé' : 'Son activé'
        button.setAttribute('aria-label', muted ? 'Rétablir le son' : 'Couper le son')
        button.setAttribute('title', muted ? 'Rétablir le son' : 'Couper le son')
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
  if (linkedScene) {
    // Une scène reçue se **replace** depuis ses fractions : sinon ses pixels absolus se retrouvent
    // derrière le HUD dès que le destinataire tourne son téléphone.
    const restored = linkedScene
    applyShared(restored)
  } else if (!userOwnsScene) {
    loadSurprise()
  }
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
    runRespawns(world, (pos, hue) => {
      spawnBall(world, { x: pos.x, y: pos.y }, { x: 0, y: 0 }, { hue, recycle: true })
    })
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
  renderer.draw(world, effects, draft, {
    ...interaction,
    revealHandles: world.time < revealHandlesUntil,
  })
  requestAnimationFrame(frame)
}

/**
 * Mouvement réduit : lu **une fois** au démarrage puis à chaque changement de préférence système, et
 * non à chaque frame — interroger `matchMedia` 120 fois par seconde serait absurde.
 */
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
function syncReducedMotion(): void {
  // Les deux couches, depuis **un seul** endroit : le rendu (traînées, ondes, pulsation) et les
  // effets (étincelles). Deux points de synchronisation finiraient par divulguer.
  renderer.setReducedMotion(reducedMotionQuery.matches)
  effects.setReducedMotion(reducedMotionQuery.matches)
}
reducedMotionQuery.addEventListener('change', syncReducedMotion)
syncReducedMotion()

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
  bars(): Array<{ id: number; ax: number; ay: number; bx: number; by: number; midi: number; nature: string; hitsLeft: number; absentUntil: number }>
  addEmitter(x: number, y: number, divisionIndex?: number): number
  /** positions et vitesses des billes vivantes — pour prouver qu'une scène **bouge**, pas qu'elle existe */
  balls(): { id: number; x: number; y: number; vx: number; vy: number }[]
  lastImpact(): { x: number; y: number } | null
  /**
   * Rend hors ligne une salve dense sur l'instrument courant et renvoie ce qui en sort réellement.
   * `notes > 0` compte des appels, pas des décibels : c'est la seule mesure qui puisse dire « ça ne
   * sature pas » sans oreille humaine.
   */
  measureAudio(voices?: number): Promise<{ peak: number; rms: number; peakBeforeCompressor: number }>
  emitters(): Array<{
    id: number
    x: number
    y: number
    divisionIndex: number
    period: number
    nextAt: number
  }>
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
    instrument: string
    /** nombre de sources périodiques posées */
    emitters: number
    /** poignées de toutes les barres visibles (révélation tactile) — assertable sans passer par des pixels */
    revealHandles: boolean
    /** préférence système de mouvement réduit, telle que l'app la voit */
    reducedMotion: boolean
    /** points de trajectoire retenus par le rendu ; doit être 0 en mouvement réduit */
    trailPoints: number
    particles: number
    maxParticles: number
    bpm: number
    time: number
    pendingRespawns: number
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
  balls: () =>
    world.balls.map((ball) => ({
      id: ball.id,
      x: ball.pos.x,
      y: ball.pos.y,
      vx: ball.vel.x,
      vy: ball.vel.y,
    })),
  lastImpact: () => (lastImpactPoint ? { ...lastImpactPoint } : null),
  measureAudio: async (voices = 24) => {
    // Une salve **simultanée** au gain maximal, étalée sur toute l'étendue : c'est le pire cas
    // réaliste (une pluie de billes sur une rangée de barres), et c'est là que la saturation arrive.
    const notes: NoteRequest[] = []
    for (let i = 0; i < voices; i += 1) {
      const midi = 45 + (i * 5) % 40
      const voice = voiceForMidi(instrument, midi)
      const freq = midiToFreq(midi)
      notes.push({
        barId: i,
        freq,
        gain: 1,
        pan: ((i % 5) - 2) / 2.5,
        voice,
        decaySeconds: decayForNote(voice, freq),
      })
    }
    const [after, before] = await Promise.all([measurePeak(notes, 3), measurePeakBeforeCompressor(notes, 3)])
    return { ...after, peakBeforeCompressor: before }
  },
  addEmitter: (x, y, divisionIndex) =>
    addEmitter(world, { x, y }, divisionIndex === undefined ? {} : { divisionIndex }).id,
  emitters: () =>
    world.emitters.map((emitter) => ({
      id: emitter.id,
      x: emitter.pos.x,
      y: emitter.pos.y,
      divisionIndex: emitter.divisionIndex,
      period: emitterPeriod(emitter, world.bpm),
      // Échéance absolue : c'est la seule façon d'asserter « ces deux sources sont en phase » depuis le
      // navigateur sans deviner à partir des instants d'apparition des billes.
      nextAt: emitter.nextAt,
    })),
  bars: () =>
    world.bars.map((bar) => ({
      id: bar.id,
      ax: bar.a.x,
      ay: bar.a.y,
      bx: bar.b.x,
      by: bar.b.y,
      midi: bar.midi,
      nature: bar.nature,
      hitsLeft: bar.hitsLeft,
      absentUntil: bar.absentUntil,
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
    instrument: instrument.id,
    undoDepth: history.depth(),
    emitters: world.emitters.length,
    revealHandles: world.time < revealHandlesUntil,
    reducedMotion: renderer.isReducedMotion(),
    trailPoints: renderer.trailPointCount(),
    particles: effects.particles.length,
    maxParticles: MAX_PARTICLES,
    bpm: world.bpm,
    time: world.time,
    pendingRespawns: world.respawns.length,
    maxBalls: MAX_BALLS,
    distinctPitches: new Set(world.bars.map((bar) => bar.midi)).size,
  }),
}
