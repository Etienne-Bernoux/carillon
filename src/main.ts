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
import { DT, addBar, addDropper, createWorld, removeDropper, spawnBall, stepWorld } from './core/physics'
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
import { clampBpm, divisionAt, divisionLabel, gridTimeAfter } from './core/clock'
import { createHistory } from './core/history'
import { DEFAULT_NATURE, NATURES, natureLabel, rearm } from './core/nature'
import type { BarNature } from './core/nature'
import { INNER_RADIUS, OUTER_RADIUS, fitWheel, labelAnchor, sectorAt } from './core/wheel'
import type { Wheel, WheelAim } from './core/wheel'
import {
  DEFAULT_INSTRUMENT,
  INSTRUMENTS,
  decayForNote,
  instrumentById,
  voiceForMidi,
} from './core/instruments'
import type { Instrument } from './core/instruments'
import { MAX_PARTICLES } from './core/particles'
import { decodeScene, encodeScene } from './core/share'
import type { SharedScene } from './core/share'
import {
  placeSharedBar,
  placeSharedEmitter,
  placeSharedPoint,
  toSharedBar,
  toSharedPoint,
} from './core/share-layout'
import { hitTestWorld } from './core/hit-test'
import type { Grab } from './core/hit-test'
import { attachInput } from './ui/input'
import type { Gesture } from './ui/input'
import { noteName } from './ui/notation'
import { NO_INTERACTION, createEffects, createRenderer } from './ui/renderer'
import { composeMelody } from './core/melody'
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
/** Ordre **figé** aussi : l'index d'instrument voyage dans l'URL depuis le format v2. */
const INSTRUMENT_IDS = INSTRUMENTS.map((candidate) => candidate.id)
let interaction: Interaction = { ...NO_INTERACTION }
/**
 * Instrument courant. C'est un réglage de **lecture**, pas une donnée de scène : il ne change aucune
 * hauteur, seulement le timbre. Il vit donc hors de l'historique et hors du lien de partage, exactement
 * comme le silence — alors que la gamme, elle, réaccorde les barres et fait partie de l'état.
 */
let instrument: Instrument = DEFAULT_INSTRUMENT

/**
 * Air actuellement posé par le compositeur, ou `null`. Sert à l'annonce et à la vérification : sans lui,
 * « le bouton a posé un air » ne serait observable que par l'oreille.
 */
