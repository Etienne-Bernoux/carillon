/**
 * Contrat partagé du noyau. Ce fichier est la frontière entre la simulation, l'audio et le rendu :
 * il ne dépend de rien et n'importe aucun DOM.
 */

export interface Vec2 {
  x: number
  y: number
}

export interface Ball {
  readonly id: number
  pos: Vec2
  vel: Vec2
  readonly radius: number
  alive: boolean
  /** temps de simulation écoulé depuis l'apparition, en secondes */
  age: number
  /** teinte 0..360 ; le rendu s'en sert, la physique l'ignore */
  readonly hue: number
}

export interface Bar {
  readonly id: number
  a: Vec2
  b: Vec2
  /** coefficient de restitution, 0..1 */
  restitution: number
  /** note MIDI jouée à l'impact, figée à la création de la barre */
  midi: number
  /** temps de simulation du dernier impact, en secondes ; -1 si jamais touchée */
  lastHitAt: number
}

export interface ImpactEvent {
  barId: number
  ballId: number
  point: Vec2
  /** normale unitaire, orientée vers le côté d'où arrive la bille */
  normal: Vec2
  /** |v·n| avant réflexion, en px/s */
  speed: number
  /** temps de simulation absolu de l'impact, en secondes */
  at: number
}

export interface Bounds {
  w: number
  h: number
}

export interface World {
  balls: Ball[]
  bars: Bar[]
  /** px/s² */
  gravity: Vec2
  bounds: Bounds
  /** temps de simulation cumulé, en secondes */
  time: number
  nextBallId: number
  nextBarId: number
}
