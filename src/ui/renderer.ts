import type { GrabKind } from '../core/hit-test'
import {
  advanceParticles,
  clearParticles,
  createParticleField,
  particleFade,
  spawnImpactParticles,
} from '../core/particles'
import type { Particle } from '../core/particles'
import { emitterPeriod } from '../core/emitter'
import { isPresent } from '../core/nature'
import { BAR_THICKNESS } from '../core/physics'
import { createRng } from '../core/rng'
import type { Bounds, ImpactEvent, Vec2, World } from '../core/types'
import {
  INNER_RADIUS,
  OUTER_RADIUS,
  chooseLabels,
  labelAnchor,
  labelWidthBudget,
  sectorStartAngle,
} from '../core/wheel'
import type { WheelOption, WheelView } from '../core/wheel'
import { hueForMidi } from './notation'

const BG_TOP = '#0b1030'
const BG_BOTTOM = '#04060f'
/** Durée de la traînée derrière une bille, en secondes de simulation. */
const TRAIL_SECONDS = 0.22
const GLOW_MS = 420
/** longueur de la traînée d'une étincelle, exprimée en secondes de sa propre vitesse */
const STREAK_SECONDS = 0.05
/** graine du hasard des étincelles ; rembobinée à chaque `clear()` pour rendre une capture comparable */
const PARTICLE_SEED = 0x5eed

interface Ripple {
  x: number
  y: number
  hue: number
  strength: number
  age: number
  ttl: number
}

export interface Effects {
  addImpact(event: ImpactEvent, midi: number, strength: number): void
  advance(dt: number): void
  clear(): void
  readonly ripples: readonly Ripple[]
  readonly particles: readonly Particle[]
  /** en mouvement réduit, aucune étincelle ne naît — les ondes, elles, restent (elles ne bougent plus) */
  setReducedMotion(reduced: boolean): void
}

export function createEffects(): Effects {
  const ripples: Ripple[] = []
  const field = createParticleField()
  /*
   * Graine fixe, **rembobinée à chaque `clear()`**. Le flux est partagé par tous les impacts (deux
   * tirages par étincelle), donc la gerbe d'un impact donné dépend de tout l'historique depuis le
   * dernier `clear()` — et non de la scène seule. Ce qui est garanti est précis : *à partir d'une scène
   * remise à zéro*, la même suite d'impacts produit les mêmes gerbes. Sans le rembobinage, deux
   * exécutions identiques du même scénario divergeaient de 36 % sur la signature en pixels de la zone
   * d'impact — une capture n'était donc pas un artefact reproductible.
   */
  let rand = createRng(PARTICLE_SEED)
  let reduced = false
  return {
    ripples,
    particles: field.particles,
    setReducedMotion(value) {
      reduced = value
      if (value) clearParticles(field)
    },
    addImpact(event, midi, strength) {
      if (!reduced) spawnImpactParticles(field, event, rand, midi)
      // Au-delà de ~140 ondes simultanées le gain visuel est nul et le coût réel : on jette les plus vieilles.
      if (ripples.length > 140) ripples.splice(0, ripples.length - 140)
      ripples.push({
        x: event.point.x,
        y: event.point.y,
        hue: hueForMidi(midi),
        strength: Math.min(1, strength),
        age: 0,
        ttl: 0.5 + strength * 0.35,
      })
    },
    advance(dt) {
      advanceParticles(field, dt)
      let write = 0
      for (let i = 0; i < ripples.length; i++) {
        const r = ripples[i]
        if (!r) continue
        r.age += dt
        if (r.age < r.ttl) ripples[write++] = r
      }
      ripples.length = write
    },
    clear() {
      ripples.length = 0
      clearParticles(field)
      rand = createRng(PARTICLE_SEED)
    },
  }
}

export interface Draft {
  a: Vec2
  b: Vec2
  label: string
}

/**
 * Deux façons de montrer les poignées, nommées plutôt que dosées par un facteur : le **survol** (une
 * barre désignée, réglage d'origine) et la **révélation** tactile (toutes les barres, faute de survol).
 * Un simple facteur d'intensité mélangeait les deux et avait silencieusement changé le rayon du survol.
 */
type HandleMode = 'hover' | 'reveal'

/** État d'interaction courant : ce que le rendu doit montrer, sans que le monde en sache rien. */
export interface Interaction {
  /** montrer les poignées de **toutes** les barres, faute de survol au doigt */
  revealHandles: boolean
  hoveredBarId: number | null
  hoveredKind: GrabKind | null
  /** barre qui sera supprimée si l'on relâche maintenant — doit se voir avant le relâchement */
  pendingDeleteBarId: number | null
  hoveredEmitterId: number | null
  pendingDeleteEmitterId: number | null
  hoveredDropperId: number | null
  pendingDeleteDropperId: number | null
  /** roue de sélection ouverte, ou `null` : rien n'est dessiné et rien n'est calculé quand elle est fermée */
  wheel: WheelView | null
}

