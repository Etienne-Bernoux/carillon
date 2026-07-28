#!/usr/bin/env node
/**
 * Harnais de preuve visuelle de Carillon.
 *
 * Sert l'app via Vite (programmatique), pilote Chrome système via puppeteer-core,
 * joue des scénarios avec de vrais gestes souris, capture des PNG et échoue
 * bruyamment (exit 1) sur la moindre erreur console / assertion ratée.
 *
 * Usage :
 *   node scripts/shoot.mjs                 # tous les scénarios
 *   node scripts/shoot.mjs sandbox          # un seul scénario
 *   node scripts/shoot.mjs --headed         # Chrome visible
 *   node scripts/shoot.mjs --keep           # laisse navigateur + serveur ouverts
 *   node scripts/shoot.mjs --smoke          # fixture d'auto-vérification du harnais
 */
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PROOFS_DIR = path.join(ROOT, 'docs', 'proofs')
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const ALL_SCENARIOS = ['sandbox', 'stress', 'mobile', 'controls', 'resize', 'edit', 'touch', 'alive']

const rawArgs = process.argv.slice(2)
const flags = new Set(rawArgs.filter((a) => a.startsWith('--')))
const headed = flags.has('--headed')
const keep = flags.has('--keep')
const smoke = flags.has('--smoke')
const scenarioArg = rawArgs.find((a) => !a.startsWith('--'))

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Attend un re-render réel (deux rAF) avant de lire le DOM/canvas — piège connu. */
function tick(page) {
  return page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
}

async function waitForCarillon(page) {
  try {
    await page.waitForFunction(() => window.__carillon?.version === 1, { timeout: 10_000 })
  } catch {
    throw new Error(
      "window.__carillon absent (ou version !== 1) après 10s d'attente. " +
        "L'app ne l'expose pas encore, ou le contrat de debug a changé — " +
        'vérifier src/main.ts.'
    )
  }
}

/** Accumule captures + assertions d'un scénario et fournit le verdict final. */
class Recorder {
  constructor(name) {
    this.name = name
    this.dir = path.join(PROOFS_DIR, name)
    this.shotIndex = 0
    this.assertions = []
    this.consoleIssues = []
  }

  async shot(page, step) {
    await mkdir(this.dir, { recursive: true })
    const n = String(++this.shotIndex).padStart(2, '0')
    const file = path.join(this.dir, `${n}-${step}.png`)
    await page.screenshot({ path: file })
    console.log(`  [${this.name}] capture -> ${path.relative(ROOT, file)}`)
    return file
  }

  assert(label, condition, detail = '') {
    const ok = Boolean(condition)
    this.assertions.push({ label, ok, detail })
    console.log(`  [${this.name}] assert ${ok ? 'OK  ' : 'FAIL'} — ${label}${detail ? ` (${detail})` : ''}`)
    if (!ok) process.exitCode = 1
    return ok
  }

  attachConsoleListeners(page) {
    page.on('console', (msg) => {
      const type = msg.type()
      if (type === 'error' || type === 'warning') {
        // Chrome réclame /favicon.ico de lui-même : un 404 dessus ne dit rien sur l'app et
        // rendrait le harnais rouge en permanence.
        if (/favicon\.ico/.test(msg.location()?.url ?? '')) return
        const text = `[console.${type}] ${msg.text()}`
        this.consoleIssues.push(text)
        console.error(`  [${this.name}] ${text}`)
        process.exitCode = 1
      }
    })
    page.on('pageerror', (err) => {
      const text = `[pageerror] ${err.message}`
      this.consoleIssues.push(text)
      console.error(`  [${this.name}] ${text}`)
      process.exitCode = 1
    })
  }

  summarize() {
    const total = this.assertions.length
    const passed = this.assertions.filter((a) => a.ok).length
    const failed = this.assertions.filter((a) => !a.ok)
    const verdict = this.consoleIssues.length === 0 && failed.length === 0 ? 'PASS' : 'FAIL'
    return {
      scenario: this.name,
      verdict,
      shots: this.shotIndex,
      assertions: `${passed}/${total}`,
      consoleIssues: this.consoleIssues.length,
    }
  }
}

// --- Scénarios de l'app -----------------------------------------------------

async function dragBar(page, from, to, steps = 6) {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps
    const y = from[1] + ((to[1] - from[1]) * i) / steps
    await page.mouse.move(x, y)
  }
  await page.mouse.up()
}

/** Même geste que `dragBar`, mais avec de vrais événements tactiles (US3, C7). */
async function dragTouch(page, from, to, steps = 8) {
  await page.touchscreen.touchStart(from[0], from[1])
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps
    const y = from[1] + ((to[1] - from[1]) * i) / steps
    await page.touchscreen.touchMove(x, y)
  }
  await page.touchscreen.touchEnd()
}

/**
 * Zone jouable mesurée depuis le DOM, HUD exclu, avec une marge de sécurité (bord de suppression à
 * 14 px + rayon de préhension) : calculée à l'exécution plutôt que devinée sur la CSS — la seule
 * façon de garantir des coordonnées de test réellement vides et loin du HUD, quelle que soit la
 * mise en page (barre d'outils en haut sur desktop, empilée en bas sous 640 px).
 */
