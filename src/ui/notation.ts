const NAMES = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'] as const

/** Nom français de la note MIDI, avec son octave (60 → « Do4 »). */
export function noteName(midi: number): string {
  const rounded = Math.round(midi)
  const pitchClass = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return `${NAMES[pitchClass] ?? '?'}${octave}`
}

/** Teinte stable par classe de hauteur : une même note garde toujours sa couleur. */
export function hueForMidi(midi: number): number {
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12
  return pitchClass * 30
}