export const NO_INTERACTION: Interaction = {
  revealHandles: false,
  hoveredBarId: null,
  hoveredKind: null,
  pendingDeleteBarId: null,
  hoveredEmitterId: null,
  pendingDeleteEmitterId: null,
  hoveredDropperId: null,
  pendingDeleteDropperId: null,
  wheel: null,
}

/**
 * Un libellé de roue tel qu'il a été **dessiné** : son texte (long ou court, selon ce qui tenait), sa
 * largeur mesurée, son ancre, et le budget géométrique de son secteur.
 */
export interface LabelBox {
  text: string
  /** lignes réellement écrites : une, ou deux quand le libellé long ne tient qu'en le coupant */
  lines: string[]
  width: number
  x: number
  y: number
  budget: number
}

export interface Renderer {
  resize(): Bounds
  draw(world: World, effects: Effects, draft: Draft | null, interaction: Interaction): void
  /**
   * Mouvement réduit : on **raccourcit**, on ne fige pas. Une scène immobile ne serait plus un
   * instrument — les billes doivent continuer de tomber, c'est la simulation. Ce qui disparaît est
   * l'ornement : traînées, expansion des ondes, pulsation des sources.
   */
  setReducedMotion(reduced: boolean): void
  /**
   * Nombre de points de trajectoire retenus. Exposé pour que « le mouvement réduit supprime les
   * traînées » soit assertable **directement**, et non par un comptage de pixels clairs — qui ne
   * mesurait en réalité que le cœur des billes.
   */
  trailPointCount(): number
  /**
   * Ce que le **rendu** croit de la préférence de mouvement. `stats()` lisait la média-requête
   * directement, donc l'assertion navigateur comparait l'émulation Chrome à elle-même : elle passait
   * même si `syncReducedMotion` n'avait jamais propagé la valeur.
   */
  isReducedMotion(): boolean
  /**
   * Libellés de la roue tels qu'ils seraient dessinés maintenant. Exposé parce que « les cinq timbres
   * sont lisibles » ne se démontre ni par une liste de chaînes (identique quand deux se recouvrent) ni
   * par un comptage de pixels : il se démontre sur des boîtes.
   */
  wheelLabels(view: WheelView): LabelBox[]
}

/**
 * Le narrowing d'un `const` ne traverse pas une fonction déclarée (hoisting) : on obtient donc le
 * contexte via un helper au type non-nullable, plutôt que de re-tester dans chaque fonction de dessin.
 */
function require2d(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponible')
  return ctx
}