async function computePlayArea(page, margin = 40) {
  return page.evaluate((margin) => {
    const rects = Array.from(document.querySelectorAll('[data-hud]'))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
    const vw = window.innerWidth
    const vh = window.innerHeight
    const middle = vh / 2
    let top = 0
    let bottom = vh
    for (const r of rects) {
      if ((r.top + r.bottom) / 2 < middle) top = Math.max(top, r.bottom)
      else bottom = Math.min(bottom, r.top)
    }
    return { left: margin, right: vw - margin, top: top + margin, bottom: bottom - margin }
  }, margin)
}

async function runSandbox(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)

  // On repart d'une scène vide : depuis l'US3 une barre a un corps ET des extrémités attrapables,
  // donc glisser ou cliquer sur la scène d'accueil par-dessus une barre existante ne dessine plus
  // rien ou joue sa note au lieu de lâcher une bille — l'app fait ce qu'il faut, mais rend les
  // coordonnées de ce scénario ambiguës. Une scène vide élimine l'ambiguïté à la source.
  await page.evaluate(() => window.__carillon.reset())
  await tick(page)
  const empty = await page.evaluate(() => window.__carillon.stats())
  rec.assert('scène vide après reset()', empty.bars === 0 && empty.balls === 0, `bars=${empty.bars} balls=${empty.balls}`)

  // Zone jouable mesurée depuis le DOM (HUD exclu), découpée en 4 bandes : la première pour les
  // billes, les 3 suivantes pour les barres — aucun chevauchement possible entre gestes.
  const area = await computePlayArea(page, 40)
  const w = area.right - area.left
  const h = area.bottom - area.top
  const bandH = h / 4
  const dropY = area.top + bandH * 0.5
  const barTop = (i) => area.top + bandH * (i + 1) + bandH * 0.15
  const barDy = bandH * 0.5

  // Glisser à la souris pour dessiner 3 barres à des angles différents —
  // on prouve le vrai chemin d'entrée, pas seulement l'API de debug.
  await dragBar(page, [area.left + w * 0.05, barTop(0)], [area.left + w * 0.45, barTop(0) + barDy])
  await dragBar(page, [area.left + w * 0.3, barTop(1)], [area.left + w * 0.85, barTop(1) + barDy])
  await dragBar(page, [area.left + w * 0.55, barTop(2)], [area.left + w * 0.95, barTop(2) + barDy])
  await tick(page)

  await rec.shot(page, 'bars-drawn')
  const afterBars = await page.evaluate(() => window.__carillon.stats())
  rec.assert(
    '3 barres ajoutées à la souris',
    afterBars.bars === 3,
    `bars=${afterBars.bars}`,
  )

  // 5 clics pour lâcher 5 billes (vrai geste souris), dans la bande réservée aux billes — à
  // distance garantie des 3 barres (bandes distinctes), donc chaque clic tombe forcément dans le
  // vide et déclenche `drop-ball`, jamais `tap-bar`.
  const beforeClicksBalls = (await page.evaluate(() => window.__carillon.stats())).balls
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(area.left + w * (0.08 + i * 0.2), dropY)
  }
  await tick(page)

  const afterClicks = await page.evaluate(() => window.__carillon.stats())
  rec.assert(
    '5 billes ajoutées exactement',
    afterClicks.balls - beforeClicksBalls === 5,
    `avant=${beforeClicksBalls} après=${afterClicks.balls}`,
  )

  // Laisser tourner du temps réel pour que chute, rebonds, traînées et ondes
  // soient effectivement visibles (pas de raccourci par advance() ici).
  await wait(1800)
  await tick(page)
  await rec.shot(page, 'falling')

  const finalStats = await page.evaluate(() => window.__carillon.stats())
  rec.assert('au moins 1 impact enregistré', finalStats.impacts > 0, `impacts=${finalStats.impacts}`)
  // Sans cette assertion, tout le chemin audio (déverrouillage au 1er geste, budget de polyphonie,
  // création des voix) resterait non vérifié : `notes` ne bouge que si une voix a réellement été jouée.
  rec.assert(
    'des notes ont réellement été jouées',
    finalStats.notes > 0,
    `notes=${finalStats.notes} / impacts=${finalStats.impacts}`,
  )
  rec.assert('aucune barre hors champ', finalStats.barsOutOfBounds === 0, `barsOutOfBounds=${finalStats.barsOutOfBounds}`)
  rec.assert('aucune barre derrière le HUD', finalStats.barsUnderHud === 0, `barsUnderHud=${finalStats.barsUnderHud}`)
  rec.assert('aucun pas de simulation abandonné', finalStats.droppedSteps === 0, `droppedSteps=${finalStats.droppedSteps}`)

  await page.close()
}