let composedMelody: { label: string; notes: number } | null = null

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
  /*
   * Un lâcher à la main crée un **point de lâcher** visible. Avant, l'origine du retour vivait sur la
   * bille : rien ne la montrait, rien ne permettait de la déplacer ni de la supprimer. Un seul geste
   * créait donc une source de son permanente et invisible — ce que la stratégie du produit interdit.
   */
  const dropper = addDropper(world, point, hue)
  return spawnBall(world, point, { x: 0, y: 0 }, { hue, recycle: true, dropperId: dropper.id }).id
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
    runRespawns(world, (pos, hue, vel) => {
      spawnBall(world, { x: pos.x, y: pos.y }, { x: vel.x, y: vel.y }, { hue, recycle: true })
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
  // Les points de lâcher aussi : ils sont de la scène, et c'était le sens de « Effacer ».
  world.droppers.length = 0
  effects.clear()
  impactsTotal = 0
  /*
   * Une roue ouverte visait une barre de cette scène : la laisser ouverte afficherait un choix sur un
   * objet qui n'existe plus, et le tap suivant ne pourrait que ne rien faire — un widget mort à l'écran.
   *
   * Redondant avec le garde des boutons du HUD pour le chemin « Effacer », et c'est **volontaire** : ce
   * qui passe par ici et pas par là, c'est le `reset()` du harnais. Sans cette ligne, une roue oubliée
   * survivait entre deux étapes d'un scénario et avalait l'appui long suivant — le faux négatif qui a
   * coûté une passe de review. À ne pas retirer au prochain nettoyage sous prétexte de doublon.
   */
  openWheel = null
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

/**
 * Pose une scène **surprise**.
 *
 * `compose` : tenter d'abord un air connu. Réservé au **bouton**, pas à la scène d'accueil ni au
 * redimensionnement, et pour deux raisons mesurées :
 *
 * - la scène est régénérée à chaque redimensionnement, or composer coûte 60 à 330 ms — mesuré, les fps
 *   du scénario de charge tombaient à 16 ;
 * - un incipit n'utilise que trois ou quatre hauteurs distinctes, alors que la scène d'accueil doit
 *   rester **musicalement riche** (garde-fou de l'US2 : un téléphone n'y jouait que deux hauteurs).
 *
 * Faire de la scène d'accueil un air demande de la **redimensionner** au lieu de la régénérer, comme une
 * scène reçue par lien. C'est une tranche à part.
 *
 * Renvoie le nom de l'air posé, ou `null` si l'on a produit la scène stratifiée.
 */
function loadSurprise(options?: { compose?: boolean }): string | null {
  clearAll()
  composedMelody = null

  const area = measureSceneArea(world.bounds)
  const composed = options?.compose
    ? composeMelody({ bounds: world.bounds, seed: sceneSeed })
    : null
  if (composed) {
    applyTuning(tuningById(composed.tuningId))
    for (const bar of composed.bars) {
      // On passe par `addBar` et non par `placeBar` : la hauteur est **déjà** décidée par le
      // générateur, et la recalculer depuis la longueur la ferait dévier de l'air.
      addBar(world, bar.a, bar.b, bar.midi)
    }
    /*
     * La bille qui joue l'air est **recyclée** : elle revient à son point de lâcher avec sa vitesse de
     * lancement, donc l'air se rejoue à chaque mesure. Sans le recyclage de l'US7, on l'entendrait une
     * fois puis plus jamais.
     */
    /*
     * La bille de l'air a besoin d'un **point de lâcher**, comme toute bille recyclée : c'est lui qui la
     * fait revenir, et c'est lui qui voyage dans le lien. Sans ça l'air se jouait une fois puis se
     * taisait, et son lien arrivait silencieux — régression introduite en rendant le recyclage explicite.
     */
    const hue = 190 + ((world.nextBallId * 37) % 90)
    const dropper = addDropper(world, composed.drop, hue)
    spawnBall(world, composed.drop, composed.velocity, {
      hue,
      recycle: true,
      dropperId: dropper.id,
    })
    composedMelody = { label: composed.melody.label, notes: composed.melody.degrees.length }
    return composed.melody.label
  }

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
    area,
  )
  return null
}

/** Préfixe du fragment d'URL qui porte une scène. */
const SHARE_KEY = '#s='

function sharedScene(): SharedScene {
  const area = measureSceneArea(world.bounds)
  const width = world.bounds.w
  return {
    tuningId: tuning.id,
    // Le timbre et le tempo voyagent désormais avec la scène. Ils étaient restés dehors aux US7 et US8
    // sans qu'on l'ait décidé : une scène reçue se rejouait à 96 BPM au carillon, quoi qu'ait choisi
    // celui qui l'a partagée.
    instrumentId: instrument.id,
    bpm: world.bpm,
    bars: world.bars.map((bar) =>
      toSharedBar(bar.a, bar.b, area, width, Math.max(0, NATURES.indexOf(bar.nature)))
    ),
    emitters: world.emitters.map((emitter) => ({
      ...toSharedPoint(emitter.pos, area, width),
      divisionIndex: emitter.divisionIndex,
    })),
    droppers: world.droppers.map((dropper) => toSharedPoint(dropper.pos, area, width)),
  }
}

function applyShared(shared: SharedScene): void {
  clearAll()
  applyTuning(tuningById(shared.tuningId))
  applyInstrument(instrumentById(shared.instrumentId))
  world.bpm = clampBpm(shared.bpm)

  const area = measureSceneArea(world.bounds)
  const width = world.bounds.w
  // Toute la géométrie vit dans `core/share-layout`, pur et testé : c'est là qu'on garantit qu'une
  // barre garde sa note, remplit l'écran et ne passe pas derrière le HUD.
  for (const bar of shared.bars) {
    const placed = placeBar(...placeSharedBar(bar, area, width, MIN_BAR_LENGTH))
    // La nature suit la barre. Un lien v1 n'en portait pas : son index vaut 0, donc « mur ».
    if (placed) placed.nature = NATURES[bar.natureIndex] ?? DEFAULT_NATURE
  }
  // Scène neuve : les retours programmés par l'ancienne n'ont plus de point d'origine valide.
  world.respawns.length = 0
  for (const emitter of shared.emitters) {
    // Le rapprochement d'une période v1 vers une division est fait par le décodeur : ici l'index est
    // déjà celui de la grille, quelle que soit la version du lien.
    addEmitter(world, placeSharedEmitter(emitter, area, width), {
      divisionIndex: emitter.divisionIndex,
    })
  }
  /*
   * Les points de lâcher, **avec leur bille**. Sans eux, une scène partagée arrivait muette dès qu'elle
   * ne portait pas de source : un air composé ne tient que par une bille recyclée, donc son lien donnait
   * une scène silencieuse jusqu'au premier clic du destinataire.
   */
  for (const point of shared.droppers) {
    const pos = placeSharedPoint(point.x, point.y, area, width)
    const hue = 190 + ((world.nextBallId * 37) % 90)
    const dropper = addDropper(world, pos, hue)
    spawnBall(world, pos, { x: 0, y: 0 }, { hue, recycle: true, dropperId: dropper.id })
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
  return `${location.origin}${location.pathname}${SHARE_KEY}${encodeScene(sharedScene(), TUNING_IDS, INSTRUMENT_IDS)}`
}

/** Scène portée par l'URL, ou `null`. Un lien illisible rend `null`, jamais une erreur. */
function sceneFromUrl(): SharedScene | null {
  const hash = location.hash
  if (!hash.startsWith(SHARE_KEY)) return null
  return decodeScene(hash.slice(SHARE_KEY.length), TUNING_IDS, INSTRUMENT_IDS)
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
  /*
   * La roue qui visait cette barre est fermée. Sans ça, on pouvait jeter la barre par le bord pendant
   * que sa roue épinglée restait à l'écran, avec ses trois options et son point de marquage : taper un
   * secteur ne faisait alors **rien du tout**, sans un mot. Un widget mort qui ne dit pas qu'il l'est.
   */
  if (openWheel?.barId === id) openWheel = null
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
  // Annuler est un saut d'état : la barre restaurée peut ne plus avoir la nature que la roue affiche
  // comme courante, donc le point de marquage mentirait sur ce qui est en place.
  openWheel = null
  userOwnsScene = true
}

/**
 * Mise en évidence pour une cible saisie ou survolée. Une seule fonction, parce que trois branches
 * séparées (survol, saisie, glisser) divergeaient dès qu'une **troisième** cible est apparue — le
 * compilateur les a d'ailleurs toutes signalées d'un coup.
 */
function interactionFor(hit: Grab | null): Interaction {
  if (!hit) return { ...NO_INTERACTION }
  if (hit.target === 'bar') {
    return { ...NO_INTERACTION, hoveredBarId: hit.bar.id, hoveredKind: hit.kind }
  }
  if (hit.target === 'emitter') {
    return { ...NO_INTERACTION, hoveredEmitterId: hit.emitter.id }
  }
  return { ...NO_INTERACTION, hoveredDropperId: hit.dropper.id }
}

/**
 * Roue de sélection ouverte, ou `null`. Deux réglages y passent — la nature d'une barre et
 * l'instrument — et le seul état partagé est celui-ci : la géométrie ne connaît ni l'un ni l'autre.
 *
 * `pinned` distingue les deux temps du geste. À ressort, la roue vit le temps d'un appui et le
 * relâchement décide. Épinglée, elle survit au relâchement et c'est un tap qui décide — le cas de
 * quelqu'un qui appuie long et relâche sans avoir bougé, c'est-à-dire de quelqu'un qui découvre.
 */
interface OpenWheel {
  wheel: Wheel<string>
  /** barre visée pour une roue de nature ; `null` pour l'instrument */
  barId: number | null
  /**
   * Intention lue sous le pointeur, pas seulement un index de secteur : « ça va épingler » et « ça va
   * annuler » sont deux issues opposées que le rendu doit montrer différemment.
   */
  aim: WheelAim | null
  pinned: boolean
  /**
   * Point où l'appui a commencé, et vrai dès que le doigt s'en est franchement éloigné.
   *
   * Sans ça, une roue **recadrée** trahissait le geste : ouverte près d'un bord, `fitWheel` la déplace
   * loin du doigt, donc le pointeur immobile se retrouve dans un secteur — et relâcher sans avoir bougé
   * appliquait une option que personne n'avait visée, au lieu d'épingler. Trouvé en regardant une
   * capture, aucune assertion ne le voyait. La zone morte se mesure depuis l'**origine du geste**, pas
   * depuis le centre du dessin.
   */
  origin: Vec2
  committed: boolean
}
let openWheel: OpenWheel | null = null

function openNatureWheel(bar: Bar, point: Vec2): void {
  openWheel = {
    wheel: {
      center: fitWheel(point, measureSceneArea(world.bounds)),
      options: NATURES.map((nature) => ({ value: nature, label: natureLabel(nature) })),
      current: bar.nature,
    },
    barId: bar.id,
    aim: null,
    pinned: false,
    origin: point,
    committed: false,
  }
}

function openInstrumentWheel(): void {
  const area = measureSceneArea(world.bounds)
  const center = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 }
  openWheel = {
    wheel: {
      // Au centre de la zone de jeu : l'origine du geste est un bouton du HUD, donc une roue posée là
      // serait à moitié hors de la scène — et `fitWheel` la recadrerait de toute façon.
      center: fitWheel(center, area),
      // Le nom court sert de repli : à cinq options, « Corde (pizzicato) » et « Verre (cloches) » se
      // recouvraient de 18 px, donc deux timbres sur cinq étaient illisibles.
      options: INSTRUMENTS.map((candidate) => ({
        value: candidate.id,
        label: candidate.label,
        short: candidate.short,
      })),
      current: instrument.id,
    },
    barId: null,
    aim: null,
    // Épinglée d'entrée : le geste d'ouverture est un clic, il n'y a pas d'appui à tenir.
    pinned: true,
    // L'origine ne sert qu'aux roues à ressort ; le centre est la valeur neutre pour une roue épinglée.
    origin: center,
    committed: true,
  }
}

/**
 * Vue de la roue pour le harnais. Une fonction plutôt qu'un objet littéral dans `stats()` : le
 * paramètre non-nullable est ce qui évite un cast pour convaincre le compilateur qu'une fermeture ne
 * s'est pas glissée entre le test d'ouverture et la lecture.
 */
function wheelStats(open: OpenWheel) {
  return {
    options: open.wheel.options.map((option, index) => {
      const anchor = labelAnchor(open.wheel, index)
      return { value: option.value, label: option.label, x: anchor.x, y: anchor.y }
    }),
    current: open.wheel.current,
    aimed: open.aim?.kind === 'sector' ? open.aim.index : null,
    /** ce que le relâchement ferait : choisir un secteur, épingler, annuler, ou rien de lu encore */
    aimKind: open.aim?.kind ?? null,
    pinned: open.pinned,
    labels: renderer.wheelLabels({ wheel: open.wheel, aim: open.aim, pinned: open.pinned }),
    centerX: open.wheel.center.x,
    centerY: open.wheel.center.y,
    outerRadius: OUTER_RADIUS,
    innerRadius: INNER_RADIUS,
  }
}

/**
 * Annonce l'ouverture d'une roue. Elle dit **ce qui est en place** en plus du catalogue : annoncer
 * seulement la liste laissait un lecteur d'écran entendre les options sans jamais savoir laquelle est
 * la sienne — soit exactement ce que la roue a été construite pour montrer à l'œil.
 */
function announceWheel(current: string): void {
  const options = openWheel?.wheel.options ?? []
  const label = options.find((option) => option.value === current)?.label ?? current
  announce(`${label}, parmi ${options.map((option) => option.label).join(', ')}`)
}

function aimWheel(point: Vec2): void {
  if (!openWheel) return
  if (!openWheel.committed) {
    const travelled = Math.hypot(point.x - openWheel.origin.x, point.y - openWheel.origin.y)
    /*
     * Tant que le doigt n'a pas quitté son point de départ, rien n'est visé — et l'affichage annonce
     * « ça va épingler », qui est bien ce que le relâchement ferait. Annoncer un secteur ici mentirait,
     * puisque le garde ci-dessous l'ignorerait.
     */
    if (travelled <= INNER_RADIUS) {
      openWheel.aim = { kind: 'pin' }
      return
    }
    openWheel.committed = true
  }
  openWheel.aim = sectorAt(openWheel.wheel, point)
}

function applyWheelChoice(index: number): void {
  const option = openWheel?.wheel.options[index]
  if (!openWheel || !option) return

  if (openWheel.barId === null) {
    const next = INSTRUMENTS.find((candidate) => candidate.id === option.value)
    if (next) {
      applyInstrument(next)
      // Annoncé : un changement de timbre ne s'entend qu'au prochain impact.
      announce(`Instrument : ${next.label}`)
    }
    return
  }

  const bar = world.bars.find((candidate) => candidate.id === openWheel?.barId)
  if (!bar) return
  // Retrouvée dans le catalogue plutôt qu'affirmée par un cast : la roue porte des chaînes, et c'est
  // `NATURES` qui décide lesquelles sont des natures. Même forme que la branche instrument juste au-dessus.
  const nature = NATURES.find((candidate) => candidate === option.value)
  if (!nature) return
  if (bar.nature === nature) {
    // Choisir ce qui est déjà en place ne doit pas consommer une place d'annulation, ni ré-armer une
    // barre éphémère à moitié usée : ce serait une modification déguisée en confirmation.
    announce(`Barre : ${natureLabel(bar.nature)}`)
    return
  }
  // Empilé ici plutôt qu'à la préhension : c'est le seul instant où l'on sait que l'état va changer.
  history.push(world.bars, world.emitters, tuning.id)
  detachFromLink()
  bar.nature = nature
  rearm(bar)
  announce(`Barre : ${natureLabel(bar.nature)}`)
  userOwnsScene = true
}

/**
 * Fin d'un geste sur la roue. Trois issues, et la troisième est celle qui rend la fonction découvrable
 * plutôt que secrète : relâcher dans la zone morte **épingle** au lieu d'annuler.
 */
function resolveWheel(point: Vec2, cancelled: boolean): boolean {
  if (!openWheel) return false
  if (cancelled) {
    openWheel = null
    return false
  }
  /*
   * Un geste qui n'a jamais quitté son origine n'a rien visé : il épingle. Décidé sur le **geste** et
   * non sur la position absolue, sinon une roue recadrée près d'un bord appliquerait le secteur où le
   * doigt se trouve par accident.
   */
  const aim = openWheel.committed ? sectorAt(openWheel.wheel, point) : ({ kind: 'pin' } as const)
  if (aim.kind === 'pin' && !openWheel.pinned) {
    openWheel.pinned = true
    openWheel.aim = null
    // Le geste suivant est un tap neuf : il se décide à sa position, et l'origine de l'appui qui vient
    // de s'achever ne le concerne plus. Sans ça, le premier tap dans un secteur ne choisissait rien.
    openWheel.committed = true
    return true
  }
  const picked = aim.kind === 'sector'
  if (aim.kind === 'sector') applyWheelChoice(aim.index)
  openWheel = null
  return picked
}

/**
 * Point d'un geste, quand il en porte un. Une seule fonction plutôt qu'un test par cas : c'est
 * l'accumulation de ces tests qui avait laissé passer `drag`, et donc laissé déplacer une barre sous une
 * roue épinglée.
 */
function pointOf(gesture: Gesture): Vec2 | null {
  switch (gesture.type) {
    case 'pointer-move':
    case 'long-press-move':
    case 'drop-ball':
    case 'long-press':
    case 'long-press-end':
    case 'tap':
    case 'drag':
    case 'release':
      return gesture.point
    case 'draft':
    case 'create-bar':
      return gesture.b
    default:
      return null
  }
}

function handleGesture(gesture: Gesture): void {
  /*
   * Une roue épinglée capte les gestes qui **décident**, et eux seuls. Sans cette interception, le tap
   * qui choisit un secteur ferait aussi sonner la barre en dessous, et un appui long y poserait une
   * source : la roue volerait les gestes qu'elle est censée ne pas voler, à l'envers.
   *
   * Un glisser franc, lui, passe : il est sans ambiguïté (on veut dessiner), et il ferme la roue.
   */
  if (openWheel?.pinned) {
    /*
     * **Rien ne passe.** Le premier jet ne captait que les gestes « décisifs », et la liste s'est
     * allongée à chaque support : le survol pour viser à la souris, le tracé pour viser au doigt, puis
     * le glisser — parce qu'un glisser commencé **sur une barre** émet `drag` et déplaçait la barre sous
     * la roue. Chaque ajout était un aveu : la bonne règle n'est pas une liste, c'est que le disque est
     * modal. Tant qu'il est là, il consomme tout, et le geste qui le résout ne fait rien d'autre.
     *
     * C'est aussi ce qui répond au reproche inverse : l'écran ne doit pas désigner une cible que le
     * geste ne touchera pas. D'où le survol neutralisé et le disque presque opaque.
     */
    const aimPoint = pointOf(gesture)
    switch (gesture.type) {
      // Viser : tout mouvement, quel que soit le support qui l'a produit.
      case 'pointer-move':
      case 'draft':
      case 'drag':
        if (aimPoint) aimWheel(aimPoint)
        return

      // Décider : tout geste qui s'achève.
      case 'tap':
      case 'drop-ball':
      case 'long-press':
      case 'create-bar':
      case 'release': {
        /*
         * Le `release` qui **clôt la pression ayant déjà agi** ne décide rien : c'est précisément ce que
         * dit `handled`. Sans cette garde, le relâchement qui vient d'épingler la roue la résolvait
         * aussitôt — donc « relâcher au centre laisse la roue ouverte » redevenait faux.
         */
        if (gesture.type === 'release' && gesture.handled) return
        // Choisir ne modifie rien par soi-même : l'instantané de préhension est jeté, et
        // `applyWheelChoice` empile le sien s'il change quelque chose.
        pendingSnapshot = null
        const decided = aimPoint ? resolveWheel(aimPoint, false) : false
        /*
         * Un appui long qui n'a rien choisi **rouvre** une roue sur la barre visée, au lieu de se
         * contenter de congédier celle qui était là : sinon obtenir une roue demandait deux appuis
         * longs, soit une seconde de maintien, alors que c'est LE geste qui l'ouvre.
         */
        if (!decided && gesture.type === 'long-press' && gesture.hit?.target === 'bar') {
          openNatureWheel(gesture.hit.bar, gesture.point)
          announceWheel(gesture.hit.bar.nature)
        }
        return
      }

      default:
        /*
         * Le reste est avalé sans effet : le survol ne doit **pas** surligner une barre derrière un
         * secteur — l'écran désignerait cette barre-là alors que le geste touche celle que la roue vise.
         */
        interaction = { ...NO_INTERACTION }
        canvas.style.cursor = 'pointer'
        return
    }
  }

  switch (gesture.type) {
    case 'hover':
      interaction = interactionFor(gesture.hit)
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
        /*
         * La roue remplace le cyclage. Cycler cachait l'ensemble : rien n'annonçait qu'il existait
         * trois natures, ni laquelle était en place. Rien n'est modifié à l'ouverture — c'est le
         * relâchement qui décide, donc l'instantané de préhension n'a rien à valider.
         */
        openNatureWheel(gesture.hit.bar, gesture.point)
        announceWheel(gesture.hit.bar.nature)
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

    case 'pointer-move':
      // Aucune roue épinglée : il n'y a rien à viser, et ce geste ne doit rien coûter. C'est
      // l'interception en tête de fonction qui le traite quand une roue est ouverte.
      break

    case 'long-press-move':
      // Viser dans la roue sans relever le doigt. Aucun effet si aucune roue n'est ouverte : l'appui
      // long dans le vide pose une source et n'a rien à viser.
      aimWheel(gesture.point)
      break

    case 'long-press-end':
      resolveWheel(gesture.point, gesture.cancelled)
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
      interaction = interactionFor(gesture.hit)
      fadeHint()
      break

    case 'drag': {
      const area = dragArea ?? measureSceneArea(world.bounds)
      commitPending()
      detachFromLink()
      userOwnsScene = true

      if (gesture.hit.target === 'dropper') {
        const { dropper } = gesture.hit
        dropper.pos.x = Math.max(area.left, Math.min(area.right, gesture.point.x))
        dropper.pos.y = Math.max(area.top, Math.min(area.bottom, gesture.point.y))
        const doomed = inDeleteZone(gesture.point)
        interaction = {
          ...NO_INTERACTION,
          hoveredDropperId: dropper.id,
          pendingDeleteDropperId: doomed ? dropper.id : null,
        }
        break
      }

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
        else if (gesture.hit.target === 'dropper') removeDropper(world, gesture.hit.dropper.id)
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
      } else if (gesture.hit.target === 'dropper') {
        // Un point de lâcher n'a ni note à faire entendre ni rythme à cycler : le taper ne fait rien,
        // et c'est mieux que d'inventer un effet pour remplir la branche.
        fadeHint()
        break
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
  hitTest: (point, radii) => hitTestWorld(world.bars, world.emitters, point, radii, world.droppers),
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
    /*
     * Tout bouton du HUD ferme la roue ouverte, sauf celui qui en ouvre une. Un contrôle qui agit sur
     * la scène pendant qu'un sélecteur flotte au-dessus laisserait ce sélecteur décrire un état
     * révolu — et « Effacer » ou la gamme sont exactement ça.
     */
    if (button.dataset.control !== 'instrument') openWheel = null
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
        /*
         * Le bouton ouvre la roue au lieu de cycler. C'est ici que le cyclage coûtait le plus cher :
         * revenir d'un cran sur cinq timbres demandait quatre clics, et le cinquième timbre ne se
         * découvrait qu'en cliquant cinq fois. Deux gestes suffisent maintenant, quel que soit le
         * timbre visé.
         */
        openInstrumentWheel()
        announceWheel(instrument.id)
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
      case 'surprise': {
        history.push(world.bars, world.emitters, tuning.id)
        detachFromLink()
        sceneSeed += 1
        userOwnsScene = false
        const air = loadSurprise({ compose: true })
        // Annoncé : sans nom, la reconnaissance n'a aucun repère — on entend « quelque chose de connu »
        // sans savoir quoi, ce qui gâche exactement l'effet cherché.
        announce(air ? `Scène : ${air}` : 'Scène surprise')
        break
      }
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
  /*
   * Une roue ouverte est fermée : son centre est en **pixels absolus**, recadrés pour la zone de jeu
   * d'avant. Après une rotation d'écran, elle se retrouverait à cheval sur le HUD ou hors champ, avec
   * des secteurs devenus inatteignables — et elle viserait encore la scène précédente, que ce même
   * gestionnaire peut être en train de reconstruire juste en dessous.
   */
  openWheel = null
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
    runRespawns(world, (pos, hue, vel) => {
      spawnBall(world, { x: pos.x, y: pos.y }, { x: vel.x, y: vel.y }, { hue, recycle: true })
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
    // Injecté ici et pas dans `interaction` : cet objet est reconstruit à chaque survol depuis
    // `NO_INTERACTION`, ce qui fermerait la roue au premier mouvement de souris.
    wheel: openWheel
      ? { wheel: openWheel.wheel, aim: openWheel.aim, pinned: openWheel.pinned }
      : null,
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
  droppers(): Array<{ id: number; x: number; y: number }>
  bars(): Array<{ id: number; ax: number; ay: number; bx: number; by: number; midi: number; nature: string; hitsLeft: number; absentUntil: number }>
  addEmitter(x: number, y: number, divisionIndex?: number): number
  /** positions et vitesses des billes vivantes — pour prouver qu'une scène **bouge**, pas qu'elle existe */
  balls(): { id: number; x: number; y: number; origin: number; vx: number; vy: number }[]
  lastImpact(): { x: number; y: number } | null
  /** air composé actuellement posé, ou `null` si la scène n'en porte pas */
  composedMelody(): { label: string; notes: number } | null
  /**
   * Pose l'état d'une barre. **Un seul** accès pour la nature, la vie restante et l'absence : les trois
   * ne s'atteignent autrement qu'en jouant, ce qui ne permet pas de montrer les cinq états côte à côte.
   */
  setBar(id: number, patch: { nature?: string; hitsLeft?: number; absentUntil?: number }): boolean
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
    tuningIds: readonly string[]
    instrument: string
    instrumentIds: readonly string[]
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
    droppers: number
    /** plafond de billes vivantes, exposé pour que le harnais n'ait pas à le deviner */
    maxBalls: number
    /** nombre de gestes annulables empilés */
    undoDepth: number
    /** nombre de hauteurs distinctes présentes sur la scène — mesure la richesse musicale */
    distinctPitches: number
    /**
     * Roue de sélection ouverte, ou `null`. Les libellés sont exposés parce que « la roue montre les
     * cinq timbres » est une propriété du **contenu**, pas un comptage de pixels : une roue ouverte sur
     * trois options passerait n'importe quelle assertion de surface.
     */
    wheel: {
      /**
       * Chaque option **avec le point où son libellé est dessiné**. C'est ce point que le harnais vise,
       * donc l'assertion parcourt le vrai chemin : `labelAnchor` place, `sectorAt` relit. Rendre l'un
       * incohérent avec l'autre casse le scénario, ce qu'une liste de libellés seule ne verrait pas.
       */
      options: readonly { value: string; label: string; x: number; y: number }[]
      current: string
      aimed: number | null
      /** ce que le relâchement ferait : `sector`, `pin`, `cancel`, ou `null` si rien n'a encore été lu */
      aimKind: 'sector' | 'pin' | 'cancel' | null
      pinned: boolean
      /**
       * Libellés tels qu'ils seront **dessinés** — long ou court selon ce qui tient — avec leur largeur
       * mesurée et le budget de leur secteur. Sans ça, « les cinq timbres sont lisibles » ne s'asserte
       * pas : deux libellés qui se recouvrent exposent la même liste de chaînes que deux libellés lisibles.
       */
      labels: readonly { text: string; width: number; x: number; y: number; budget: number }[]
      centerX: number
      centerY: number
      /** rayon du disque, exposé pour que « la roue tient dans la scène » s'asserte sans deviner sa taille */
      outerRadius: number
      /** rayon de la zone morte — même raison : un seuil recopié en dur dans le harnais cesse de vouloir dire quelque chose le jour où il bouge */
      innerRadius: number
    } | null
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
      origin: ball.origin.x,
      vx: ball.vel.x,
      vy: ball.vel.y,
    })),
  lastImpact: () => (lastImpactPoint ? { ...lastImpactPoint } : null),
  composedMelody: () => (composedMelody ? { ...composedMelody } : null),
  setBar: (id, patch) => {
    const bar = world.bars.find((candidate) => candidate.id === id)
    if (!bar) return false
    if (patch.nature && NATURES.includes(patch.nature as BarNature)) {
      bar.nature = patch.nature as BarNature
      rearm(bar)
    }
    if (patch.hitsLeft !== undefined) bar.hitsLeft = patch.hitsLeft
    if (patch.absentUntil !== undefined) bar.absentUntil = patch.absentUntil
    return true
  },
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
  droppers: () => world.droppers.map((d) => ({ id: d.id, x: d.pos.x, y: d.pos.y })),
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
    tuningIds: TUNING_IDS,
    instrument: instrument.id,
    instrumentIds: INSTRUMENT_IDS,
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
    droppers: world.droppers.length,
    maxBalls: MAX_BALLS,
    distinctPitches: new Set(world.bars.map((bar) => bar.midi)).size,
    wheel: openWheel ? wheelStats(openWheel) : null,
  }),
}
