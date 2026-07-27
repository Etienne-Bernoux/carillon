/**
 * Arithmétique 2D pure sur `Vec2`. Fonctions libres, aucune mutation des entrées.
 */
import type { Vec2 } from './types'

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

export function len2(a: Vec2): number {
  return a.x * a.x + a.y * a.y
}

export function len(a: Vec2): number {
  return Math.sqrt(len2(a))
}

export function normalize(a: Vec2): Vec2 {
  const l = len(a)
  if (l === 0) return { x: 0, y: 0 }
  return { x: a.x / l, y: a.y / l }
}

/** Rotation +90°, non normalisée : `perp(a)` a la même longueur que `a`. */
export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x }
}