async function runStress(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)

  // Vrai geste pointeur (pas un appel API) : c'est la seule façon de déverrouiller l'AudioContext,
  // exactement comme dans l'app réelle. Sans ça `notes` restait à 0 en permanence et le risque
  // « crachotement audio à 200 impacts simultanés » listé dans le plan n'était jamais exercé.
  // Point choisi loin de la barre d'outils (haut-droite) pour ne pas cliquer un bouton par erreur.
  await page.mouse.click(640, 720)

  await page.evaluate(() => {
    const c = window.__carillon
    // On repart d'une scène vide pour que le budget mesuré soit exactement 12 barres.
    c.reset()
    for (let i = 0; i < 12; i++) {
      const ax = 40 + i * 95
      const ay = 200 + (i % 3) * 150
      c.addBar(ax, ay, ax + 130, ay + 50)
    }
    // Des sources à cadence rapide : sans elles, le scénario mesurait un budget d'où l'US4 était
    // absente — zéro émission dans la boucle chaude, zéro anneau à dessiner — tout en prétendant
    // couvrir « le plafond de billes ».
    for (let i = 0; i < 6; i++) c.addEmitter(120 + i * 180, 120, 0.15)
  })

  await page.evaluate(() => {
    const c = window.__carillon
    // Coordonnées de spawn cyclées sur une bande de 200 (mêmes x/y que l'ancien lot initial) :
    // sans ce modulo, un i qui grandit sans borne finit par spawner hors écran, où la bille
    // est comptée morte à la frame suivante — la relance ne « recompléterait » alors plus rien.
    const spawn = (i) => {
      const j = i % 200
      c.dropBall(30 + (j % 40) * 30, 10 + Math.floor(j / 40) * 12)
    }
    let dropped = 0
    for (let i = 0; i < c.stats().maxBalls; i++) spawn(dropped++)

    const TARGET = c.stats().maxBalls
    // Les billes meurent en sortant par le bas ; sans ce recomplètement, la mesure 2,5 s plus
    // tard ne verrait plus qu'une fraction des 200 billes annoncées par le nom du scénario.
    window.__stressTimer = setInterval(() => {
      const deficit = TARGET - c.stats().balls
      for (let i = 0; i < deficit; i++) spawn(dropped++)
    }, 120)
  })

  // Les fps ne se mesurent pas via advance() (court-circuite le RAF) :
  // on laisse tourner du vrai temps et on lit le compteur exposé par l'app.
  await wait(2500)
  await tick(page)

  // Un seul relevé, utilisé pour toutes les assertions : pas de re-lecture qui changerait
  // les chiffres entre le log et l'assertion.
  const stats = await page.evaluate(() => window.__carillon.stats())
  await page.evaluate(() => clearInterval(window.__stressTimer))

  console.log(
    `  [stress] mesuré = fps=${stats.fps.toFixed(1)} balls=${stats.balls} bars=${stats.bars} ` +
      `impacts=${stats.impacts} notes=${stats.notes} droppedSteps=${stats.droppedSteps}`
  )
  rec.assert(
    'le plafond de billes est réellement atteint à la mesure',
    stats.balls >= stats.maxBalls - 20,
    `balls=${stats.balls} / maxBalls=${stats.maxBalls}`
  )
  rec.assert(
    'des sources tournent pendant la mesure (la charge de l’US4 est dans le budget)',
    stats.emitters >= 6,
    `sources=${stats.emitters}`
  )
  rec.assert('des notes ont réellement été jouées', stats.notes > 0, `notes=${stats.notes}`)
  rec.assert('aucun pas de simulation abandonné', stats.droppedSteps === 0, `droppedSteps=${stats.droppedSteps}`)
  rec.assert(
    'fps >= 60 au plafond de billes, avec sources et audio actifs',
    stats.fps >= 60,
    `fps=${stats.fps.toFixed(1)}`
  )

  await rec.shot(page, 'stress')
  await page.close()
}

async function runMobile(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 375, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await tick(page)

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  console.log(`  [mobile] scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`)
  rec.assert(
    'zéro débordement horizontal',
    overflow.scrollWidth <= overflow.innerWidth,
    `scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`
  )

  const controls = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-control]'))
    if (els.length === 0) return { present: false, allVisible: true, count: 0 }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const allVisible = els.every((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw
    })
    return { present: true, allVisible, count: els.length }
  })

  if (!controls.present) {
    console.warn(
      `  [mobile] avertissement : aucun élément [data-control] trouvé — assert non applicable, considérée passée`
    )
    rec.assert('contrôles [data-control] atteignables', true, 'aucun [data-control] trouvé (avertissement)')
  } else {
    rec.assert(
      'contrôles [data-control] atteignables',
      controls.allVisible,
      `${controls.count} contrôle(s) testé(s)`
    )
  }

  const stats = await page.evaluate(() => window.__carillon.stats())
  rec.assert('aucune barre hors champ', stats.barsOutOfBounds === 0, `barsOutOfBounds=${stats.barsOutOfBounds}`)
  // Le chevauchement du HUD se joue dans le canvas : `scrollWidth` ci-dessus est aveugle à ça.
  rec.assert('aucune barre derrière le HUD', stats.barsUnderHud === 0, `barsUnderHud=${stats.barsUnderHud}`)
  rec.assert(
    'la scène reste musicalement riche sur téléphone',
    stats.distinctPitches >= 5,
    `hauteurs=${stats.distinctPitches}`
  )
  rec.assert('aucun pas de simulation abandonné', stats.droppedSteps === 0, `droppedSteps=${stats.droppedSteps}`)

  await rec.shot(page, 'mobile')
  await page.close()
}

