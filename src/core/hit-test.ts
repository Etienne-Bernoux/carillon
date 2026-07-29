import type { Bar, Dropper, Emitter, Vec2 } from './types'

/** Ce qu'on a attrapé sur une barre : son corps, ou l'une de ses deux extrémités. */
export type GrabKind = 'body' | 'endA' | 'endB'

export interface BarHit {
  bar: Bar
  kind: GrabKind
  /** distance du point de préhension à la géométrie visée, en px */
  distance: number
}

export interface EmitterHit {
  emitter: Emitter
  distance: number
}

/**
 * Ce que le pointeur attrape. Généralisé en US4 : une entité qu'on ne pourrait ni déplacer ni jeter
 * réintroduirait exactement la frustration que l'US3 a corrigée pour les barres.
 */
export interface DropperHit {
  dropper: Dropper
  distance: number
}

export type Grab =
  | ({ target: 'bar' } & BarHit)
  | ({ target: 'emitter' } & EmitterHit)
  | ({ target: 'dropper' } & DropperHit)

export interface HitRadii {
  /** rayon de préhension du corps */
  body: number
  /** rayon de préhension d'une extrémité */
  endpoint: number
  /** rayon de préhension d'une source */
  emitter: number
}

/** Souris : précise. */
export const MOUSE_RADII: HitRadii = { body: 12, endpoint: 14, emitter: 18 }
/** Doigt : généreux, sinon rien n'est attrapable au pouce — la source est la plus petite cible. */
export const TOUCH_RADII: HitRadii = { body: 18, endpoint: 24, emitter: 26 }

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSquared = abx * abx + aby * aby
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared))
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t))
}

/**
 * Avantage donné à une extrémité face à un corps, en px de distance équivalente.
 *
 * Un arbitrage global « toute extrémité bat tout corps » était faux : l'extrémité d'une **autre**
 * barre, à 23 px, gagnait contre le corps de celle qu'on visait, à 0 px — on éditait donc un autre
 * objet que celui sous le doigt. Un biais borné garde l'intention (sur une même barre, ou à
 * distances comparables, accorder l'emporte sur déplacer) sans jamais faire gagner un candidat
 * nettement plus lointain.
 */
const ENDPOINT_BIAS = 10
/** Même logique de biais pour une source : petite cible ronde, on aide le doigt à la viser. */
const EMITTER_BIAS = 10

/**
 * Barre visée par un point de préhension, et **par quoi** on l'attrape.
 *
 * Tous les candidats — corps et extrémités, toutes barres confondues — sont comparés sur une seule
 * échelle de distance, l'extrémité bénéficiant de `ENDPOINT_BIAS`. Le parcours suit l'ordre des
 * `id` avec une comparaison stricte, donc deux barres superposées donnent toujours le même résultat.
 */
/** Score de comparaison d'une préhension : plus petit gagne. Une seule définition, pas deux. */
function grabScore(hit: BarHit): number {
  return hit.distance - (hit.kind === 'body' ? 0 : ENDPOINT_BIAS)
}

export function hitTestBars(
  bars: readonly Bar[],
  point: Vec2,
  radii: HitRadii = MOUSE_RADII,
): BarHit | null {
  let best: BarHit | null = null
  let bestScore = Number.POSITIVE_INFINITY

  function consider(bar: Bar, kind: GrabKind, distance: number, limit: number, bias: number): void {
    if (distance > limit) return
    const score = distance - bias
    if (score < bestScore) {
      bestScore = score
      best = { bar, kind, distance }
    }
  }

  for (const bar of bars) {
    const toA = Math.hypot(point.x - bar.a.x, point.y - bar.a.y)
    const toB = Math.hypot(point.x - bar.b.x, point.y - bar.b.y)
    // L'extrémité la plus proche des deux seulement : sur une barre courte, les deux sont à portée
    // et se voleraient la préhension d'une frame à l'autre.
    if (toA <= toB) consider(bar, 'endA', toA, radii.endpoint, ENDPOINT_BIAS)
    else consider(bar, 'endB', toB, radii.endpoint, ENDPOINT_BIAS)

    // Le corps est évalué **même** si une extrémité est à portée : sinon une barre dont on tient le
    // milieu devenait inattrapable dès qu'un bout traînait dans le rayon.
    consider(bar, 'body', distanceToSegment(point, bar.a, bar.b), radii.body, 0)
  }

  return best
}

/**
 * Ce que le pointeur attrape dans le monde : barre ou source.
 *
 * Tous les candidats sont ramenés à un **score** unique (distance moins un biais selon la nature de
 * la cible), pour la même raison qu'en US3 : un arbitrage par catégorie — « toute source bat toute
 * barre » — ferait gagner une cible nettement plus lointaine, et on éditerait autre chose que ce
 * qu'on vise.
 */
export function hitTestWorld(
  bars: readonly Bar[],
  emitters: readonly Emitter[],
  point: Vec2,
  radii: HitRadii = MOUSE_RADII,
  droppers: readonly Dropper[] = [],
): Grab | null {
  const bar = hitTestBars(bars, point, radii)
  const barScore = bar ? grabScore(bar) : Number.POSITIVE_INFINITY

  let emitterHit: EmitterHit | null = null
  for (const emitter of emitters) {
    const distance = Math.hypot(point.x - emitter.pos.x, point.y - emitter.pos.y)
    if (distance <= radii.emitter && (!emitterHit || distance < emitterHit.distance)) {
      emitterHit = { emitter, distance }
    }
  }

  // Le point de lâcher partage le rayon et le biais des sources : ce sont deux petites cibles
  // ponctuelles, et les départager autrement ferait gagner la plus lointaine.
  let dropperHit: DropperHit | null = null
  for (const dropper of droppers) {
    const distance = Math.hypot(point.x - dropper.pos.x, point.y - dropper.pos.y)
    if (distance <= radii.emitter && (!dropperHit || distance < dropperHit.distance)) {
      dropperHit = { dropper, distance }
    }
  }

  const emitterScore = emitterHit ? emitterHit.distance - EMITTER_BIAS : Number.POSITIVE_INFINITY
  const dropperScore = dropperHit ? dropperHit.distance - EMITTER_BIAS : Number.POSITIVE_INFINITY
  const best = Math.min(barScore, emitterScore, dropperScore)

  if (dropperHit && dropperScore === best) return { target: 'dropper', ...dropperHit }
  if (emitterHit && emitterScore === best) return { target: 'emitter', ...emitterHit }
  return bar ? { target: 'bar', ...bar } : null
}