function makeGlowSprite(hue: number): HTMLCanvasElement {
  const size = 64
  const sprite = document.createElement('canvas')
  sprite.width = size
  sprite.height = size
  const g = require2d(sprite)
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.18, `hsla(${hue}, 100%, 78%, 0.85)`)
  grad.addColorStop(0.45, `hsla(${hue}, 95%, 60%, 0.28)`)
  grad.addColorStop(1, `hsla(${hue}, 95%, 55%, 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return sprite
}

/**
 * Un seul calque, **entièrement repeint** à chaque frame, et des traînées **explicites**.
 *
 * Deux approches ont été essayées et jetées avant celle-ci, toutes deux à base de tampon
 * d'accumulation (voile semi-opaque, puis effacement en `destination-out`). Mathématiquement leur
 * résidu tend vers zéro ; en pratique l'arrondi sur 8 bits le bloque à un niveau non nul, donc
 * chaque étiquette de note, chaque onde et chaque traînée restait gravée **définitivement** dans le
 * décor — un voile gris qui s'accumulait toute la session.
 *
 * Garder l'historique de trajectoire supprime le problème par construction : rien ne persiste dans
 * un pixel, tout est redessiné depuis la donnée. Bonus : la longueur de traînée est exprimée en
 * secondes de simulation, donc identique à 60 Hz et à 120 Hz.
 */
export function createRenderer(stage: HTMLCanvasElement): Renderer {
  const base = require2d(stage)

  // Sprites pré-rendus par classe de hauteur : dessiner 200 halos par frame avec shadowBlur
  // coûte des dizaines de ms, un drawImage n'en coûte aucune.
  const sprites = Array.from({ length: 12 }, (_, i) => makeGlowSprite(i * 30))
  /** id de bille → suite de (x, y, temps de simulation), du plus ancien au plus récent */
  const trails = new Map<number, number[]>()
  let bounds: Bounds = { w: stage.clientWidth || 1, h: stage.clientHeight || 1 }
  let backdrop: CanvasGradient | null = null
  let reducedMotion = false

  function resize(): Bounds {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, stage.clientWidth)
    const h = Math.max(1, stage.clientHeight)
    stage.width = Math.round(w * dpr)
    stage.height = Math.round(h * dpr)
    base.setTransform(dpr, 0, 0, dpr, 0, 0)
    bounds = { w, h }
    backdrop = base.createLinearGradient(0, 0, 0, h)
    backdrop.addColorStop(0, BG_TOP)
    backdrop.addColorStop(1, BG_BOTTOM)
    return bounds
  }

  function drawBars(world: World, interaction: Interaction): void {
    base.lineCap = 'round'
    for (const bar of world.bars) {
      const hue = hueForMidi(bar.midi)
      const sinceHit = (world.time - bar.lastHitAt) * 1000
      const hot = bar.lastHitAt >= 0 && sinceHit < GLOW_MS ? 1 - sinceHit / GLOW_MS : 0

      if (bar.id === interaction.pendingDeleteBarId) {
        drawPendingDelete(bar)
        continue
      }

      // Barre éphémère absente : un fantôme, pour qu'on sache qu'elle va revenir. Sans lui, elle
      // disparaîtrait purement et le motif semblerait s'être cassé.
      if (!isPresent(bar, world.time)) {
        drawGhost(bar, hue)
        continue
      }

      if (hot > 0) {
        base.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.14 + hot * 0.3})`
        base.lineWidth = BAR_THICKNESS + 10 + hot * 14
        // Pointillé aussi sur la lueur : pleine, elle rebouchait les creux au moment même de l'impact,
        // donc exactement quand l'œil regarde la barre.
        if (bar.nature === 'ephemeral') {
          base.setLineDash(dashForHits(bar.hitsLeft))
          base.lineCap = 'butt'
        }
        strokeBar(bar.a, bar.b)
        base.setLineDash([])
        base.lineCap = 'round'
      }

      /*
       * Le **trait coloré** porte la nature, pas le cœur blanc. Première version : le pointillé était sur
       * le cœur de 1,6 px, totalement invisible sous les 7 px de couleur — sur la capture, une barre
       * éphémère était indiscernable d'un mur. C'est le trait le plus épais qui décide de la lecture.
       */
      base.strokeStyle = `hsl(${hue}, ${60 + hot * 30}%, ${44 + hot * 40}%)`
      base.lineWidth = BAR_THICKNESS
      if (bar.nature === 'ephemeral') {
        base.setLineDash(dashForHits(bar.hitsLeft))
        base.lineCap = 'butt'
      }
      strokeBar(bar.a, bar.b)
      base.setLineDash([])
      base.lineCap = 'round'

      /*
       * Le cœur blanc porte la **nature** de la barre, parce que c'est le trait le plus lisible à
       * distance : plein pour un mur, pointillé qui s'érode pour une éphémère. Le trampoline, lui, prend
       * des crans perpendiculaires — un pointillé de plus ne se distinguerait pas du premier.
       */
      base.strokeStyle = `hsla(0, 0%, 100%, ${0.12 + hot * 0.65})`
      base.lineWidth = 1.6
      // Même pointillé que le trait coloré : un cœur plein reboucherait les trous et effacerait la nature.
      if (bar.nature === 'ephemeral') {
        base.setLineDash(dashForHits(bar.hitsLeft))
        base.lineCap = 'butt'
      }
      strokeBar(bar.a, bar.b)
      base.setLineDash([])
      base.lineCap = 'round'

      if (bar.nature === 'trampoline') drawSpring(bar, hot)

      if (bar.id === interaction.hoveredBarId) drawGrabHandles(bar, interaction.hoveredKind, 'hover')
      else if (interaction.revealHandles) drawGrabHandles(bar, null, 'reveal')
    }
  }

  /**
   * Poignées de préhension au survol. Elles ne sont pas décoratives : sans elles, rien n'indique
   * qu'une extrémité s'attrape pour accorder la barre, et le geste central du produit reste invisible.
   */
  function drawGrabHandles(bar: { a: Vec2; b: Vec2 }, kind: GrabKind | null, mode: HandleMode): void {
    const reveal = mode === 'reveal'
    base.strokeStyle = `rgba(232, 240, 255, ${reveal ? 0.3 : 0.55})`
    base.lineWidth = 1.4
    strokeBar(bar.a, bar.b)

    for (const [point, own] of [
      [bar.a, 'endA'],
      [bar.b, 'endB'],
    ] as const) {
      if (kind === own) {
        base.beginPath()
        base.arc(point.x, point.y, 8, 0, Math.PI * 2)
        base.fillStyle = 'rgba(255, 255, 255, 0.95)'
        base.fill()
        continue
      }

      if (reveal) {
        /*
         * Révélation tactile : un **anneau** plus large que le bout de barre, pas un disque pâle.
         * Première version : un disque de 4,5 px à 22 % d'opacité posé sur un bout de barre déjà rond
         * de 3,5 px (`BAR_THICKNESS / 2`, `lineCap: 'round'`) et lumineux — ça ne se lisait pas « cette
         * barre a des poignées » mais « les barres ont un peu éclairci ». Un anneau qui **dépasse** du
         * bout de barre est la seule forme qui se distingue de la barre elle-même.
         */
        base.beginPath()
        base.arc(point.x, point.y, 8, 0, Math.PI * 2)
        base.strokeStyle = 'rgba(232, 240, 255, 0.8)'
        base.lineWidth = 2
        base.stroke()
        base.beginPath()
        base.arc(point.x, point.y, 2.5, 0, Math.PI * 2)
        base.fillStyle = 'rgba(255, 255, 255, 0.9)'
        base.fill()
        continue
      }

      // Survol : réglage d'origine, inchangé. Le `5.5 * strength + 2` de la première version faisait
      // passer ce rayon de 5,5 à 7,5 px — +36 % sur un réglage existant, sans que ce soit voulu.
      base.beginPath()
      base.arc(point.x, point.y, 5.5, 0, Math.PI * 2)
      base.fillStyle = 'rgba(232, 240, 255, 0.5)'
      base.fill()
    }
  }

  /** Une suppression doit s'annoncer **avant** le relâchement, sinon elle est vécue comme un accident. */
  function drawPendingDelete(bar: { a: Vec2; b: Vec2 }): void {
    base.save()
    base.setLineDash([7, 6])
    base.strokeStyle = 'rgba(255, 110, 130, 0.9)'
    base.lineWidth = BAR_THICKNESS
    strokeBar(bar.a, bar.b)
    base.restore()
  }

  /**
   * Motif de pointillé d'une barre éphémère : il **s'érode** à mesure qu'elle encaisse. C'est ce qui
   * répond à « la barre montre où elle en est » sans texte ni survol — la matière du trait se raréfie.
   */
  function dashForHits(hitsLeft: number): number[] {
    /*
     * Les intervalles sont **plus larges que l'épaisseur du trait** (7 px), sinon les bouts arrondis les
     * rebouchent : mesuré, un pointillé [16, 5] ne retirait que 4 % de matière et une barre éphémère
     * restait indiscernable d'un mur. Les barres ajourées sont d'ailleurs tracées à bouts francs.
     */
    if (hitsLeft >= 3) return [15, 11]
    if (hitsLeft === 2) return [9, 14]
    return [4, 18]
  }

  /**
   * Crans perpendiculaires d'un trampoline. Un ressort se lit à ses spires : des traits en travers de la
   * barre disent « ça repousse » là où un pointillé se confondrait avec l'éphémère, et où une couleur
   * différente entrerait en conflit avec la teinte, qui porte déjà la **hauteur**.
   */
  function drawSpring(bar: { a: Vec2; b: Vec2 }, hot: number): void {
    const dx = bar.b.x - bar.a.x
    const dy = bar.b.y - bar.a.y
    const length = Math.hypot(dx, dy)
    if (length < 1) return
    const ux = dx / length
    const uy = dy / length
    const nx = -uy
    const ny = ux
    const count = Math.max(3, Math.min(9, Math.round(length / 26)))
    const reach = BAR_THICKNESS * 0.9

    base.strokeStyle = `hsla(0, 0%, 100%, ${0.34 + hot * 0.5})`
    base.lineWidth = 1.5
    base.beginPath()
    for (let i = 0; i < count; i += 1) {
      // Répartis à l'intérieur, sans toucher les extrémités : là se trouvent les poignées de préhension.
      const t = (i + 1) / (count + 1)
      const px = bar.a.x + dx * t
      const py = bar.a.y + dy * t
      base.moveTo(px - nx * reach, py - ny * reach)
      base.lineTo(px + nx * reach, py + ny * reach)
    }
    base.stroke()
  }

  /** Barre éphémère absente : contour pointillé, sans lueur ni couleur pleine. Elle reviendra. */
  function drawGhost(bar: { a: Vec2; b: Vec2 }, hue: number): void {
    base.setLineDash([5, 9])
    base.strokeStyle = `hsla(${hue}, 60%, 70%, 0.22)`
    base.lineWidth = 2
    strokeBar(bar.a, bar.b)
    base.setLineDash([])
  }

  function strokeBar(a: Vec2, b: Vec2): void {
    base.beginPath()
    base.moveTo(a.x, a.y)
    base.lineTo(b.x, b.y)
    base.stroke()
  }

  function drawRipples(effects: Effects): void {
    base.globalCompositeOperation = 'lighter'
    for (const r of effects.ripples) {
      const p = r.age / r.ttl
      // Mouvement réduit : l'onde ne s'étend pas, elle s'estompe sur place et plus vite.
      const radius = reducedMotion ? 10 + r.strength * 8 : 6 + p * (34 + r.strength * 62)
      const alpha = (1 - p) * (0.25 + r.strength * 0.55) * (reducedMotion ? 0.7 : 1)
      base.strokeStyle = `hsla(${r.hue}, 100%, 72%, ${alpha})`
      base.lineWidth = (1 - p) * (1.5 + r.strength * 3.5)
      base.beginPath()
      base.arc(r.x, r.y, radius, 0, Math.PI * 2)
      base.stroke()
    }
    base.globalCompositeOperation = 'source-over'
  }

  /**
   * Les étincelles se dessinent **sous** les ondes : l'anneau doit rester lisible par-dessus la gerbe,
   * sinon l'impact perd son point de repère. Un simple `fillRect` par étincelle — pas de halo, pas de
   * `shadowBlur` : à 240 étincelles, un sprite par pièce coûterait plus que tout le reste de la frame.
   */
  function drawParticles(effects: Effects): void {
    base.globalCompositeOperation = 'lighter'
    base.lineCap = 'round'
    for (const particle of effects.particles) {
      const fade = particleFade(particle)
      // Un **segment** le long de la vitesse, pas un point : en carré de 2 px, les étincelles se
      // lisaient comme des pixels morts au milieu du néon (vérifié sur capture). La traînée courte
      // donne la direction de l'éclat, ce qu'un point ne peut pas faire.
      const streak = STREAK_SECONDS * (0.4 + fade * 0.6)
      base.strokeStyle = `hsla(${hueForMidi(particle.midi)}, 100%, ${72 + fade * 22}%, ${fade * (0.55 + particle.strength * 0.45)})`
      base.lineWidth = 1.1 + particle.strength * 1.5 * fade
      base.beginPath()
      base.moveTo(particle.x, particle.y)
      base.lineTo(particle.x - particle.vx * streak, particle.y - particle.vy * streak)
      base.stroke()
    }
    base.globalCompositeOperation = 'source-over'
  }

  /**
   * Points de lâcher. Un anneau ouvert **vers le bas** avec une flèche : il dit « ça retombe d'ici »,
   * là où une source pulse. Les deux sont de petites cibles ponctuelles, donc leur forme doit les
   * séparer — pas leur seule couleur, déjà prise par la hauteur des notes.
   */
  function drawDroppers(world: World, interaction: Interaction): void {
    for (const dropper of world.droppers) {
      const doomed = dropper.id === interaction.pendingDeleteDropperId
      const hovered = dropper.id === interaction.hoveredDropperId
      const hue = dropper.hue
      const alpha = doomed ? 0.35 : hovered ? 0.95 : 0.7

      base.strokeStyle = doomed
        ? 'rgba(255, 138, 138, 0.9)'
        : `hsla(${hue}, 90%, 78%, ${alpha})`
      base.lineWidth = hovered ? 2.4 : 1.8
      if (doomed) base.setLineDash([4, 4])
      base.beginPath()
      // Arc ouvert en bas : l'ouverture pointe vers là où la bille tombe.
      base.arc(dropper.pos.x, dropper.pos.y, 9, Math.PI * 0.15, Math.PI * 0.85, true)
      base.stroke()
      base.beginPath()
      base.moveTo(dropper.pos.x, dropper.pos.y - 2)
      base.lineTo(dropper.pos.x, dropper.pos.y + 9)
      base.moveTo(dropper.pos.x - 4, dropper.pos.y + 4)
      base.lineTo(dropper.pos.x, dropper.pos.y + 9)
      base.lineTo(dropper.pos.x + 4, dropper.pos.y + 4)
      base.stroke()
      base.setLineDash([])
    }
  }

  function drawDraft(draft: Draft): void {
    base.save()
    base.setLineDash([9, 7])
    base.strokeStyle = 'rgba(190, 214, 255, 0.75)'
    base.lineWidth = 2
    strokeBar(draft.a, draft.b)
    base.setLineDash([])

    base.fillStyle = 'rgba(190, 214, 255, 0.9)'
    for (const p of [draft.a, draft.b]) {
      base.beginPath()
      base.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
      base.fill()
    }

    base.font = '600 15px ui-sans-serif, system-ui, sans-serif'
    base.textAlign = 'center'
    base.textBaseline = 'bottom'
    const midX = (draft.a.x + draft.b.x) / 2
    const midY = (draft.a.y + draft.b.y) / 2
    const width = base.measureText(draft.label).width + 16
    base.fillStyle = 'rgba(9, 12, 28, 0.8)'
    base.fillRect(midX - width / 2, midY - 30, width, 22)
    base.fillStyle = '#e8f0ff'
    base.fillText(draft.label, midX, midY - 12)
    base.restore()
  }

  /**
   * Une source se voit à sa pulsation : l'anneau se resserre à l'approche de son prochain lâcher.
   * Sans ce battement, rien ne distingue une source d'une décoration, et sa période reste invisible.
   */
  function drawEmitters(world: World, interaction: Interaction): void {
    for (const emitter of world.emitters) {
      const remaining = Math.max(0, emitter.nextAt - world.time)
      // Mouvement réduit : anneau fixe, à mi-course, plutôt qu'une pulsation continue.
      const progress = reducedMotion
        ? 0.5
        : 1 - Math.min(1, remaining / Math.max(emitterPeriod(emitter, world.bpm), 1e-6))
      const doomed = emitter.id === interaction.pendingDeleteEmitterId
      const hovered = emitter.id === interaction.hoveredEmitterId

      base.strokeStyle = doomed ? 'rgba(255, 110, 130, 0.95)' : `hsla(${emitter.hue}, 90%, 78%, ${0.35 + progress * 0.5})`
      base.lineWidth = hovered ? 3 : 2
      base.save()
      if (doomed) base.setLineDash([6, 5])
      base.beginPath()
      base.arc(emitter.pos.x, emitter.pos.y, 13 - progress * 5, 0, Math.PI * 2)
      base.stroke()
      base.restore()

      base.globalCompositeOperation = 'lighter'
      base.fillStyle = `hsla(${emitter.hue}, 100%, 80%, ${0.2 + progress * 0.6})`
      base.beginPath()
      base.arc(emitter.pos.x, emitter.pos.y, 3.5, 0, Math.PI * 2)
      base.fill()
      base.globalCompositeOperation = 'source-over'
    }
  }

  /**
   * La roue de sélection. Dessinée **par-dessus tout** : c'est un choix en cours, et une bille qui
   * passerait devant un secteur le rendrait illisible au moment précis où on le lit.
   *
   * Un voile sombre sous les secteurs plutôt qu'un simple contour : les libellés se posent sur une scène
   * qui bouge, et sans fond opaque ils deviennent illisibles dès qu'une traînée passe dessous.
   */
  /**
   * Libellé réellement dessiné pour un secteur, et sa largeur mesurée. Le long si sa mesure tient dans
   * le budget géométrique, sinon le court. La mesure vit ici parce que c'est le seul endroit qui sache
   * mesurer un texte ; le budget vient du cœur pur, qui sait la géométrie.
   */
  function labelFor(
    option: WheelOption<string>,
    options: readonly WheelOption<string>[],
    count: number,
    aimed: boolean,
  ): { lines: string[]; width: number } {
    /*
     * `save`/`restore` autour d'une écriture de police : `measureText` en a besoin, mais une fonction
     * qui **observe** ne doit pas laisser le contexte de dessin modifié derrière elle. C'était inoffensif
     * tant que chaque `fillText` reposait sa police juste avant — soit un effet d'observateur à un
     * refactor près.
     */
    base.save()
    base.font = wheelFont(aimed)
    const measure = (text: string) => base.measureText(text).width
    // Toute la roue est consultée, pas seulement cette option : la stratégie est commune (cf. `chooseLabels`).
    const index = options.indexOf(option)
    const lines = chooseLabels(options, labelWidthBudget(count), measure)[index] ?? [option.label]
    const width = Math.max(...lines.map(measure))
    base.restore()
    return { lines, width }
  }

  function wheelFont(aimed: boolean): string {
    return aimed
      ? '700 14px ui-sans-serif, system-ui, sans-serif'
      : '600 13px ui-sans-serif, system-ui, sans-serif'
  }

  /**
   * Ce qui a été dessiné, pour que « les cinq timbres sont lisibles » s'asserte sur des **boîtes**
   * plutôt que sur une liste de chaînes. Une roue dont deux libellés se recouvrent expose exactement la
   * même liste qu'une roue lisible — c'est le défaut qui est passé, et il s'est vu sur une capture.
   */
  function wheelLabelBoxes(view: WheelView): LabelBox[] {
    const count = view.wheel.options.length
    return view.wheel.options.flatMap((option, index) => {
      const anchor = labelAnchor(view.wheel, index)
      const aimed = view.aim?.kind === 'sector' && view.aim.index === index
      const { lines, width } = labelFor(option, view.wheel.options, count, aimed)
      return [
        { text: lines.join(' '), lines, width, x: anchor.x, y: anchor.y, budget: labelWidthBudget(count) },
      ]
    })
  }

  function drawWheel(view: WheelView): void {
    const { wheel } = view
    const aimed = view.aim?.kind === 'sector' ? view.aim.index : null
    const count = wheel.options.length
    const { x, y } = wheel.center
    // Écart entre secteurs exprimé en pixels de l'anneau extérieur : à 3 secteurs comme à 8, le trait
    // de séparation garde la même épaisseur à l'œil.
    const gap = 3 / OUTER_RADIUS

    base.save()
    // Presque opaque : le disque **capte** les gestes, il doit donc avoir l'air de les capter. À 0,82 on
    // voyait les barres au travers, ce qui laissait croire qu'on pouvait encore les viser.
    base.fillStyle = 'rgba(6, 9, 24, 0.94)'
    base.beginPath()
    base.arc(x, y, OUTER_RADIUS, 0, Math.PI * 2)
    base.fill()

    for (let index = 0; index < count; index += 1) {
      const start = sectorStartAngle(count, index) + gap
      const end = sectorStartAngle(count, index + 1) - gap
      const option = wheel.options[index]
      if (!option) continue
      const isAimed = index === aimed
      const isCurrent = option.value === wheel.current

      base.beginPath()
      base.arc(x, y, OUTER_RADIUS, start, end)
      base.arc(x, y, INNER_RADIUS, end, start, true)
      base.closePath()
      base.fillStyle = isAimed ? 'rgba(150, 196, 255, 0.34)' : 'rgba(120, 160, 230, 0.13)'
      base.fill()
      base.lineWidth = isAimed ? 2 : 1
      base.strokeStyle = isAimed ? 'rgba(214, 232, 255, 0.95)' : 'rgba(150, 180, 240, 0.35)'
      base.stroke()

      const anchor = labelAnchor(wheel, index)
      const drawn = labelFor(option, wheel.options, count, isAimed)
      base.font = wheelFont(isAimed)
      base.textAlign = 'center'
      base.textBaseline = 'middle'
      base.fillStyle = isAimed ? '#ffffff' : 'rgba(232, 240, 255, 0.82)'
      // Deux lignes centrées sur l'ancre : sans le décalage, elles se superposeraient exactement.
      const lineHeight = 14
      const top = anchor.y - ((drawn.lines.length - 1) * lineHeight) / 2
      drawn.lines.forEach((line, row) => base.fillText(line, anchor.x, top + row * lineHeight))

      /*
       * L'option en place est marquée par un point, pas par une couleur : la couleur est déjà prise par
       * la visée, et deux significations sur le même canal se confondent exactement au moment où elles
       * comptent — quand on vise l'option courante.
       */
      if (isCurrent) {
        base.beginPath()
        base.arc(anchor.x, anchor.y + 13, 2.5, 0, Math.PI * 2)
        base.fillStyle = 'rgba(255, 236, 170, 0.95)'
        base.fill()
      }
    }

    /*
     * Zone morte : relâcher ici garde la roue. Le trait s'allume quand le pointeur y est, et **au rayon
     * exact** de la zone — dessiné 4 px en dedans, il annonçait une cible plus petite que la vraie.
     */
    base.beginPath()
    base.arc(x, y, INNER_RADIUS, 0, Math.PI * 2)
    base.setLineDash([4, 4])
    base.lineWidth = 1
    /*
     * `aim === null` — rien n'a encore été lu — se dessine comme `pin`, parce que c'est **ce que le
     * relâchement ferait**. Le traiter comme « pas pin » éteignait l'affordance « relâcher ici garde la
     * roue » exactement à l'instant où elle s'adresse à quelqu'un qui découvre : première image, doigt
     * encore immobile. À la souris c'était transitoire ; au doigt, ça durait tout l'appui.
     */
    const willPin = view.aim === null || view.aim.kind === 'pin'
    base.strokeStyle = willPin ? 'rgba(214, 232, 255, 0.8)' : 'rgba(150, 180, 240, 0.28)'
    base.stroke()
    base.setLineDash([])

    /*
     * Hors de l'anneau, **pointeur enfoncé** : relâcher jette. Sans signal distinct, cet état était
     * identique au pixel près à celui de la zone morte, qui fait l'inverse — deux issues opposées, un
     * seul dessin. La roue s'estompe, et un liseré rouge dit où le choix s'arrête.
     *
     * Réservé aux roues **à ressort** : sur une roue épinglée, le relâchement n'est pas imminent et
     * sortir de l'anneau est le trajet normal depuis le bouton qui l'a ouverte. L'alarme s'affichait
     * alors pendant tout le temps de lecture des options.
     */
    if (view.aim?.kind === 'cancel' && !view.pinned) {
      base.fillStyle = 'rgba(6, 9, 24, 0.6)'
      base.beginPath()
      base.arc(x, y, OUTER_RADIUS, 0, Math.PI * 2)
      base.fill()
      /*
       * Épais et franc. Une première version à 2 px et 0,85 d'opacité était **mesurable** (251 pixels
       * rouges contre 0) et pourtant invisible en regardant la capture : un signal qui ne passe que le
       * test n'est pas un signal. La même leçon que les étincelles de l'US6.
       */
      base.strokeStyle = 'rgba(255, 120, 140, 0.95)'
      base.lineWidth = 5
      base.setLineDash([10, 8])
      base.beginPath()
      base.arc(x, y, OUTER_RADIUS - 2, 0, Math.PI * 2)
      base.stroke()
      base.setLineDash([])
    }
    base.restore()
  }

  function recordTrails(world: World): void {
    for (const ball of world.balls) {
      let points = trails.get(ball.id)
      if (!points) {
        points = []
        trails.set(ball.id, points)
      }
      points.push(ball.pos.x, ball.pos.y, world.time)
      let drop = 0
      while (drop + 3 <= points.length && world.time - (points[drop + 2] ?? 0) > TRAIL_SECONDS) {
        drop += 3
      }
      // On garde toujours au moins deux points, sinon une bille lente n'a plus de traînée du tout.
      if (drop > 0 && points.length - drop >= 6) points.splice(0, drop)
    }
    if (trails.size > world.balls.length) {
      const alive = new Set(world.balls.map((ball) => ball.id))
      for (const id of trails.keys()) {
        if (!alive.has(id)) trails.delete(id)
      }
    }
  }

  function drawBalls(world: World): void {
    base.globalCompositeOperation = 'lighter'
    base.lineCap = 'round'
    base.lineJoin = 'round'

    for (const ball of world.balls) {
      const points = reducedMotion ? undefined : trails.get(ball.id)
      if (points && points.length >= 6) {
        const headX = points[points.length - 3] ?? ball.pos.x
        const headY = points[points.length - 2] ?? ball.pos.y
        const tailX = points[0] ?? headX
        const tailY = points[1] ?? headY
        // Dégradé le long de la traînée : un seul tracé par bille, et un fondu franc vers la queue.
        const gradient = base.createLinearGradient(tailX, tailY, headX, headY)
        gradient.addColorStop(0, `hsla(${ball.hue}, 100%, 70%, 0)`)
        gradient.addColorStop(1, `hsla(${ball.hue}, 100%, 76%, 0.75)`)
        base.strokeStyle = gradient
        base.lineWidth = ball.radius * 1.5
        base.beginPath()
        base.moveTo(tailX, tailY)
        for (let i = 3; i < points.length; i += 3) {
          base.lineTo(points[i] ?? headX, points[i + 1] ?? headY)
        }
        base.stroke()
      }

      const sprite = sprites[Math.round(ball.hue / 30) % 12]
      if (!sprite) continue
      const size = ball.radius * 7
      base.drawImage(sprite, ball.pos.x - size / 2, ball.pos.y - size / 2, size, size)
    }

    base.globalCompositeOperation = 'source-over'
  }

  return {
    resize,
    isReducedMotion() {
      return reducedMotion
    },
    wheelLabels(view) {
      return wheelLabelBoxes(view)
    },
    trailPointCount() {
      let total = 0
      for (const points of trails.values()) total += points.length / 3
      return total
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced
      // La Map d'historique est vidée : sinon réactiver le mouvement ferait réapparaître d'un coup des
      // traînées vieilles de plusieurs secondes.
      if (reduced) trails.clear()
    },
    draw(world, effects, draft, interaction) {
      if (!reducedMotion) recordTrails(world)
      if (backdrop) {
        base.fillStyle = backdrop
        base.fillRect(0, 0, bounds.w, bounds.h)
      }
      drawParticles(effects)
      drawRipples(effects)
      drawEmitters(world, interaction)
      drawDroppers(world, interaction)
      drawBars(world, interaction)
      if (draft) drawDraft(draft)
      drawBalls(world)
      // En dernier : un choix en cours ne doit pas passer sous une bille au moment où on le lit.
      if (interaction.wheel) drawWheel(interaction.wheel)
    },
  }
}