async function runControls(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await tick(page)

  // "Tout effacer" → la scène (y compris la scène d'accueil chargée au démarrage) doit être vide.
  await page.click('[data-control="clear"]')
  await tick(page)
  const afterClear = await page.evaluate(() => window.__carillon.stats().bars)
  rec.assert('« Tout effacer » vide la scène', afterClear === 0, `bars=${afterClear}`)

  // "Scène surprise" → une scène non vide apparaît.
  await page.click('[data-control="surprise"]')
  await tick(page)
  const afterSurprise1 = await page.evaluate(() => window.__carillon.stats().bars)
  // Sans les identifiants : `clearAll` ne remet pas `nextBarId` à zéro, donc deux scènes portent
  // toujours des id différents et la comparaison serait vraie quoi qu'il arrive.
  const geometry = () =>
    page.evaluate(() =>
      JSON.stringify(window.__carillon.bars().map((b) => [b.ax, b.ay, b.bx, b.by, b.midi]))
    )
  const geometry1 = await geometry()
  rec.assert('« Scène surprise » remplit la scène', afterSurprise1 > 0, `bars=${afterSurprise1}`)

  // Deuxième appui successif → une scène différente. L'API de debug n'expose pas la géométrie
  // des barres (seulement leur compte), donc l'empreinte de comparaison est le rendu pixel lui-même :
  // deux scènes différentes se dessinent différemment. Repli explicite prévu par la consigne quand
  // l'API ne suffit pas à une empreinte plus fine.
  await page.click('[data-control="surprise"]')
  await tick(page)
  const afterSurprise2 = await page.evaluate(() => window.__carillon.stats().bars)
  const geometry2 = await geometry()
  console.log(`  [controls] scène 1 : bars=${afterSurprise1} — scène 2 : bars=${afterSurprise2}`)
  rec.assert('« Scène surprise » (2e appui) remplit aussi la scène', afterSurprise2 > 0, `bars=${afterSurprise2}`)
  // Géométrie et non pixels, pour la même raison : la scène bouge toute seule depuis l'US4.
  rec.assert(
    '« Scène surprise » : deux appuis donnent des scènes différentes',
    geometry1 !== geometry2,
    'comparaison de la géométrie des barres'
  )

  // Sélecteur de gamme : change la gamme, le libellé, ET réaccorde les barres déjà posées.
  // La couleur d'une barre encode sa classe de hauteur : une comparaison pixel prouve donc que le
  // réaccordage atteint réellement le rendu, pas seulement l'état interne.
  const readTuning = () =>
    page.evaluate(() => ({
      id: window.__carillon.stats().tuning,
      pitches: window.__carillon.stats().distinctPitches,
      label: document.querySelector('#tuning-label')?.textContent ?? '',
      // Les hauteurs réelles, pas des pixels. Depuis que les sources font vivre la scène, deux
      // captures diffèrent de toute façon : la comparaison d'images ne prouvait plus rien, ce que le
      // test de mutation a confirmé (assertion verte avec le réaccordage neutralisé).
      midis: window.__carillon.bars().map((bar) => bar.midi),
    }))

  const tuningBefore = await readTuning()
  await page.click('[data-control="tuning"]')
  await tick(page)
  const tuningAfter = await readTuning()

  console.log(
    `  [controls] gamme : ${tuningBefore.id} (${tuningBefore.pitches} hauteurs) -> ${tuningAfter.id} (${tuningAfter.pitches} hauteurs)`
  )
  rec.assert(
    'sélecteur de gamme : la gamme courante change',
    tuningBefore.id !== tuningAfter.id,
    `avant=${tuningBefore.id} après=${tuningAfter.id}`
  )
  rec.assert(
    'sélecteur de gamme : le libellé suit',
    tuningBefore.label !== tuningAfter.label,
    `avant="${tuningBefore.label}" après="${tuningAfter.label}"`
  )
  const retuned = tuningBefore.midis.filter((midi, i) => midi !== tuningAfter.midis[i]).length
  rec.assert(
    'sélecteur de gamme : les barres déjà posées sont réaccordées',
    tuningBefore.midis.length > 0 && retuned >= tuningBefore.midis.length / 3,
    `${retuned}/${tuningBefore.midis.length} barres ont changé de hauteur`
  )
  rec.assert(
    'la scène reste musicalement riche après réaccordage',
    tuningAfter.pitches >= 8,
    `hauteurs distinctes=${tuningAfter.pitches}`
  )

  // Un seul clic ne prouve pas le cycle : un modulo cassé pourrait faire du ping-pong entre deux
  // gammes et passer inaperçu. On fait le tour complet et on doit revenir au point de départ.
  const seen = [tuningBefore.id, tuningAfter.id]
  for (let i = 0; i < 8; i++) {
    await page.click('[data-control="tuning"]')
    await tick(page)
    const step = await readTuning()
    if (step.id === tuningBefore.id) break
    seen.push(step.id)
  }
  const back = await readTuning()
  console.log(`  [controls] cycle de gammes : ${seen.join(' -> ')} -> ${back.id}`)
  rec.assert(
    'le cycle de gammes revient à son point de départ',
    back.id === tuningBefore.id,
    `départ=${tuningBefore.id} arrivée=${back.id}`
  )
  rec.assert(
    'le cycle traverse les 5 gammes du catalogue',
    new Set(seen).size === 5,
    `gammes vues=${new Set(seen).size} (${[...new Set(seen)].join(', ')})`
  )

  // Bouton son : bascule aria-pressed et le libellé.
  const before = await page.evaluate(() => {
    const btn = document.querySelector('[data-control="mute"]')
    return { pressed: btn.getAttribute('aria-pressed'), label: btn.textContent }
  })
  await page.click('[data-control="mute"]')
  await tick(page)
  const after = await page.evaluate(() => {
    const btn = document.querySelector('[data-control="mute"]')
    return { pressed: btn.getAttribute('aria-pressed'), label: btn.textContent }
  })
  rec.assert(
    'bouton son : aria-pressed bascule',
    before.pressed !== after.pressed,
    `avant=${before.pressed} après=${after.pressed}`
  )
  rec.assert(
    'bouton son : le libellé change',
    before.label !== after.label,
    `avant="${before.label}" après="${after.label}"`
  )

  await rec.shot(page, 'controls')
  await page.close()
}

