import type { BarNature } from './nature'

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
  /**
   * Point de lâcher. Une bille recyclée y revient — c'est ce qui transforme un geste unique en
   * élément rythmique permanent, sans avoir à poser une source.
   */
  readonly origin: Vec2
  /**
   * Une bille lâchée à la main **revient** quand elle sort de l'écran ; une bille née d'une source,
   * non — sa source la ré-émet déjà, et la recycler doublerait sa cadence.
   */
  readonly recycle: boolean
}

export interface Bar {
  readonly id: number
  a: Vec2
  b: Vec2
  /** coefficient de restitution, 0..1 — la nature peut le remplacer (cf. `nature.ts`) */
  restitution: number
  /** mur, trampoline ou éphémère : ce que la physique fait de la barre */
  nature: BarNature
  /**
   * Impacts audibles restants avant qu'une barre éphémère s'efface. **État transitoire** : exclu des
   * instantanés d'historique, au même titre que `nextAt` d'une source — l'inclure tuerait la
   * déduplication et ferait réapparaître un état de jeu périmé à l'annulation (leçon de l'US4).
   */
  hitsLeft: number
  /** instant de simulation absolu jusqu'auquel la barre est absente ; transitoire, comme `hitsLeft` */
  absentUntil: number
  /** note MIDI jouée à l'impact, figée à la création de la barre */
  midi: number
  /** temps de simulation du dernier impact, en secondes ; -1 si jamais touchée */
  lastHitAt: number
}

/**
 * Source qui lâche une bille à intervalle régulier. C'est ce qui fait qu'une scène joue toute seule
 * au lieu de mourir dès que les billes sont sorties.
 */
export interface Emitter {
  readonly id: number
  pos: Vec2
  /**
   * Index dans `DIVISIONS` (cf. `clock.ts`) — une **division de mesure**, pas une durée libre. Deux
   * sources de même division émettent exactement en phase, indéfiniment ; deux périodes libres
   * dérivent l'une par rapport à l'autre pour toujours.
   */
  divisionIndex: number
  /**
   * Temps de simulation du prochain lâcher. On stocke une échéance, pas un compteur de frames ni un
   * `Date.now()` : c'est ce qui garde l'émission reproductible à graine égale.
   */
  nextAt: number
  /** teinte des billes émises ; le rendu s'en sert, la physique l'ignore */
  readonly hue: number
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

/** Retour programmé d'une bille recyclée, sur un instant de grille. */
export interface Respawn {
  at: number
  pos: Vec2
  hue: number
}

export interface World {
  balls: Ball[]
  bars: Bar[]
  emitters: Emitter[]
  /** px/s² */
  gravity: Vec2
  bounds: Bounds
  /** temps de simulation cumulé, en secondes */
  time: number
  /**
   * Tempo global, en battements par minute. Global et non par source : un tempo par source serait
   * polyrythmique et inaudible, alors qu'une **division** par source suffit à construire un motif.
   */
  bpm: number
  /**
   * Billes en attente de retour, avec l'instant de grille auquel elles reviennent. Une file plutôt
   * qu'un drapeau sur la bille : une bille morte est retirée du tableau à la frame même, donc il n'y
   * aurait rien sur quoi porter l'attente.
   */
  respawns: Respawn[]
  nextBallId: number
  nextBarId: number
  nextEmitterId: number
}