/**
 * La valeur centrale de l'US4 : la scène joue **sans qu'on la touche**. Une régression ici — sources
 * absentes de la scène d'accueil, posées hors zone, émission débranchée — ne ferait échouer aucune
 * autre assertion : la scène redeviendrait simplement morte, en silence.
 */
async function runAlive(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await tick(page)

  const atLoad = await page.evaluate(() => window.__carillon.stats())
  rec.assert(
    'la scène d’accueil contient au moins une source',
    atLoad.emitters >= 1,
    `sources=${atLoad.emitters}`
  )

  // Aucun geste, aucun appel d'API : on regarde juste le temps passer.
  await wait(3200)
  await tick(page)
  const passive = await page.evaluate(() => window.__carillon.stats())
  console.log(
    `  [alive] sans aucun geste : billes=${passive.balls} impacts=${passive.impacts} sources=${passive.emitters}`
  )
  rec.assert(
    'la scène joue toute seule : des impacts sans aucun geste',
    passive.impacts > 0,
    `impacts=${passive.impacts} après 3,2 s`
  )
  rec.assert('aucune source hors champ', passive.barsOutOfBounds === 0, `horsChamp=${passive.barsOutOfBounds}`)
  rec.assert('aucune source derrière le HUD', passive.barsUnderHud === 0, `sousHud=${passive.barsUnderHud}`)
  await rec.shot(page, 'alive')

  // Annuler ne doit pas provoquer de rafale : l'instantané ne porte pas d'échéance, donc les sources
  // sont réarmées depuis le temps courant. Sans ça, une annulation après quelques secondes faisait
  // rattraper un retard fictif — 4 billes par source dans une seule frame, et la phase du motif perdue.
  await dragBar(page, [260, 620], [620, 640])
  await tick(page)
  await wait(2500)
  const beforeUndo = await page.evaluate(() => window.__carillon.stats().balls)
  await page.click('[data-control="undo"]')
  await tick(page)
  const afterUndo = await page.evaluate(() => window.__carillon.stats().balls)
  console.log(`  [alive] annulation : billes ${beforeUndo} -> ${afterUndo}`)
  rec.assert(
    'annuler ne déclenche pas de rafale de billes',
    afterUndo - beforeUndo <= 2,
    `écart=${afterUndo - beforeUndo} bille(s) sur la frame de l’annulation`
  )

  await page.close()
}

async function runResize(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await tick(page)

  async function assertAfterResize(width, height, minPitches) {
    await page.setViewport({ width, height })
    await tick(page)
    const stats = await page.evaluate(() => window.__carillon.stats())
    console.log(
      `  [resize] ${width}x${height} → bars=${stats.bars} hauteurs=${stats.distinctPitches} horsChamp=${stats.barsOutOfBounds} sousHud=${stats.barsUnderHud}`
    )
    rec.assert(
      `scène non vide après passage à ${width}x${height}`,
      stats.bars > 0,
      `bars=${stats.bars}`
    )
    rec.assert(
      `aucune barre hors champ après passage à ${width}x${height}`,
      stats.barsOutOfBounds === 0,
      `barsOutOfBounds=${stats.barsOutOfBounds}`
    )
    // Le chevauchement du HUD ne se voit pas depuis le DOM : il se joue dans le canvas. Sans ce
    // compteur, une rangée de barres passant derrière les boutons restait invisible aux assertions.
    rec.assert(
      `aucune barre derrière le HUD à ${width}x${height}`,
      stats.barsUnderHud === 0,
      `barsUnderHud=${stats.barsUnderHud}`
    )
    // La richesse musicale se dégradait entre 600 et 999 px sans que rien ne le signale : les seuils
    // n'avaient été posés que sur les largeurs déjà regardées.
    rec.assert(
      `au moins ${minPitches} hauteurs distinctes à ${width}x${height}`,
      stats.distinctPitches >= minPitches,
      `hauteurs=${stats.distinctPitches}`
    )
  }

  // C'est le chemin exact d'une rotation de téléphone ou d'un redimensionnement de fenêtre :
  // le ResizeObserver du canvas doit reconstruire la scène dans les nouvelles bornes.
  await assertAfterResize(900, 600, 8)
  await assertAfterResize(375, 740, 5)
  // Téléphone en paysage : la hauteur fond mais le HUD garde sa taille. C'est le viewport où les
  // barres passaient derrière le titre et les boutons.
  await assertAfterResize(844, 390, 5)

  await rec.shot(page, 'resize')
  await page.close()
}

/** Lit la géométrie exacte d'une barre via `window.__carillon.bars()` (id, extrémités, midi). */
async function findBar(page, id) {
  return page.evaluate((id) => window.__carillon.bars().find((b) => b.id === id) ?? null, id)
}

function barLength(bar) {
  return Math.hypot(bar.bx - bar.ax, bar.by - bar.ay)
}

/**
 * US3, C6 — le geste agréable à la souris. Une scène vide, une barre de longueur connue posée via
 * l'API de debug (le point de départ n'est pas ce qu'on teste), puis quatre gestes souris réels :
 * déplacer, étirer, supprimer, annuler.
 *
 * `window.__carillon.bars()` expose la géométrie exacte (extrémités, midi) : les assertions
 * comparent donc la position/longueur/note **avant/après** directement, sans passer par une
 * heuristique de couleur — `stats()` seul (compteurs) n'aurait pas suffi.
 */
async function runEdit(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)

  await page.evaluate(() => window.__carillon.reset())
  await tick(page)
  const empty = await page.evaluate(() => window.__carillon.stats())
  rec.assert('scène vide après reset()', empty.bars === 0, `bars=${empty.bars}`)

  // 3 bandes horizontales mesurées depuis le DOM (HUD exclu) : une par geste testé, pour qu'aucun
  // glisser ne puisse accidentellement attraper la barre d'un autre test.
  const area = await computePlayArea(page, 60)
  const w = area.right - area.left
  const h = area.bottom - area.top
  const bandH = h / 3
  const rowY = (i) => area.top + bandH * i + bandH * 0.5
  const EPS = 0.5

  // --- Déplacer -------------------------------------------------------------
  const y0 = rowY(0)
  const bar1 = { ax: area.left + w * 0.2, ay: y0, bx: area.left + w * 0.2 + 300, by: y0 }
  const bar1Id = await page.evaluate((b) => window.__carillon.addBar(b.ax, b.ay, b.bx, b.by), bar1)
  rec.assert('barre de test posée (déplacer)', bar1Id !== -1, `id=${bar1Id}`)

  const before1 = await findBar(page, bar1Id)
  const center1 = [(bar1.ax + bar1.bx) / 2, y0]
  const dx = 140
  const dy = 60
  // Glisser depuis le corps (milieu, à 150 px de chaque extrémité — largement hors du rayon de
  // préhension de 14 px à la souris) : c'est ce qui distingue un déplacement d'un étirement.
  await dragBar(page, center1, [center1[0] + dx, center1[1] + dy])
  await tick(page)
  await rec.shot(page, 'moved')

  const after1 = await findBar(page, bar1Id)
  rec.assert(
    'déplacer : les deux extrémités ont bougé exactement de (dx, dy)',
    Math.abs(after1.ax - before1.ax - dx) < EPS &&
      Math.abs(after1.ay - before1.ay - dy) < EPS &&
      Math.abs(after1.bx - before1.bx - dx) < EPS &&
      Math.abs(after1.by - before1.by - dy) < EPS,
    `avant a=(${before1.ax},${before1.ay}) b=(${before1.bx},${before1.by}) ` +
      `après a=(${after1.ax},${after1.ay}) b=(${after1.bx},${after1.by})`,
  )
  rec.assert(
    'déplacer : la longueur est inchangée',
    Math.abs(barLength(after1) - barLength(before1)) < EPS,
    `avant=${barLength(before1).toFixed(1)} après=${barLength(after1).toFixed(1)}`,
  )
  rec.assert(
    'déplacer : la note (midi) est inchangée',
    after1.midi === before1.midi,
    `avant=${before1.midi} après=${after1.midi}`,
  )

  // --- Étirer -----------------------------------------------------------------
  const y1 = rowY(1)
  const bar2 = { ax: area.left + w * 0.15, ay: y1, bx: area.left + w * 0.15 + 300, by: y1 }
  const bar2Id = await page.evaluate((b) => window.__carillon.addBar(b.ax, b.ay, b.bx, b.by), bar2)
  rec.assert('barre de test posée (étirer)', bar2Id !== -1, `id=${bar2Id}`)

  const before2 = await findBar(page, bar2Id)
  const stretchDx = 120
  // Glisser depuis l'extrémité A (distance 0, dans le rayon de préhension de 14 px) vers la
  // gauche : la barre s'allonge de 300 à 420 px, la note doit suivre.
  await dragBar(page, [bar2.ax, y1], [bar2.ax - stretchDx, y1])
  await tick(page)
  await rec.shot(page, 'stretched')

  const after2 = await findBar(page, bar2Id)
  rec.assert(
    'étirer : l\'extrémité B (non attrapée) ne bouge pas',
    after2.bx === before2.bx && after2.by === before2.by,
    `avant b=(${before2.bx},${before2.by}) après b=(${after2.bx},${after2.by})`,
  )
  rec.assert(
    'étirer : la longueur augmente exactement de la distance parcourue',
    Math.abs(barLength(after2) - (barLength(before2) + stretchDx)) < EPS,
    `avant=${barLength(before2).toFixed(1)} après=${barLength(after2).toFixed(1)} attendu=${(barLength(before2) + stretchDx).toFixed(1)}`,
  )
  rec.assert(
    'étirer : la note change avec la nouvelle longueur',
    after2.midi !== before2.midi,
    `avant=${before2.midi} après=${after2.midi}`,
  )

  // --- Supprimer ----------------------------------------------------------------
  const y2 = rowY(2)
  const bar3 = { ax: area.left + w * 0.3, ay: y2, bx: area.left + w * 0.3 + 300, by: y2 }
  const bar3Id = await page.evaluate((b) => window.__carillon.addBar(b.ax, b.ay, b.bx, b.by), bar3)
  rec.assert('barre de test posée (supprimer)', bar3Id !== -1, `id=${bar3Id}`)

  const beforeDelete = await page.evaluate(() => window.__carillon.stats())
  const center3 = [(bar3.ax + bar3.bx) / 2, y2]
  // Glisser depuis le corps jusqu'à 8 px du bord GAUCHE DE L'ÉCRAN (pas de la zone jouable) :
  // la bande de suppression de 14 px se mesure depuis les bords réels du viewport.
  await dragBar(page, center3, [8, y2])
  await tick(page)
  await rec.shot(page, 'deleted')

  const afterDelete = await page.evaluate(() => window.__carillon.stats())
  rec.assert(
    'supprimer : relâcher au bord retire exactement la barre',
    afterDelete.bars === beforeDelete.bars - 1,
    `avant=${beforeDelete.bars} après=${afterDelete.bars}`,
  )

  // --- Annuler --------------------------------------------------------------------
  const beforeUndo = await page.evaluate(() => window.__carillon.stats())
  await page.click('[data-control="undo"]')
  await tick(page)
  await rec.shot(page, 'undone')
  const afterUndo = await page.evaluate(() => window.__carillon.stats())

  rec.assert(
    'annuler : restaure la barre supprimée',
    afterUndo.bars === beforeUndo.bars + 1,
    `avant=${beforeUndo.bars} après=${afterUndo.bars}`,
  )
  rec.assert(
    'annuler : dépile un geste',
    afterUndo.undoDepth === beforeUndo.undoDepth - 1,
    `avant=${beforeUndo.undoDepth} après=${afterUndo.undoDepth}`,
  )
  rec.assert('aucune barre hors champ après édition', afterUndo.barsOutOfBounds === 0, `barsOutOfBounds=${afterUndo.barsOutOfBounds}`)
  rec.assert('aucune barre derrière le HUD après édition', afterUndo.barsUnderHud === 0, `barsUnderHud=${afterUndo.barsUnderHud}`)

  await page.close()
}

/**
 * US3, C7 — les mêmes gestes, au doigt. Viewport téléphone, `hasTouch`/`isMobile`, et de vrais
 * événements tactiles (`page.touchscreen`) plutôt qu'une émulation de souris : c'est le seul moyen
 * d'exercer le rayon de préhension généreux (`TOUCH_RADII`, 18/24 px) qui est le point du critère.
 * Assertions sur la géométrie exacte (`bars()`), comme pour `edit`.
 */
async function runTouch(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)

  await page.evaluate(() => window.__carillon.reset())
  await tick(page)
  const empty = await page.evaluate(() => window.__carillon.stats())
  rec.assert('scène vide après reset()', empty.bars === 0, `bars=${empty.bars}`)

  const area = await computePlayArea(page, 50)
  const w = area.right - area.left
  const y = area.top + (area.bottom - area.top) * 0.5
  const EPS = 0.5

  // --- Dessiner au doigt ------------------------------------------------------
  // Bar centrée (35 % depuis la gauche, pas 15 %) : l'étirement qui suit tire l'extrémité A vers
  // la gauche de 80 px, il faut donc de la marge des deux côtés de la bande de suppression (14 px)
  // — y compris dans le cas dégradé où le déplacement n'aurait pas bougé la barre.
  const from = [area.left + w * 0.35, y]
  const to = [area.left + w * 0.35 + Math.min(160, w * 0.6), y]
  await dragTouch(page, from, to)
  await tick(page)
  await rec.shot(page, 'drawn')

  const afterDraw = await page.evaluate(() => window.__carillon.stats())
  rec.assert('dessiner au doigt crée une barre', afterDraw.bars === 1, `bars=${afterDraw.bars}`)

  const barId = (await page.evaluate(() => window.__carillon.bars())).at(-1).id
  const before1 = await findBar(page, barId)
  const center = [(before1.ax + before1.bx) / 2, (before1.ay + before1.by) / 2]

  // --- Déplacer au doigt --------------------------------------------------------
  // 40, pas 70 : l'app borne elle-même le déplacement du corps à la zone de jeu (marge latérale
  // ~23 px à 390 px de large, cf. `sceneArea`), distincte de la bande de suppression (14 px) — un
  // delta trop grand viendrait buter contre ce bord et fausserait l'assertion de delta exact.
  const mdx = 40
  const mdy = 40
  // Corps : le milieu est à `(barB[0]-barA[0])/2` de chaque extrémité, largement au-delà du rayon
  // de préhension d'extrémité au doigt (24 px).
  await dragTouch(page, center, [center[0] + mdx, center[1] + mdy])
  await tick(page)
  await rec.shot(page, 'moved')

  const after1 = await findBar(page, barId)
  rec.assert(
    'déplacer au doigt : les deux extrémités ont bougé exactement de (dx, dy)',
    Math.abs(after1.ax - before1.ax - mdx) < EPS &&
      Math.abs(after1.ay - before1.ay - mdy) < EPS &&
      Math.abs(after1.bx - before1.bx - mdx) < EPS &&
      Math.abs(after1.by - before1.by - mdy) < EPS,
    `avant a=(${before1.ax},${before1.ay}) b=(${before1.bx},${before1.by}) ` +
      `après a=(${after1.ax},${after1.ay}) b=(${after1.bx},${after1.by})`,
  )
  rec.assert(
    'déplacer au doigt : la note (midi) est inchangée',
    after1.midi === before1.midi,
    `avant=${before1.midi} après=${after1.midi}`,
  )

  // --- Étirer au doigt ----------------------------------------------------------
  const stretchDx = 80
  // On étire l'extrémité A (distance 0, dans le rayon de préhension de 24 px au doigt) : B ne
  // bouge pas, la longueur augmente exactement de `stretchDx`, la note change.
  await dragTouch(page, [after1.ax, after1.ay], [after1.ax - stretchDx, after1.ay])
  await tick(page)
  await rec.shot(page, 'stretched')

  const after2 = await findBar(page, barId)
  rec.assert(
    'étirer au doigt : l\'extrémité B (non attrapée) ne bouge pas',
    after2.bx === after1.bx && after2.by === after1.by,
    `avant b=(${after1.bx},${after1.by}) après b=(${after2.bx},${after2.by})`,
  )
  rec.assert(
    'étirer au doigt : la longueur augmente exactement de la distance parcourue',
    Math.abs(barLength(after2) - (barLength(after1) + stretchDx)) < EPS,
    `avant=${barLength(after1).toFixed(1)} après=${barLength(after2).toFixed(1)}`,
  )
  rec.assert(
    'étirer au doigt : la note change avec la nouvelle longueur',
    after2.midi !== after1.midi,
    `avant=${after1.midi} après=${after2.midi}`,
  )

  const final = await page.evaluate(() => window.__carillon.stats())
  rec.assert('aucune barre hors champ au doigt', final.barsOutOfBounds === 0, `barsOutOfBounds=${final.barsOutOfBounds}`)
  rec.assert('aucune barre derrière le HUD au doigt', final.barsUnderHud === 0, `barsUnderHud=${final.barsUnderHud}`)

  await page.close()
}

const SCENARIOS = {
  sandbox: runSandbox,
  stress: runStress,
  mobile: runMobile,
  controls: runControls,
  resize: runResize,
  alive: runAlive,
  edit: runEdit,
  touch: runTouch,
}

// --- Mode --smoke : auto-vérification du harnais sur une fixture ----------

async function runSmoke(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)

  await page.evaluate(() => {
    const c = window.__carillon
    c.addBar(50, 200, 350, 220)
    c.dropBall(80, 20)
    c.dropBall(200, 20)
  })
  await tick(page)
  await rec.shot(page, 'first')

  await wait(500)
  await tick(page)
  await rec.shot(page, 'second')

  const stats = await page.evaluate(() => window.__carillon.stats())
  console.log(`  [smoke] stats() = ${JSON.stringify(stats)}`)
  rec.assert(
    'stats() expose les clés du contrat',
    ['fps', 'balls', 'bars', 'impacts', 'notes'].every((k) => k in stats),
    JSON.stringify(stats)
  )

  await page.close()
}

// --- Orchestration -----------------------------------------------------------

function printSummary(results) {
  console.log('\n=== Résumé ===')
  console.log('scénario   | verdict | captures | assertions | erreurs console')
  console.log('-----------|---------|----------|------------|----------------')
  for (const r of results) {
    console.log(
      `${r.scenario.padEnd(10)} | ${r.verdict.padEnd(7)} | ${String(r.shots).padEnd(8)} | ${r.assertions.padEnd(10)} | ${r.consoleIssues}`
    )
  }
  const passedCount = results.filter((r) => r.verdict === 'PASS').length
  const globalOk = passedCount === results.length
  console.log(`\nGlobal : ${globalOk ? 'OK' : 'ÉCHEC'} (${passedCount}/${results.length} scénario(s) vert(s))`)
  if (!globalOk) process.exitCode = 1
}

async function main() {
  const server = await createServer({
    root: ROOT,
    server: { port: 0 },
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local?.[0]
  if (!baseUrl) {
    throw new Error('Vite ne renvoie aucune URL locale résolue (resolvedUrls.local vide).')
  }
  console.log(`Serveur Vite : ${baseUrl}`)

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: !headed,
    // Pas de --use-gl=swiftshader : ce flag force le rendu logiciel et fait mesurer une machine
    // sans GPU, que personne n'utilise — le scénario `stress` y perdait un facteur 3 sur les fps.
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

  const results = []

  try {
    if (smoke) {
      const smokeUrl = new URL('/scripts/fixtures/smoke.html', baseUrl).toString()
      const rec = new Recorder('smoke')
      console.log(`\n=== Scénario: smoke (fixture ${smokeUrl}) ===`)
      try {
        await runSmoke(browser, smokeUrl, rec)
      } catch (err) {
        console.error(`  [smoke] ERREUR : ${err.message}`)
        process.exitCode = 1
        rec.assertions.push({ label: 'exécution du scénario', ok: false, detail: err.message })
      }
      results.push(rec.summarize())
    } else {
      const requested = scenarioArg ? [scenarioArg] : ALL_SCENARIOS
      for (const name of requested) {
        const runner = SCENARIOS[name]
        if (!runner) {
          console.error(`Scénario inconnu : "${name}". Attendus : ${ALL_SCENARIOS.join(', ')}`)
          process.exitCode = 1
          continue
        }
        const rec = new Recorder(name)
        console.log(`\n=== Scénario: ${name} ===`)
        try {
          await runner(browser, baseUrl, rec)
        } catch (err) {
          console.error(`  [${name}] ERREUR : ${err.message}`)
          process.exitCode = 1
          rec.assertions.push({ label: 'exécution du scénario', ok: false, detail: err.message })
        }
        results.push(rec.summarize())
      }
    }
  } finally {
    if (!keep) {
      await browser.close()
      await server.close()
    } else {
      console.log('\n--keep : navigateur et serveur Vite laissés ouverts.')
    }
  }

  printSummary(results)
}

main().catch((err) => {
  console.error('Erreur fatale :', err)
  process.exitCode = 1
})
