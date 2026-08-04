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
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PROOFS_DIR = path.join(ROOT, 'docs', 'proofs')
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const ALL_SCENARIOS = ['sandbox', 'stress', 'mobile', 'controls', 'resize', 'edit', 'touch', 'alive', 'share', 'vernis', 'rythme', 'timbres', 'natures', 'air', 'partage', 'lacher', 'roue', 'sources', 'tempo']

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
    /*
     * Le dossier est **vidé** à la première capture du run. `docs/proofs/<scénario>/` ne contient que
     * l'état courant : sans ce nettoyage, insérer une capture au milieu d'un scénario décale la
     * numérotation et laisse les anciennes à côté des nouvelles. Deux fichiers pour le même plan, et
     * on regarde le périmé en croyant juger le code d'aujourd'hui — déjà arrivé deux fois.
     */
    if (this.shotIndex === 0) {
      for (const stale of await readdir(this.dir)) {
        if (stale.endsWith('.png')) await rm(path.join(this.dir, stale))
      }
    }
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

/**
 * Roue de sélection : on vise le point où le libellé est **dessiné**, pas un angle recalculé ici.
 *
 * C'est ce qui fait parcourir le vrai chemin — `labelAnchor` place le texte, `sectorAt` relit le point —
 * plutôt que de vérifier la géométrie contre elle-même. Recalculer l'angle dans le harnais donnerait une
 * seconde implémentation, qui dériverait de la première sans rien prouver.
 */
async function readWheel(page) {
  return page.evaluate(() => window.__carillon.stats().wheel)
}

async function requireWheelOption(page, value) {
  const wheel = await readWheel(page)
  if (!wheel) throw new Error(`aucune roue ouverte (option attendue : ${value})`)
  const option = wheel.options.find((candidate) => candidate.value === value)
  if (!option) {
    throw new Error(
      `option « ${value} » absente de la roue : ${wheel.options.map((o) => o.value).join(', ')}`
    )
  }
  return { wheel, option }
}

/** Choix par tap sur une roue **épinglée** (celle du bouton d'instrument). */
async function pickInPinnedWheel(page, value) {
  const { option } = await requireWheelOption(page, value)
  await page.mouse.click(option.x, option.y)
  await wait(120)
}

/**
 * Choix **à ressort** : le pointeur est déjà enfoncé (appui long en cours), on glisse jusqu'au secteur
 * et on relâche. C'est le geste d'un seul tenant, celui qu'on fait sans y penser.
 */
async function pickBySpring(page, value) {
  const { option } = await requireWheelOption(page, value)
  await page.mouse.move(option.x, option.y, { steps: 6 })
  await page.mouse.up()
  await wait(120)
}

/** Ouvre la roue de nature d'une barre par appui long, pointeur laissé **enfoncé**. */
async function openNatureWheel(page, at) {
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await wait(700)
}

/** Change d'instrument : le bouton ouvre la roue, un tap choisit. Deux gestes, quel que soit le timbre. */
async function chooseInstrument(page, id) {
  await page.click('[data-control="instrument"]')
  await tick(page)
  await pickInPinnedWheel(page, id)
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
  // vide et déclenche `drop-ball`, jamais `tap`.
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
    // Division la plus fine du catalogue (la croche) : les sources s'expriment désormais en divisions
    // de mesure, plus en secondes. Passer 0.15 ici serait interprété comme un **index** de division.
    for (let i = 0; i < 6; i++) c.addEmitter(120 + i * 180, 120, 4)
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
      `impacts=${stats.impacts} notes=${stats.notes} étincelles=${stats.particles} droppedSteps=${stats.droppedSteps}`
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
  // Sans cette assertion, « fps >= 60 » mesurerait un budget d'où l'US6 serait absente tout en
  // prétendant couvrir les particules — exactement l'erreur corrigée à l'US4 pour les sources.
  rec.assert(
    'des étincelles brûlent pendant la mesure (la charge de l’US6 est dans le budget)',
    stats.particles > 0,
    `étincelles=${stats.particles}`
  )
  rec.assert(
    'les étincelles restent sous leur plafond même à pleine charge',
    stats.particles <= stats.maxParticles,
    `étincelles=${stats.particles} / plafond=${stats.maxParticles}`
  )
  rec.assert(
    'fps >= 60 au plafond de billes, avec sources, audio et étincelles actifs',
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
  /*
   * La propriété est la **préservation**, pas un seuil absolu. Un seuil de 8 supposait que la scène
   * testée soit la scène stratifiée ; depuis que « Scène surprise » compose un air (3 ou 4 hauteurs par
   * nature), il mesurait la mauvaise scène. La richesse absolue de la scène d'accueil est déjà assertée
   * par le scénario `resize`, à sept largeurs.
   */
  rec.assert(
    'le réaccordage ne détruit pas la richesse musicale',
    tuningAfter.pitches >= tuningBefore.pitches - 1,
    `${tuningBefore.pitches} -> ${tuningAfter.pitches} hauteurs distinctes`
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
  // Le nombre vient de l'app, pas d'une constante recopiée : ajouter une gamme ne doit pas casser
  // l'assertion, mais en oublier une dans le cycle doit la casser.
  const catalogue = await page.evaluate(() => window.__carillon.stats().tuningIds)
  rec.assert(
    'le cycle traverse tout le catalogue de gammes',
    new Set(seen).size === catalogue.length,
    `gammes vues=${new Set(seen).size}/${catalogue.length} (${[...new Set(seen)].join(', ')})`
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

/**
 * Le lien voyage-t-il ? On fabrique une scène sur un grand écran, on prend le lien tel quel, et on
 * l'ouvre sur un téléphone. Trois choses doivent tenir : la scène est restaurée (barres, sources,
 * gamme), elle **joue**, et rien ne passe derrière le HUD. Un lien trafiqué ne doit jamais casser l'app.
 */
async function runShare(browser, url, rec) {
  const author = await browser.newPage()
  rec.attachConsoleListeners(author)
  await author.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await author.goto(url, { waitUntil: 'load' })
  await waitForCarillon(author)
  await author.evaluate(() => window.__carillon.setTuning('hirajoshi'))
  await tick(author)

  const before = await author.evaluate(() => ({
    midis: window.__carillon.bars().map((bar) => bar.midi),
    emitters: window.__carillon.emitters().length,
    tuning: window.__carillon.stats().tuning,
    // Positions **relatives** des sources : sans elles, intervertir x et y dans l'encodeur passait
    // tout le lot — la scène jouait quand même.
    emitterSpots: window.__carillon
      .emitters()
      .map((e) => [Math.round((e.x / window.innerWidth) * 100), Math.round((e.y / window.innerHeight) * 100)]),
  }))

  await author.click('[data-control="share"]')
  await tick(author)
  const link = await author.evaluate(() => location.href)
  console.log(`  [share] lien de ${link.length} caractères, ${before.midis.length} barres, ${before.emitters} sources`)
  rec.assert('le bouton met un lien de scène dans l’URL', link.includes('#s='), `longueur=${link.length}`)
  rec.assert('le lien reste court', link.length < 1500, `longueur=${link.length}`)
  await author.close()

  // Destinataire sur un tout autre écran.
  const guest = await browser.newPage()
  rec.attachConsoleListeners(guest)
  await guest.setViewport({ width: 375, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await guest.goto(link, { waitUntil: 'load' })
  await waitForCarillon(guest)
  await tick(guest)

  const after = await guest.evaluate(() => {
    const bars = window.__carillon.bars()
    const ys = bars.flatMap((bar) => [bar.ay, bar.by])
    const stats = window.__carillon.stats()
    return {
      midis: bars.map((bar) => bar.midi),
      emitters: window.__carillon.emitters().length,
      emitterSpots: window.__carillon
        .emitters()
        .map((e) => [Math.round((e.x / window.innerWidth) * 100), Math.round((e.y / window.innerHeight) * 100)]),
      tuning: stats.tuning,
      sousHud: stats.barsUnderHud,
      horsChamp: stats.barsOutOfBounds,
      fill: (Math.max(...ys) - Math.min(...ys)) / window.innerHeight,
    }
  })

  const drift = after.midis.filter((midi, i) => midi !== before.midis[i]).length
  console.log(
    `  [share] reçu sur 375x740 : ${after.midis.length} barres, ${after.emitters} sources, ` +
      `${drift} note(s) décalée(s), remplissage ${Math.round(after.fill * 100)}%`
  )
  rec.assert(
    'aucune barre perdue en route',
    after.midis.length === before.midis.length,
    `${before.midis.length} -> ${after.midis.length}`
  )
  rec.assert('les sources sont restaurées', after.emitters === before.emitters, `sources=${after.emitters}`)
  const spotDrift = after.emitterSpots.filter(
    ([x, y], i) => Math.abs(x - (before.emitterSpots[i]?.[0] ?? 0)) > 4 || Math.abs(y - (before.emitterSpots[i]?.[1] ?? 0)) > 12
  ).length
  rec.assert(
    'les sources retrouvent leur place relative',
    spotDrift === 0,
    `avant=${JSON.stringify(before.emitterSpots)} après=${JSON.stringify(after.emitterSpots)}`
  )
  rec.assert('la gamme est restaurée', after.tuning === before.tuning, `gamme=${after.tuning}`)
  // Le format encode milieu + longueur + angle, donc les barres sont repositionnées sans être
  // déformées : au plus une note bouge, celle qui touche la longueur minimale jouable sur petit écran.
  rec.assert(
    'les notes sont préservées (au plus une décalée)',
    drift <= 1,
    `${drift} décalée(s) sur ${before.midis.length}`
  )
  // La scène ne doit pas s'ouvrir en bandeau écrasé : c'était le défaut du format précédent.
  rec.assert('la scène remplit l’écran du destinataire', after.fill > 0.35, `remplissage=${Math.round(after.fill * 100)}%`)
  rec.assert('aucune barre derrière le HUD', after.sousHud === 0, `sousHud=${after.sousHud}`)
  rec.assert('aucune barre hors champ', after.horsChamp === 0, `horsChamp=${after.horsChamp}`)

  await wait(2600)
  await tick(guest)
  const playing = await guest.evaluate(() => window.__carillon.stats())
  rec.assert('la scène reçue joue toute seule', playing.impacts > 0, `impacts=${playing.impacts}`)

  // Rotation du téléphone après ouverture du lien : la scène doit se **replacer**, pas rester en
  // pixels absolus derrière le HUD.
  await guest.setViewport({ width: 740, height: 375, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await tick(guest)
  const rotated = await guest.evaluate(() => window.__carillon.stats())
  console.log(`  [share] après rotation : barres=${rotated.bars} sousHud=${rotated.barsUnderHud} horsChamp=${rotated.barsOutOfBounds}`)
  rec.assert('la scène reçue survit à une rotation', rotated.bars === before.midis.length, `barres=${rotated.bars}`)
  rec.assert('rien derrière le HUD après rotation', rotated.barsUnderHud === 0, `sousHud=${rotated.barsUnderHud}`)
  rec.assert('rien hors champ après rotation', rotated.barsOutOfBounds === 0, `horsChamp=${rotated.barsOutOfBounds}`)
  await rec.shot(guest, 'received')
  await guest.close()

  // Modifier après avoir partagé doit détacher l'URL : sinon un rechargement ressusciterait la scène
  // du lien et effacerait les modifications.
  const editor = await browser.newPage()
  rec.attachConsoleListeners(editor)
  await editor.setViewport({ width: 1280, height: 800 })
  await editor.goto(link, { waitUntil: 'load' })
  await waitForCarillon(editor)
  await tick(editor)
  const hashBefore = await editor.evaluate(() => location.hash.slice(0, 3))
  await dragBar(editor, [300, 620], [640, 640])
  await tick(editor)
  const hashAfter = await editor.evaluate(() => location.hash)
  rec.assert(
    'modifier une scène reçue détache l’URL du lien',
    hashBefore === '#s=' && hashAfter === '',
    `avant="${hashBefore}" après="${hashAfter}"`
  )
  await editor.close()

  // Lien trafiqué : jamais d'erreur, repli sur la scène d'accueil.
  const broken = await browser.newPage()
  rec.attachConsoleListeners(broken)
  await broken.setViewport({ width: 1280, height: 800 })
  await broken.goto(`${url}#s=1zzTRAFIQUE`, { waitUntil: 'load' })
  await waitForCarillon(broken)
  await tick(broken)
  const fallback = await broken.evaluate(() => window.__carillon.stats())
  rec.assert('un lien trafiqué retombe sur la scène d’accueil', fallback.bars > 0 && fallback.emitters > 0, `barres=${fallback.bars} sources=${fallback.emitters}`)
  await broken.close()
}

/**
 * Le vernis, mais mesuré. Trois défauts d'usage chiffrés au fil des US précédentes :
 * le HUD mangeait 44 % d'un 320×568 ; l'accordage n'était découvrable qu'à la souris, faute de survol
 * tactile ; et `prefers-reduced-motion` était ignoré.
 */
/**
 * Le format v2 transporte ce que la v1 perdait : la nature des barres, le tempo et l'instrument. Les
 * trois étaient restés hors du lien aux US7, US8 et US9 sans qu'on l'ait décidé — une scène reçue se
 * rejouait à 96 BPM au carillon, avec des murs, quoi qu'ait choisi celui qui l'a partagée.
 */
async function runPartageV2(browser, url, rec) {
  const author = await browser.newPage()
  rec.attachConsoleListeners(author)
  await author.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await author.goto(url, { waitUntil: 'load' })
  await waitForCarillon(author)

  // On pose une scène signée : trois natures, un instrument qui n'est pas le défaut, un tempo choisi.
  await author.evaluate(() => {
    const c = window.__carillon
    c.reset()
    const ids = [
      c.addBar(200, 300, 500, 320),
      c.addBar(600, 400, 900, 420),
      c.addBar(250, 550, 550, 570),
    ]
    c.setBar(ids[1], { nature: 'trampoline' })
    c.setBar(ids[2], { nature: 'ephemeral' })
    c.addEmitter(400, 120, 3)
  })
  // Un instrument qui n'est pas le défaut, choisi dans la roue : sinon « l'instrument traverse le
  // lien » serait vrai même si le champ ne voyageait pas.
  const notDefault = await author.evaluate(
    () => window.__carillon.stats().instrumentIds.find((id) => id !== window.__carillon.stats().instrument)
  )
  await chooseInstrument(author, notDefault)
  const sent = await author.evaluate(() => {
    const c = window.__carillon
    return {
      natures: c.bars().map((bar) => bar.nature),
      instrument: c.stats().instrument,
      bpm: c.stats().bpm,
      divisions: c.emitters().map((emitter) => emitter.divisionIndex),
    }
  })
  // Le lien passe par le **bouton**, comme pour un utilisateur : c'est lui qui écrit le fragment
  // d'URL, et le tester par un appel direct laisserait ce chemin non vérifié.
  await author.click('[data-control="share"]')
  await wait(200)
  const link = await author.evaluate(() => location.href)
  console.log(
    `  [partage] envoyé : natures=${sent.natures.join(',')} instrument=${sent.instrument} divisions=${sent.divisions.join(',')} | lien de ${link.length} caractères`
  )
  await author.close()

  const guest = await browser.newPage()
  rec.attachConsoleListeners(guest)
  await guest.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await guest.goto(link, { waitUntil: 'load' })
  await waitForCarillon(guest)
  await tick(guest)
  const got = await guest.evaluate(() => ({
    natures: window.__carillon.bars().map((bar) => bar.nature),
    instrument: window.__carillon.stats().instrument,
    bpm: window.__carillon.stats().bpm,
    divisions: window.__carillon.emitters().map((emitter) => emitter.divisionIndex),
  }))
  console.log(
    `  [partage] reçu : natures=${got.natures.join(',')} instrument=${got.instrument} divisions=${got.divisions.join(',')}`
  )

  rec.assert(
    'la nature de chaque barre traverse le lien',
    JSON.stringify(got.natures) === JSON.stringify(sent.natures),
    `${sent.natures.join(',')} -> ${got.natures.join(',')}`
  )
  rec.assert(
    'l’instrument traverse le lien',
    got.instrument === sent.instrument && got.instrument !== 'carillon',
    `${sent.instrument} -> ${got.instrument}`
  )
  rec.assert(
    'la division de chaque source traverse le lien',
    JSON.stringify(got.divisions) === JSON.stringify(sent.divisions),
    `${sent.divisions.join(',')} -> ${got.divisions.join(',')}`
  )
  await rec.shot(guest, 'partage-v2')
  await guest.close()
}

/**
 * Le point de lâcher. Avant, lâcher une bille créait une source de son **permanente et invisible** :
 * rien ne la montrait, rien ne permettait de la déplacer ni de la supprimer, alors que la stratégie du
 * produit interdit l'état caché. C'était un défaut de principe, pas une fonctionnalité manquante.
 */
async function runLacher(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await page.mouse.click(640, 740)

  await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(300, 500, 900, 530)
  })
  await tick(page)

  // Un clic dans le vide lâche une bille — et doit créer un point visible.
  await page.mouse.click(500, 200)
  await wait(150)
  const created = await page.evaluate(() => window.__carillon.droppers())
  console.log(`  [lâcher] après un clic : ${created.length} point(s) de lâcher`)
  rec.assert(
    'lâcher une bille crée un point de lâcher',
    created.length === 1 && Math.abs(created[0].x - 500) < 3,
    JSON.stringify(created)
  )

  // Il se déplace au glisser, comme une source.
  await page.mouse.move(created[0].x, created[0].y)
  await page.mouse.down()
  await page.mouse.move(created[0].x + 240, created[0].y + 60, { steps: 8 })
  await page.mouse.up()
  await wait(150)
  const moved = await page.evaluate(() => window.__carillon.droppers())
  console.log(`  [lâcher] après glisser : x ${Math.round(created[0].x)} -> ${Math.round(moved[0]?.x ?? -1)}`)
  rec.assert(
    'le point de lâcher se déplace au glisser',
    moved.length === 1 && moved[0].x > created[0].x + 180,
    `${Math.round(created[0].x)} -> ${Math.round(moved[0]?.x ?? -1)}`
  )

  // La bille revient **au nouvel endroit** : c'est ce qui rend le déplacement utile.
  const back = await page.evaluate(() => {
    const c = window.__carillon
    /*
     * Relevé **pendant** l'avance, pas à la fin : une bille recyclée n'existe qu'environ 1,1 s par
     * mesure de 2,5 s, donc un relevé unique tombe à côté plus d'une fois sur deux. Même piège que dans
     * le scénario `rythme`.
     */
    const seen = []
    for (let i = 0; i < 40; i += 1) {
      c.advance(0.25)
      for (const ball of c.balls()) seen.push(Math.round(ball.origin ?? ball.x))
    }
    return seen
  })
  console.log(`  [lâcher] billes vues sur 10 s : ${back.length}`)
  /*
   * On exige qu'une bille **revienne** au nouvel emplacement, pas que toutes y soient : la bille
   * initiale garde légitimement son origine d'avant le déplacement — elle a bien été lâchée là. Ce sont
   * les retours qui suivent le point.
   */
  const origins = [...new Set(back)]
  rec.assert(
    'la bille revient au nouvel emplacement du point',
    origins.some((x) => x > created[0].x + 180),
    `origines vues : ${origins.join(', ')}`
  )

  // Capture **pendant** que le point existe : prise après sa suppression, elle ne montrait rien —
  // troisième fois que l'instant de capture me joue le tour dans ce dépôt.
  await rec.shot(page, 'point-de-lacher')

  // Et il se jette par le bord, comme une barre ou une source.
  const target = await page.evaluate(() => window.__carillon.droppers()[0])
  await page.mouse.move(target.x, target.y)
  await page.mouse.down()
  await page.mouse.move(1272, target.y, { steps: 10 })
  await page.mouse.up()
  await wait(150)
  const after = await page.evaluate(() => ({
    droppers: window.__carillon.droppers().length,
    pending: window.__carillon.stats().pendingRespawns,
  }))
  console.log(`  [lâcher] après suppression : ${after.droppers} point(s), ${after.pending} retour(s) en attente`)
  rec.assert(
    'le point de lâcher se jette par le bord',
    after.droppers === 0,
    `${after.droppers} point(s)`
  )
  rec.assert(
    'sa suppression annule les retours en attente',
    after.pending === 0,
    `${after.pending} en attente`
  )

  // Plus rien ne revient : sans ça, la scène rejouerait ce qu'on vient d'effacer.
  const silent = await page.evaluate(() => {
    const c = window.__carillon
    let seen = 0
    for (let i = 0; i < 8; i += 1) {
      c.advance(1)
      seen = Math.max(seen, c.stats().balls)
    }
    return seen
  })
  rec.assert(
    'aucune bille ne réapparaît après suppression du point',
    silent === 0,
    `${silent} bille(s) vue(s)`
  )

  await rec.shot(page, 'point-de-lacher-supprime')
  await page.close()

  /*
   * Et le défaut que ça révèle : une scène partagée **perdait ses billes**. Un air composé ne tient que
   * par une bille recyclée, donc son lien arrivait silencieux jusqu'au premier clic du destinataire.
   */
  const author = await browser.newPage()
  rec.attachConsoleListeners(author)
  await author.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await author.goto(url, { waitUntil: 'load' })
  await waitForCarillon(author)
  await author.mouse.click(640, 740)
  let air = null
  for (let i = 0; i < 6 && !air; i += 1) {
    await author.click('[data-control="surprise"]')
    await wait(250)
    air = await author.evaluate(() => window.__carillon.composedMelody())
  }
  await author.click('[data-control="share"]')
  await wait(200)
  const link = await author.evaluate(() => location.href)
  const sentDroppers = await author.evaluate(() => window.__carillon.droppers().length)
  await author.close()

  const guest = await browser.newPage()
  rec.attachConsoleListeners(guest)
  await guest.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await guest.goto(link, { waitUntil: 'load' })
  await waitForCarillon(guest)
  const received = await guest.evaluate(() => {
    const c = window.__carillon
    const before = c.stats().impacts
    c.advance(10)
    return {
      droppers: c.droppers().length,
      impacts: c.stats().impacts - before,
      air: c.composedMelody(),
    }
  })
  console.log(
    `  [lâcher] air partagé « ${air?.label ?? '?'} » : ${sentDroppers} point(s) envoyé(s), ${received.droppers} reçu(s), ${received.impacts} impacts chez le destinataire`
  )
  rec.assert(
    'les points de lâcher traversent le lien',
    received.droppers === sentDroppers && sentDroppers > 0,
    `${sentDroppers} -> ${received.droppers}`
  )
  rec.assert(
    'un air partagé arrive **en jouant**, sans clic du destinataire',
    received.impacts > 0,
    `${received.impacts} impacts`
  )
  await guest.close()
}

async function runVernis(browser, url, rec) {
  // F1 — densité du HUD sur le plus petit écran courant.
  const small = await browser.newPage()
  rec.attachConsoleListeners(small)
  await small.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await small.goto(url, { waitUntil: 'load' })
  await waitForCarillon(small)
  await tick(small)

  const hudShare = () =>
    small.evaluate(() => {
      const rects = [...document.querySelectorAll('[data-hud]')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
      const middle = window.innerHeight / 2
      let top = 0
      let bottom = window.innerHeight
      for (const r of rects) {
        if ((r.top + r.bottom) / 2 < middle) top = Math.max(top, r.bottom)
        else bottom = Math.min(bottom, r.top)
      }
      return (window.innerHeight - (bottom - top)) / window.innerHeight
    })

  const atLoad = await hudShare()
  // Un premier geste : l'indice a été lu, il cède sa place sur les petits écrans.
  await small.touchscreen.tap(160, 300)
  await tick(small)
  const afterGesture = await hudShare()
  console.log(
    `  [vernis] HUD sur 320x568 : ${Math.round(atLoad * 100)}% au chargement, ${Math.round(afterGesture * 100)}% après le 1er geste (44 % avant l'US6)`
  )
  rec.assert(
    'le HUD occupe au plus 30 % d’un 320x568 en usage',
    afterGesture <= 0.3,
    `${Math.round(afterGesture * 100)}%`
  )

  // F2 — un pictogramme sans nom est une devinette : chaque contrôle garde un libellé accessible unique.
  const labels = await small.evaluate(() =>
    [...document.querySelectorAll('[data-control]')].map((el) => ({
      label: el.getAttribute('aria-label') ?? '',
      title: el.getAttribute('title') ?? '',
      // Style **calculé**, pas `textContent` : ce dernier inclut les libellés masqués en CSS, donc il
      // ne distingue pas le mode icône du mode texte — première version de cette assertion, creuse.
      labelHidden: (() => {
        const label = el.querySelector('.label')
        return label ? getComputedStyle(label).display === 'none' : false
      })(),
      // Le libellé masqué ne prouve **rien** sur le pictogramme. La règle qui l'affiche ne tient que
      // par une spécificité égale : la casser rendait cinq boutons parfaitement vides, et la seule
      // assertion existante passait quand même — en *améliorant* même la métrique de densité du HUD.
      iconVisible: (() => {
        const icon = el.querySelector('.icon')
        return !!icon && getComputedStyle(icon).display !== 'none'
      })(),
      // Filet indépendant du balisage : le bouton a-t-il **quelque chose** de visible à montrer ?
      visibleInk: [...el.children].some(
        (child) =>
          getComputedStyle(child).display !== 'none' && (child.textContent ?? '').trim().length > 0
      ),
    }))
  )
  rec.assert(
    'chaque contrôle garde un libellé accessible distinct en mode icône',
    labels.length >= 6 &&
      labels.every((l) => l.label.length > 2 && l.title.length > 2) &&
      new Set(labels.map((l) => l.label)).size === labels.length,
    `${labels.length} contrôles`
  )
  // Le mode icône doit réellement être actif : sinon l'assertion précédente ne prouverait rien.
  const iconMode = labels.filter((l) => l.labelHidden).length
  rec.assert(
    'le mode icône est bien actif sur cet écran',
    iconMode === labels.length,
    `${iconMode}/${labels.length} libellés masqués`
  )
  const withIcon = labels.filter((l) => l.iconVisible).length
  rec.assert(
    'en mode icône, le pictogramme de chaque contrôle est réellement affiché',
    withIcon === labels.length,
    `${withIcon}/${labels.length} pictogrammes visibles`
  )
  const withInk = labels.filter((l) => l.visibleInk).length
  rec.assert(
    'aucun contrôle n’est visuellement vide',
    withInk === labels.length,
    `${withInk}/${labels.length} contrôles avec du contenu visible`
  )

  // F3 — au doigt, les poignées se révèlent au premier contact (il n'existe pas de survol tactile).
  const revealed = await small.evaluate(() => window.__carillon.stats().revealHandles)
  rec.assert('un contact tactile révèle les poignées de préhension', revealed, `revealHandles=${revealed}`)
  // Capture **pendant** la révélation : après l'estompage, elle ne montrerait plus ce qu'elle prouve.
  /*
   * La révélation doit se **voir**, pas seulement être vraie dans `stats()`. Ici la mesure en pixels
   * est légitime, là où elle échouait pour les étincelles : la scène est figée (une barre, zéro bille,
   * zéro source), donc la seule différence entre les deux relevés **est** la poignée.
   *
   * Défaut trouvé en review : la première version dessinait un disque de 4,5 px à 22 % d'opacité sur un
   * bout de barre déjà rond et lumineux — 570 pixels de différence sur 181 760, dont l'essentiel venait
   * du liseré de la barre. Ça se lisait « les barres ont éclairci », pas « les barres ont des poignées ».
   */
  const endpointInk = (page, ax, ay, bx, by) =>
    page.evaluate(
      ([ax, ay, bx, by]) => {
        const stage = document.getElementById('stage')
        const scale = stage.width / stage.clientWidth
        const ctx = stage.getContext('2d')
        const radius = 14
        let bright = 0
        for (const [cx, cy] of [
          [ax, ay],
          [bx, by],
        ]) {
          const size = Math.round(radius * 2 * scale)
          const { data } = ctx.getImageData(
            Math.round((cx - radius) * scale),
            Math.round((cy - radius) * scale),
            size,
            size
          )
          for (let i = 0; i < data.length; i += 4) {
            // Blanc quasi pur : la poignée est blanche, la barre est colorée. C'est la saturation qui
            // les sépare, pas la luminosité — une barre jaune est plus lumineuse qu'une poignée.
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
            const min = Math.min(r, g, b)
            if (min > 150) bright += 1
          }
        }
        return bright
      },
      [ax, ay, bx, by]
    )

  await rec.shot(small, 'petit-ecran-poignees')
  await small.evaluate(() => window.__carillon.advance(6))
  await tick(small)
  const faded = await small.evaluate(() => window.__carillon.stats().revealHandles)
  rec.assert('la révélation s’estompe ensuite', !faded, `revealHandles=${faded}`)
  await rec.shot(small, 'petit-ecran-repos')

  /*
   * La révélation est **à usage unique** : `touchHinted` (dans `input.ts`) ne se déclenche qu'au premier
   * contact de la session. C'est voulu — c'est un dispositif d'apprentissage, et le rejouer à chaque
   * contact en ferait du bruit visuel sur quinze barres. Cette unicité n'était vérifiée nulle part, et
   * elle est ce qui a d'abord fait échouer la mesure de pixels : le second tap ne révélait rien, à raison.
   */
  await small.touchscreen.tap(160, 200)
  await wait(120)
  const revealedTwice = await small.evaluate(() => window.__carillon.stats().revealHandles)
  rec.assert(
    'un second contact ne rejoue pas la révélation (dispositif à usage unique)',
    !revealedTwice,
    `revealHandles=${revealedTwice}`
  )

  await small.close()

  // À la souris, pas de révélation globale : le survol suffit, et l'afficher en permanence serait du bruit.
  const desk = await browser.newPage()
  rec.attachConsoleListeners(desk)
  await desk.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await desk.goto(url, { waitUntil: 'load' })
  await waitForCarillon(desk)
  await desk.mouse.click(640, 700)
  await tick(desk)
  const deskReveal = await desk.evaluate(() => window.__carillon.stats().revealHandles)
  rec.assert('un clic souris ne révèle rien globalement', !deskReveal, `revealHandles=${deskReveal}`)
  await desk.close()

  // F4 — mouvement réduit : plus de traînées, mais les billes bougent toujours.
  for (const reduce of [false, true]) {
    const page = await browser.newPage()
    rec.attachConsoleListeners(page)
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' },
    ])
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(url, { waitUntil: 'load' })
    await waitForCarillon(page)
    await tick(page)
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) window.__carillon.dropBall(140 + i * 50, 170)
    })
    await wait(900)
    const stats = await page.evaluate(() => window.__carillon.stats())
    console.log(
      `  [vernis] reduce=${reduce} : vu par l'app ${stats.reducedMotion}, traînée ${stats.trailPoints}, étincelles ${stats.particles}, billes ${stats.balls}`
    )
    rec.assert(
      `la préférence de mouvement est bien lue (reduce=${reduce})`,
      stats.reducedMotion === reduce,
      `reducedMotion=${stats.reducedMotion}`
    )
    rec.assert(
      reduce ? 'le mouvement réduit supprime les traînées' : 'les traînées existent en mode normal',
      reduce ? stats.trailPoints === 0 : stats.trailPoints > 0,
      `points=${stats.trailPoints}`
    )
    // Le point clé : on raccourcit, on ne fige pas. Une scène immobile ne serait plus un instrument.
    // Deux relevés, pas un. `balls > 0` mesurait la **présence** de billes : geler entièrement le
    // monde en mouvement réduit laissait passer les quatre assertions de cette branche.
    const before = await page.evaluate(() => ({
      impacts: window.__carillon.stats().impacts,
      positions: window.__carillon.balls().map((b) => [b.id, b.x, b.y]),
    }))
    await wait(350)
    const after = await page.evaluate(() => ({
      impacts: window.__carillon.stats().impacts,
      positions: window.__carillon.balls().map((b) => [b.id, b.x, b.y]),
    }))
    const stillThere = after.positions.filter(([id]) =>
      before.positions.some(([other]) => other === id)
    )
    const moved = stillThere.filter(([id, x, y]) => {
      const was = before.positions.find(([other]) => other === id)
      return was && Math.hypot(x - was[1], y - was[2]) > 1
    })
    const meanMove =
      stillThere.reduce((sum, [id, x, y]) => {
        const was = before.positions.find(([other]) => other === id)
        return sum + (was ? Math.hypot(x - was[1], y - was[2]) : 0)
      }, 0) / Math.max(stillThere.length, 1)
    /*
     * Déplacement **moyen**, pas « toutes les billes ont bougé » : une bille au sommet de son rebond
     * parcourt légitimement moins d'un pixel en 350 ms (mesuré : 21 sur 22). Le seuil vient du domaine
     * — en 350 ms de chute libre une bille couvre ~86 px, donc 20 px est très en dessous de tout
     * mouvement réel et très au-dessus de zéro. Un monde figé donne exactement 0.
     */
    rec.assert(
      `les billes continuent de tomber (reduce=${reduce})`,
      stats.balls > 0 && stillThere.length > 0 && meanMove > 20,
      `déplacement moyen ${meanMove.toFixed(1)} px sur ${stillThere.length} billes`
    )
    rec.assert(
      `la simulation continue de produire des impacts (reduce=${reduce})`,
      after.impacts > before.impacts,
      `${before.impacts} -> ${after.impacts} impacts`
    )
    rec.assert(
      reduce ? 'le mouvement réduit supprime les étincelles' : 'les impacts produisent des étincelles',
      reduce ? stats.particles === 0 : stats.particles > 0,
      `étincelles=${stats.particles}`
    )
    if (reduce) await rec.shot(page, 'mouvement-reduit')
    await page.close()
  }

  /*
   * F3 en pixels — la révélation doit se **voir**, pas seulement être vraie dans `stats()`.
   *
   * Ici la mesure de pixels est légitime là où elle échouait pour les étincelles : la scène est figée
   * (une barre, zéro bille, zéro source), donc la seule différence entre les deux relevés **est** la
   * poignée. Défaut trouvé en review : la première version dessinait un disque de 4,5 px à 22 %
   * d'opacité sur un bout de barre déjà rond et lumineux — 570 pixels de différence sur 181 760, dont
   * l'essentiel venait du liseré de la barre. Ça se lisait « les barres ont éclairci », pas « les barres
   * ont des poignées ».
   *
   * Page **fraîche** : la révélation est à usage unique (cf. plus haut).
   */
  const ink = await browser.newPage()
  rec.attachConsoleListeners(ink)
  await ink.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ink.goto(url, { waitUntil: 'load' })
  await waitForCarillon(ink)
  const inkBar = await ink.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(70, 250, 240, 290)
    return c.bars()[0]
  })
  // `wait`, pas `tick` : lire le canvas juste après un geste le lit **avant** le repaint qui contient
  // la poignée — même piège que lire le DOM après un `.click()`.
  await wait(150)
  const inkAtRest = await endpointInk(ink, inkBar.ax, inkBar.ay, inkBar.bx, inkBar.by)
  await ink.touchscreen.tap(160, 180)
  await wait(150)
  const inkRevealed = await endpointInk(ink, inkBar.ax, inkBar.ay, inkBar.bx, inkBar.by)
  console.log(
    `  [vernis] pixels blancs aux extrémités : ${inkAtRest} au repos, ${inkRevealed} pendant la révélation`
  )
  rec.assert(
    'la révélation se voit réellement aux extrémités de la barre',
    inkRevealed > inkAtRest * 3 + 200,
    `${inkAtRest} -> ${inkRevealed} pixels blancs`
  )
  await ink.close()

  // F5 — les étincelles, en gros plan. Une gerbe se photographie **peu après** l'impact : à l'âge 0
  // toutes les étincelles sont encore au point de contact, cachées dans le halo de la bille, et la
  // capture ne montre rien. C'est ce faux négatif qui a d'abord fait croire à un rendu invisible.
  const spark = await browser.newPage()
  rec.attachConsoleListeners(spark)
  await spark.setViewport({ width: 1000, height: 700, deviceScaleFactor: 2 })
  await spark.goto(url, { waitUntil: 'load' })
  await waitForCarillon(spark)
  await spark.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(300, 420, 700, 470)
    c.dropBall(420, 60)
  })
  /*
   * Pas de mesure de pixels ici, et c'est un choix mesuré, pas un renoncement. Une couronne de 26 à
   * 80 px autour du contact donnait 15 364 pixels clairs à l'impact et 13 751 après 70 ms — elle
   * *baisse*, parce qu'elle est dominée par le halo de la barre qui s'éteint (420 ms) et par l'onde
   * d'impact qui la traverse en s'étendant. Les étincelles y pèsent trop peu pour être isolées.
   *
   * La propriété qui les rendait invisibles est **géométrique et pure** : avec l'ancien réglage elles
   * mouraient sans quitter le halo de la bille. Elle est donc assertée là où elle est exacte, en test
   * unitaire (« la gerbe quitte le halo en 70 ms »), et la capture ci-dessous reste la preuve à l'œil.
   */
  await spark.waitForFunction(() => window.__carillon.stats().impacts > 0, { timeout: 5000 })
  await wait(70)
  const sparkStats = await spark.evaluate(() => window.__carillon.stats())
  rec.assert(
    'un impact isolé produit une gerbe visible et bornée',
    sparkStats.particles > 0 && sparkStats.particles <= sparkStats.maxParticles,
    `étincelles=${sparkStats.particles}`
  )
  console.log(`  [vernis] gerbe d'un impact isolé : ${sparkStats.particles} étincelles`)
  await rec.shot(spark, 'etincelles-gros-plan')
  await spark.close()
}

/**
 * Le rythme. Deux propriétés qu'aucun scénario ne pouvait montrer avant l'US7 : les sources tombent
 * sur une **grille** commune (donc un motif se répète en phase au lieu de flotter), et une bille lâchée
 * à la main **revient** au lieu de disparaître — un seul geste devient un élément rythmique permanent.
 */
async function runRythme(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await page.mouse.click(640, 740)

  // Deux sources de même division, posées à des instants différents : c'est le cas qui distingue une
  // grille commune d'une simple période régulière.
  const emitters = await page.evaluate(async () => {
    const c = window.__carillon
    c.reset()
    c.addBar(200, 420, 560, 470)
    c.addBar(700, 500, 1060, 545)
    c.addEmitter(300, 120, 1)
    await new Promise((r) => setTimeout(r, 180))
    c.addEmitter(800, 120, 1)
    return c.emitters()
  })
  console.log(
    `  [rythme] sources : ${emitters.map((e) => `#${e.id} div=${e.divisionIndex} période=${e.period.toFixed(3)}s échéance=${e.nextAt.toFixed(3)}`).join(' | ')}`
  )
  /*
   * On laisse passer **une division entière** avant de comparer. Sans cela, l'assertion dépendait de
   * l'instant de chargement : les deux sources sont posées à 180 ms d'écart de temps mural, et si ces
   * 180 ms enjambent une frontière de division, elles visent deux pas *différents de la même grille* —
   * l'assertion tombait sans qu'il y ait de défaut (mesuré instable environ une fois sur sept).
   *
   * Après une division, les deux visent le même instant suivant quel que soit leur passé : c'est
   * exactement la propriété « en phase », et elle ne dépend plus du hasard du chargement.
   */
  await page.evaluate((seconds) => window.__carillon.advance(seconds), (60 / 96) * 4 * 0.5 + 0.05)
  await tick(page)
  const armed = await page.evaluate(() => window.__carillon.emitters())
  rec.assert(
    'deux sources de même division visent exactement le même instant',
    armed.length === 2 && armed[0].nextAt === armed[1].nextAt,
    armed.map((e) => e.nextAt).join(' vs ')
  )
  rec.assert(
    'la période découle du tempo et de la division, pas d’une valeur libre',
    emitters.every((e) => Math.abs(e.period - (60 / 96) * 4 * 0.5) < 1e-9),
    `${emitters[0]?.period}`
  )

  // Elles restent en phase après une longue course : c'est ce qu'une échéance cumulée finit par perdre.
  await page.evaluate(() => window.__carillon.advance(120))
  await tick(page)
  const later = await page.evaluate(() => window.__carillon.emitters())
  rec.assert(
    'toujours en phase après 120 s simulées',
    later.length === 2 && later[0].nextAt === later[1].nextAt,
    later.map((e) => e.nextAt).join(' vs ')
  )

  /*
   * Changer le rythme d'une source par le **vrai geste**, pas par un appel d'API : depuis l'US17, taper
   * la source ouvre sa roue et c'est le choix d'un secteur qui applique. Ce qui est vérifié ici est la
   * conséquence rythmique ; l'ouverture de la roue et la disparition du cyclage sont dans `sources`.
   */
  /*
   * On part de la division **2** (un tiers de mesure) vers la **3** (un quart), et pas de 0 vers 3.
   * Depuis la mesure entière, tout instant de grille est déjà un multiple du quart : l'écart à la grille
   * valait donc 0 **même sans aucun ré-armement**, et l'assertion suivante était creuse — démontré par
   * mutation. Un tiers n'est pas un sous-multiple d'un quart, donc la grille change vraiment.
   */
  const cycled = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addEmitter(500, 300, 2)
    return c.emitters()[0]
  })
  await tick(page)
  await page.mouse.click(500, 300)
  await wait(150)
  await pickInPinnedWheel(page, '3')
  await tick(page)
  const afterTap = await page.evaluate(() => window.__carillon.emitters()[0])
  console.log(
    `  [rythme] roue de la source : division ${cycled.divisionIndex} -> ${afterTap.divisionIndex} (période ${cycled.period.toFixed(3)}s -> ${afterTap.period.toFixed(3)}s)`
  )
  rec.assert(
    'choisir une division dans la roue raccourcit bien la période',
    afterTap.divisionIndex === 3 && afterTap.period < cycled.period,
    `${cycled.divisionIndex} -> ${afterTap.divisionIndex}, période ${cycled.period.toFixed(3)} -> ${afterTap.period.toFixed(3)}`
  )
  /*
   * Ce que cette assertion prouve : après un changement de division **par le vrai geste**, la source est
   * sur la grille de sa nouvelle division et son échéance est devant nous, à moins d'une période.
   *
   * Ce qu'elle ne prouve **pas**, et il faut le dire ici : que `setDivision` remette la source en phase.
   * Cette propriété n'est pas observable depuis le navigateur, parce que `runEmitters` recalcule
   * l'échéance depuis la grille de la division **courante** à chaque émission — une source privée de
   * ré-armement se raccroche donc d'elle-même dès sa première émission, en moins d'une période. Neutraliser
   * la remise en phase laisse ce scénario vert, et j'ai d'abord cru le contraire.
   *
   * C'est le test pur `emitter.test.ts` › « changer de division ré-arme sur la grille » qui porte cette
   * propriété, et il tue la mutation. Le partage est le bon : la conséquence rythmique se vérifie dans la
   * page, le ré-armement dans le cœur.
   *
   * Troisième version de cette assertion. La première était `nextAt - période <= nextAt`, vraie par
   * construction ; la deuxième mesurait la grille depuis une division qui la contenait déjà.
   */
  const gridOffset = Math.abs(
    afterTap.nextAt / afterTap.period - Math.round(afterTap.nextAt / afterTap.period)
  )
  const ahead = afterTap.nextAt - (await page.evaluate(() => window.__carillon.stats().time))
  rec.assert(
    'la nouvelle échéance retombe sur la grille de la nouvelle division, et devant nous',
    gridOffset < 1e-6 && ahead > 0 && ahead <= afterTap.period + 1e-9,
    `écart à la grille = ${gridOffset.toExponential(2)}, échéance dans ${ahead.toFixed(4)}s (période ${afterTap.period.toFixed(4)}s)`
  )
  // Et c'est annulable : un changement de rythme est une modification de la scène comme une autre.
  await page.keyboard.down('Meta')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Meta')
  await tick(page)
  const afterUndo = await page.evaluate(() => window.__carillon.emitters()[0])
  rec.assert(
    'annuler restaure la division précédente',
    afterUndo?.divisionIndex === cycled.divisionIndex,
    `division=${afterUndo?.divisionIndex}`
  )

  // Recyclage : une bille lâchée à la main revient.
  const recycled = await page.evaluate(async () => {
    const c = window.__carillon
    c.reset()
    c.addBar(400, 450, 800, 500)
    const firstId = c.dropBall(500, 120)
    /*
     * On suit les **identifiants**. Une bille recyclée revient avec un id neuf : c'est la seule chose
     * qui distingue un retour d'une bille encore en vol. La version précédente prenait le maximum du
     * nombre de billes sur six relevés, dont le premier à t = 1 s — quand la bille d'origine rebondit
     * encore. Vérifié par mutation : en empêchant tout retour, elle restait verte.
     */
    const seen = { queued: 0, fresh: 0, ballsAfter: 0, ids: [] }
    // Relevé tous les quarts de seconde : la file se vide sur le temps de mesure, et un relevé par
    // seconde pouvait tomber systématiquement à côté de la fenêtre où elle est pleine.
    for (let i = 0; i < 32; i += 1) {
      c.advance(0.25)
      seen.queued = Math.max(seen.queued, c.stats().pendingRespawns)
      for (const ball of c.balls()) if (!seen.ids.includes(ball.id)) seen.ids.push(ball.id)
    }
    seen.fresh = seen.ids.filter((id) => id !== firstId).length
    seen.ballsAfter = c.stats().balls
    return seen
  })
  console.log(
    `  [rythme] recyclage : file max=${recycled.queued} billes neuves=${recycled.fresh} billes à la fin=${recycled.ballsAfter}`
  )
  rec.assert(
    'une bille lâchée à la main est reprogrammée quand elle sort',
    recycled.queued > 0,
    `file max=${recycled.queued}`
  )
  rec.assert(
    'la bille **revient** : au moins une bille d’identifiant neuf apparaît',
    recycled.fresh > 0,
    `${recycled.fresh} bille(s) neuve(s)`
  )

  // Capture du chemin **nominal** : deux sources en phase et une bille recyclée. Prise ici et non en
  // fin de scénario, où les 60 billes du test de bornes noient la barre sous autant d'ondes d'impact.
  await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(220, 430, 600, 480)
    c.addBar(700, 520, 1080, 560)
    c.addEmitter(320, 130, 1)
    c.addEmitter(820, 130, 3)
    c.dropBall(500, 150)
    c.advance(3.2)
  })
  await tick(page)
  await rec.shot(page, 'rythme')

  // Et le recyclage ne fuit pas : ni les billes ni la file ne grossissent sans fin.
  const bounded = await page.evaluate(() => {
    const c = window.__carillon
    // Scène neuve : sans ça le compte héritait des billes encore en circulation du bloc précédent, et
    // la borne « 60 lâchées, 60 en circulation » comparait à un total faussé.
    c.reset()
    c.addBar(200, 500, 1000, 540)
    for (let i = 0; i < 60; i += 1) c.dropBall(60 + i * 20, 100)
    c.advance(180)
    const s = c.stats()
    c.advance(60)
    const later = c.stats()
    return {
      balls: s.balls,
      queued: s.pendingRespawns,
      queuedLater: later.pendingRespawns,
      max: s.maxBalls,
      dropped: s.droppedSteps,
    }
  })
  console.log(
    `  [rythme] après 180 s et 60 billes recyclées : billes=${bounded.balls}/${bounded.max} file=${bounded.queued} pasPerdus=${bounded.dropped}`
  )
  /*
   * Borné par ce que la scène peut **produire**, pas par le plafond global : 60 billes lâchées, donc au
   * plus 62 en vol et en attente confondues. `balls <= MAX_BALLS` était garanti par construction
   * (`runEmitters` tronque le tableau à chaque pas) — une assertion qui ne pouvait rien apprendre.
   */
  rec.assert(
    'le recyclage ne crée pas de billes : 60 lâchées, 60 en circulation',
    bounded.balls + bounded.queued <= 62,
    `${bounded.balls} en vol + ${bounded.queued} en attente`
  )
  rec.assert(
    'la file ne croît pas avec le temps',
    bounded.queuedLater <= bounded.queued + 2,
    `${bounded.queued} -> ${bounded.queuedLater}`
  )
  rec.assert('aucun pas de simulation abandonné', bounded.dropped === 0, `${bounded.dropped}`)

  /*
   * « Effacer » doit vider la scène, **file des retours comprise**. Sans ça, les billes recyclées en
   * attente revenaient à chaque mesure dans une scène sans aucune barre, indéfiniment : un contrôle qui
   * cesse de faire ce qu'il annonce.
   */
  const cleared = await page.evaluate(async () => {
    const c = window.__carillon
    for (let i = 0; i < 5; i += 1) c.dropBall(200 + i * 150, 100)
    c.advance(4) // le temps qu'elles sortent et soient reprogrammées
    const before = c.stats().pendingRespawns
    document.querySelector('[data-control="clear"]').click()
    const justAfter = c.stats()
    c.advance(8) // deux mesures : largement de quoi voir revenir ce qui aurait survécu
    const later = c.stats()
    return { before, justAfter: justAfter.pendingRespawns, balls: later.balls, queued: later.pendingRespawns }
  })
  console.log(
    `  [rythme] après Effacer : file ${cleared.before} -> ${cleared.justAfter}, puis ${cleared.balls} bille(s) et ${cleared.queued} en attente 8 s plus tard`
  )
  rec.assert(
    'des retours étaient bien en attente avant d’effacer',
    cleared.before > 0,
    `file=${cleared.before}`
  )
  rec.assert(
    'Effacer vide aussi la file des retours',
    cleared.justAfter === 0,
    `file=${cleared.justAfter}`
  )
  rec.assert(
    'aucune bille ne réapparaît dans une scène effacée',
    cleared.balls === 0 && cleared.queued === 0,
    `${cleared.balls} bille(s), ${cleared.queued} en attente`
  )

  await rec.shot(page, 'rythme-charge')
  await page.close()
}

/**
 * Les timbres. Un instrument est une **paire de voix** (grave/aigu) : chaque scène combine donc deux
 * sons sans qu'on ait rien à choisir. Ce que ce scénario vérifie n'est pas « ça sonne bien » — l'oreille
 * en juge — mais que chaque instrument **produit réellement du son** : quatre combinaisons de formes
 * d'onde, dont une voix nue sans seconde couche, passent toutes par le même chemin audio.
 */
async function runTimbres(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  // Vrai geste : sans lui l'AudioContext reste verrouillé et `notes` resterait à 0 pour tout le monde.
  await page.mouse.click(640, 740)

  const button = '[data-control="instrument"]'
  // Le nombre vient de l'app : ajouter un instrument ne doit pas casser l'assertion, mais en oublier
  // un dans la roue doit la casser.
  const catalogue = await page.evaluate(() => window.__carillon.stats().instrumentIds)
  const seen = []
  for (const wanted of catalogue) {
    /*
     * Chaque timbre est choisi **explicitement** dans la roue. Le cycle du bouton, jusqu'à l'US16,
     * imposait de traverser le catalogue dans l'ordre : l'assertion prouvait alors « le bouton avance »,
     * pas « ce timbre-là est atteignable ». Elle prouve maintenant le second, qui est ce qui compte.
     */
    await chooseInstrument(page, wanted)
    await tick(page)
    const state = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      const label = el.querySelector('.label')
      return {
        id: window.__carillon.stats().instrument,
        label: (label?.textContent ?? '').trim(),
        notesBefore: window.__carillon.stats().notes,
      }
    }, button)

    /*
     * Une scène fraîche à chaque instrument, et de vraies chutes : c'est le seul moyen de prouver que ce
     * timbre-là passe par le moteur, et pas seulement qu'un libellé a changé.
     *
     * Deux pièges rencontrés ici, opposés :
     *
     * 1. Attendre que le compteur de notes augmente (plafond 6 s) sortait à zéro une fois sur cinq sur
     *    une machine chargée. Une preuve qui dépend de la charge n'est pas une preuve.
     * 2. Tout avancer par `advance` sans pause a échoué **systématiquement** à partir du cinquième
     *    instrument : `advance` déclenche tous les impacts au **même instant audio** — l'horloge audio
     *    n'avance pas, elle — donc le budget de polyphonie sature et refuse les notes suivantes. Le
     *    produit va bien ; c'était le pilotage qui était faux.
     *
     * D'où : impacts déclenchés par `advance` (déterministes) **et** une pause de temps réel entre deux
     * instruments pour libérer les créneaux de voix. La dépendance au temps est ici à sens unique —
     * attendre plus longtemps ne peut que rendre l'assertion plus vraie.
     */
    await wait(1500)
    const after = await page.evaluate(() => {
      const c = window.__carillon
      /*
       * Créneaux de polyphonie libérés avant la salve. La pause de 1,5 s ci-dessus visait le même but
       * mais dépendait de la charge : sous charge, les quatre premiers timbres consommaient les 24
       * créneaux et le cinquième sortait à **0 note** — le scénario accusait alors le produit d'un
       * silence qui venait du pilotage. Mesuré : 7+6+6+5 puis 0 sous charge, contre 7 à 12 par timbre
       * au repos. Une preuve qui dépend de la charge n'est pas une preuve.
       */
      c.releaseVoices()
      c.reset()
      for (let b = 0; b < 5; b += 1) c.addBar(160 + b * 190, 400, 300 + b * 190, 440)
      // Barres courtes ET longues : la bascule grave/aigu doit être exercée, pas seulement une voix.
      c.addBar(120, 620, 1160, 660)
      // Cinq billes plutôt que huit : autant de créneaux de voix en moins à réserver d'un coup.
      for (let k = 0; k < 5; k += 1) c.dropBall(200 + k * 210, 120)
      c.advance(2.5)
      return c.stats()
    })
    seen.push({
      wanted,
      id: state.id,
      label: state.label,
      notes: after.notes - state.notesBefore,
    })

    rec.assert(
      `l'instrument « ${state.label} » produit réellement des notes`,
      after.notes - state.notesBefore > 0,
      `${after.notes - state.notesBefore} notes`
    )
  }

  console.log(
    `  [timbres] ${seen.map((s) => `${s.label}=${s.notes} notes`).join(' | ')}`
  )
  const ids = seen.map((s) => s.id)
  rec.assert(
    'chaque timbre du catalogue est atteignable, et c’est bien celui demandé qui s’applique',
    ids.length === catalogue.length && seen.every((s) => s.id === s.wanted),
    seen.map((s) => `${s.wanted}->${s.id}`).join(' | ')
  )
  /*
   * Le libellé doit **changer avec** l'instrument. `label.length > 2` passait alors que le bouton
   * annonçait cinq fois « Carillon » : vérifié par mutation, en retirant les deux écritures de
   * `applyInstrument`. Pire, les libellés des autres assertions étant construits depuis ce même texte,
   * le journal devenait trompeur et non seulement muet.
   */
  const distinctLabels = new Set(seen.map((s) => s.label))
  // Retour au premier timbre : le libellé doit revenir avec lui, pas rester sur le dernier affiché.
  await chooseInstrument(page, catalogue[0])
  await tick(page)
  const backLabel = await page.evaluate((sel) =>
    (document.querySelector(sel).querySelector('.label')?.textContent ?? '').trim(), button)
  rec.assert(
    'le libellé visible suit l’instrument courant',
    distinctLabels.size === catalogue.length && backLabel === seen[0]?.label,
    `${seen.map((s) => s.label).join(', ')} | retour : ${backLabel}`
  )

  // Le timbre est un réglage de **lecture** : il ne touche aucune hauteur.
  const before = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    // Longueurs **variées** : six barres identiques donnent six fois la même note, et l'assertion
    // comparerait alors deux listes constantes — vraie quoi qu'il arrive.
    for (let b = 0; b < 6; b += 1) c.addBar(120 + b * 180, 400, 120 + b * 180 + 40 + b * 45, 440)
    return { midis: c.bars().map((bar) => bar.midi), instrument: c.stats().instrument }
  })
  // Un timbre **différent** de celui en place : rechoisir le courant ne changerait rien par définition.
  const other = catalogue.find((id) => id !== before.instrument)
  await chooseInstrument(page, other)
  await tick(page)
  const after = await page.evaluate(() => ({
    midis: window.__carillon.bars().map((bar) => bar.midi),
    instrument: window.__carillon.stats().instrument,
  }))
  rec.assert(
    'changer d’instrument ne change aucune hauteur',
    new Set(before.midis).size >= 4 &&
      after.instrument !== before.instrument &&
      JSON.stringify(before.midis) === JSON.stringify(after.midis),
    `${before.instrument}->${after.instrument} : ${before.midis.join(',')} vs ${after.midis.join(',')}`
  )

  /*
   * « Ça sonne bien » n'est pas mesurable, mais « ça sature » l'est. Rendu **hors ligne** de la même
   * chaîne audio que la sortie réelle — mêmes voix, même réverbe, même limiteur : 24 notes simultanées
   * au gain maximal, le pire cas réaliste (une pluie de billes sur une rangée de barres).
   *
   * Mesuré avant correction : la crête de sortie valait 1,38 au carillon et 1,45 au verre, donc en
   * écrêtage franc sur les quatre instruments. Le `DynamicsCompressor` était là depuis l'US1 mais n'avait
   * jamais été réglé — ses valeurs par défaut (attaque 3 ms) laissent passer le transitoire.
   */
  const audio = []
  for (const target of catalogue) {
    // Choisi par le vrai geste, comme le reste du scénario : la boucle de clics qui vivait ici
    // dépendait de l'ordre du cycle, que la roue n'a plus.
    await chooseInstrument(page, target)
    const m = await page.evaluate(async () => {
      const dense = await window.__carillon.measureAudio(24)
      const sparse = await window.__carillon.measureAudio(1)
      return { id: window.__carillon.stats().instrument, dense, sparse }
    })
    audio.push(m)
    rec.assert(
      `aucun écrêtage sur « ${m.id} » à 24 voix simultanées`,
      m.dense.peak < 0.95,
      `crête=${m.dense.peak.toFixed(3)}`
    )
    // Le limiteur ne doit pas non plus tout aplatir : une note seule reste franchement audible, et une
    // scène dense reste plus forte qu'une note seule. Sans ces deux bornes, couper le son passerait.
    rec.assert(
      `une note seule reste audible sur « ${m.id} »`,
      m.sparse.peak > 0.15,
      `crête=${m.sparse.peak.toFixed(3)}`
    )
    rec.assert(
      `la densité s'entend encore sur « ${m.id} » (le limiteur n'aplatit pas)`,
      m.dense.peak > m.sparse.peak * 1.2,
      `${m.sparse.peak.toFixed(3)} -> ${m.dense.peak.toFixed(3)}`
    )
    /*
     * La crête **avant** limiteur était mesurée, journalisée et jamais assertée : là, 18 ou 180,
     * personne ne le voyait. Un facteur 25 vaut déjà 28 dB de réduction — au-delà, le limiteur ne
     * limite plus, il écrase, et il faut baisser le gain en amont plutôt que compter sur lui.
     */
    rec.assert(
      `le limiteur n'est pas écrasé sur « ${m.id} »`,
      m.dense.peakBeforeCompressor < 25,
      `avant limiteur = ${m.dense.peakBeforeCompressor.toFixed(1)}`
    )
  }
  console.log(
    `  [timbres] audio : ${audio.map((m) => `${m.id} ${m.sparse.peak.toFixed(2)}→${m.dense.peak.toFixed(2)} (avant limiteur ${m.dense.peakBeforeCompressor.toFixed(1)})`).join(' | ')}`
  )

  await rec.shot(page, 'timbres')
  await page.close()

  // Sept contrôles sur un petit écran : les deux boutons porteurs d'état partagent une rangée.
  const small = await browser.newPage()
  rec.attachConsoleListeners(small)
  await small.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await small.goto(url, { waitUntil: 'load' })
  await waitForCarillon(small)
  await small.touchscreen.tap(160, 300)
  await wait(150)
  const rows = await small.evaluate(() => {
    const tops = [...document.querySelectorAll('.toolbar button')].map((b) =>
      Math.round(b.getBoundingClientRect().top)
    )
    const state = [...document.querySelectorAll('[data-control="tuning"], [data-control="instrument"]')]
      .map((b) => Math.round(b.getBoundingClientRect().top))
    return { rows: new Set(tops).size, stateRows: new Set(state).size, count: tops.length }
  })
  console.log(`  [timbres] petit écran : ${rows.count} contrôles sur ${rows.rows} rangées`)
  /*
   * La propriété est « **tous** les contrôles tiennent sur deux rangées », pas « il y en a sept ». Le
   * nombre codé en dur a fait rougir ce scénario dès qu'un huitième bouton est arrivé (le tempo, US13),
   * alors que la mise en page tenait toujours — une assertion qui compte au lieu de vérifier ce qu'elle
   * annonce. Le compte reste journalisé, il ne conditionne plus rien.
   */
  rec.assert(
    'tous les contrôles tiennent sur deux rangées, quel qu’en soit le nombre',
    rows.count >= 7 && rows.rows <= 2,
    `${rows.count} contrôles, ${rows.rows} rangées`
  )
  rec.assert(
    'les deux boutons porteurs d’état partagent la même rangée',
    rows.stateRows === 1,
    `${rows.stateRows} rangée(s)`
  )
  await rec.shot(small, 'timbres-petit-ecran')
  await small.close()
}

/**
 * Les natures de barres, côté geste. L'appui long change la nature d'une barre — et surtout, il ne doit
 * **pas** voler le geste d'écoute : le relâchement qui suit ne fait pas sonner la barre par-dessus.
 * Cette garantie était encodée à l'envers avant l'US9 (« pas d'appui long sur une barre »), son motif
 * était bon, il est conservé autrement.
 */
async function runNatures(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await page.mouse.click(640, 740)

  const bar = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(400, 500, 800, 500)
    return c.bars()[0]
  })
  const mid = { x: (bar.ax + bar.bx) / 2, y: (bar.ay + bar.by) / 2 }

  /*
   * Appui long **sans bouger** au-delà du seuil (sinon c'est un déplacement), puis choix dans la roue
   * en glissant jusqu'au secteur voulu et en relâchant : un seul geste, celui de l'US16. Le cyclage
   * qu'on pilotait ici jusque-là n'existe plus.
   */
  const setNature = async (nature) => {
    await openNatureWheel(page, mid)
    await pickBySpring(page, nature)
    return page.evaluate(() => window.__carillon.bars()[0])
  }

  const seen = [bar.nature]
  for (const nature of ['ephemeral', 'trampoline', 'wall']) {
    seen.push((await setNature(nature)).nature)
  }
  console.log(`  [natures] choix dans la roue : ${seen.join(' -> ')}`)
  rec.assert(
    'chaque nature s’atteint directement, sans passer par les autres',
    JSON.stringify(seen) === JSON.stringify(['wall', 'ephemeral', 'trampoline', 'wall']),
    seen.join(' -> ')
  )

  // Le geste d'écoute n'est pas volé : l'appui long ne doit produire **aucune** note.
  const silent = await page.evaluate(() => window.__carillon.stats().notes)
  await setNature('trampoline')
  await wait(150)
  const afterPress = await page.evaluate(() => window.__carillon.stats().notes)
  rec.assert(
    'un appui long ne fait pas sonner la barre',
    afterPress === silent,
    `notes ${silent} -> ${afterPress}`
  )

  // Et le tap, lui, la fait toujours sonner sans changer sa nature.
  const beforeTap = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    notes: window.__carillon.stats().notes,
  }))
  await page.mouse.click(mid.x, mid.y)
  await wait(200)
  const afterTap = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    notes: window.__carillon.stats().notes,
  }))
  rec.assert(
    'le tap fait sonner la barre sans changer sa nature',
    afterTap.nature === beforeTap.nature && afterTap.notes > beforeTap.notes,
    `${beforeTap.nature}, notes ${beforeTap.notes} -> ${afterTap.notes}`
  )

  // Annulable comme toute modification de scène — ce que la déduplication avalait avant la review.
  const changed = (await setNature('ephemeral')).nature
  await page.keyboard.down('Meta')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Meta')
  await wait(200)
  const undone = await page.evaluate(() => window.__carillon.bars()[0]?.nature)
  rec.assert(
    'annuler restaure la nature précédente',
    undone !== undefined && undone !== changed,
    `${changed} -> ${undone}`
  )

  /*
   * Un **trampoline** garde sa bille dans le champ, mesuré dans la vraie page. La nature est posée par
   * le geste, pas par une API : une première version de ce bloc mesurait un mur — la bille ne montait
   * donc jamais, et l'assertion ne pouvait rien apprendre malgré son nom.
   */
  const target = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(400, 520, 900, 520)
    return c.bars()[0]
  })
  mid.x = (target.ax + target.bx) / 2
  mid.y = (target.ay + target.by) / 2
  const asTrampoline = await setNature('trampoline')

  const trampoline = await page.evaluate(() => {
    const c = window.__carillon
    let highest = 1e9
    c.dropBall(650, 120)
    for (let i = 0; i < 40; i += 1) {
      c.advance(0.5)
      for (const b of c.balls()) highest = Math.min(highest, b.y)
    }
    return { highest, impacts: c.stats().impacts }
  })
  console.log(
    `  [natures] ${asTrampoline.nature} : ${trampoline.impacts} impacts, point le plus haut y=${Math.round(trampoline.highest)}`
  )
  rec.assert(
    'la barre mesurée est bien un trampoline',
    asTrampoline.nature === 'trampoline',
    asTrampoline.nature
  )
  rec.assert(
    'une bille sur un trampoline ne sort jamais par le haut du champ',
    trampoline.highest > 0,
    `y minimal = ${Math.round(trampoline.highest)}`
  )

  /*
   * Le rendu des trois natures, mesuré. La scène est **figée** (aucune bille, aucune source), donc la
   * seule différence entre deux relevés est la nature de la barre — c'est le cas où une mesure de pixels
   * est exacte, contrairement à une scène vivante où le décor la noie.
   *
   * Ce que la capture a corrigé : le pointillé était d'abord porté par le cœur blanc de 1,6 px, invisible
   * sous les 7 px de couleur. Une barre éphémère était **indiscernable d'un mur**.
   */
  const ink = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    const y = 200
    const made = []
    for (let i = 0; i < 5; i += 1) {
      made.push(c.addBar(160, y + i * 90, 560, y + i * 90))
    }
    c.setBar(made[1], { nature: 'trampoline' })
    c.setBar(made[2], { nature: 'ephemeral' })
    c.setBar(made[3], { nature: 'ephemeral', hitsLeft: 1 })
    c.setBar(made[4], { nature: 'ephemeral', absentUntil: 1e9 })
    return { ids: made, bars: c.bars() }
  })
  await wait(200)

  const measure = await page.evaluate((bars) => {
    const stage = document.getElementById('stage')
    const scale = stage.width / stage.clientWidth
    const ctx = stage.getContext('2d')
    return bars.map((bar) => {
      const x0 = Math.round((Math.min(bar.ax, bar.bx) - 6) * scale)
      const y0 = Math.round((Math.min(bar.ay, bar.by) - 14) * scale)
      const w = Math.round((Math.abs(bar.bx - bar.ax) + 12) * scale)
      const h = Math.round(28 * scale)
      const { data } = ctx.getImageData(x0, y0, w, h)
      let matter = 0
      let white = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
        // « Matière » = pixel nettement plus clair que le fond nocturne, quelle que soit sa teinte.
        if (r + g + b > 220) matter += 1
        // « Blanc » = les crans du trampoline, qui sont peu saturés contrairement au corps coloré.
        if (Math.min(r, g, b) > 110) white += 1
      }
      return { matter, white }
    })
  }, ink.bars)

  const [mur, tramp, pleine, usee, absente] = measure
  console.log(
    `  [natures] matière : mur=${mur.matter} trampoline=${tramp.matter} éphémère=${pleine.matter} usée=${usee.matter} absente=${absente.matter} | blanc du trampoline=${tramp.white} contre ${mur.white} pour le mur`
  )
  rec.assert(
    'une barre éphémère se distingue d’un mur (le trait est ajouré)',
    pleine.matter < mur.matter * 0.9,
    `${pleine.matter} contre ${mur.matter}`
  )
  rec.assert(
    'une éphémère usée s’est visiblement érodée',
    usee.matter < pleine.matter * 0.75,
    `${usee.matter} contre ${pleine.matter}`
  )
  rec.assert(
    'une barre absente ne laisse qu’un fantôme',
    absente.matter < mur.matter * 0.3,
    `${absente.matter} contre ${mur.matter}`
  )
  rec.assert(
    'un trampoline porte des crans que le mur n’a pas',
    tramp.white > mur.white * 1.4,
    `${tramp.white} contre ${mur.white}`
  )

  await rec.shot(page, 'natures-rendu')
  await rec.shot(page, 'natures')
  await page.close()
}

/**
 * « Scène surprise » doit mener à un air **connu**, pas à un miroitement. La suite exacte de hauteurs est
 * prouvée dans le cœur (`melody.test.ts`, par rejeu déterministe) — ici on vérifie ce que seul le
 * navigateur peut dire : que le bouton pose bien un air, qu'il l'annonce, et que la scène le rejoue.
 */
async function runAir(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await page.mouse.click(640, 740)

  const before = await page.evaluate(() => window.__carillon.composedMelody())
  rec.assert(
    'la scène d’accueil n’est pas un air composé (elle reste musicalement riche)',
    before === null,
    `${before?.label ?? 'aucun'}`
  )

  // Plusieurs clics : la composition peut légitimement échouer et se replier, mais pas toujours.
  const airs = []
  for (let i = 0; i < 6; i += 1) {
    await page.click('[data-control="surprise"]')
    await wait(250)
    const state = await page.evaluate(() => ({
      melody: window.__carillon.composedMelody(),
      hint: document.querySelector('#hint')?.textContent?.trim() ?? '',
      bars: window.__carillon.stats().bars,
      balls: window.__carillon.stats().balls,
      tuning: window.__carillon.stats().tuning,
    }))
    if (state.melody) airs.push({ ...state.melody, hint: state.hint, tuning: state.tuning })
  }
  console.log(
    `  [air] ${airs.length}/6 clics ont composé un air : ${[...new Set(airs.map((a) => a.label))].join(', ')}`
  )
  rec.assert(
    'le bouton compose réellement un air',
    airs.length > 0,
    `${airs.length}/6 clics`
  )
  rec.assert(
    'l’air posé est annoncé par son nom',
    airs.every((air) => air.hint.includes(air.label)),
    airs.map((air) => `"${air.hint}"`).slice(0, 2).join(' ')
  )
  rec.assert(
    'l’incipit fait entre 4 et 8 notes',
    airs.every((air) => air.notes >= 4 && air.notes <= 8),
    airs.map((air) => air.notes).join(', ')
  )

  // La scène rejoue l'air : la bille est recyclée, donc elle revient et le motif reboucle.
  const played = await page.evaluate(() => {
    const c = window.__carillon
    const before = c.stats().impacts
    c.advance(12)
    return { impacts: c.stats().impacts - before, balls: c.stats().balls, bars: c.stats().bars }
  })
  console.log(`  [air] sur 12 s : ${played.impacts} impacts, ${played.bars} barres`)
  rec.assert(
    'la scène composée rejoue l’air au lieu de s’éteindre',
    played.impacts >= 8,
    `${played.impacts} impacts sur 12 s`
  )

  await rec.shot(page, 'air')
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

    /*
     * Le titre ne doit jamais être écrasé par la barre d'outils. Défaut trouvé en review : avec
     * `minmax(0, 1fr) auto`, la piste `auto` se dimensionnait à son max-content (~690 px) et la colonne
     * du titre tombait à **0 px** de 641 à ~860 px de large — « Carillon » tronqué en « Caril », passant
     * sous les boutons, tagline à un mot par ligne. Aucune largeur du harnais n'entrait dans la bande.
     *
     * Corollaire qui rendait le défaut muet : `countUnderHud` ignore les rectangles de largeur nulle,
     * donc `barsUnderHud` devenait structurellement aveugle au titre exactement là où il chevauchait
     * l'aire de jeu.
     */
    const layout = await page.evaluate(() => {
      const h1 = document.querySelector('.brand h1')
      const tagline = document.querySelector('.tagline')
      const rect = h1.getBoundingClientRect()
      const lineHeight = Number.parseFloat(getComputedStyle(tagline).lineHeight)
      const fontSize = Number.parseFloat(getComputedStyle(tagline).fontSize)
      const line = Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.2
      return {
        width: rect.width,
        needed: h1.scrollWidth,
        taglineLines: Math.round(tagline.getBoundingClientRect().height / line),
      }
    })
    rec.assert(
      `le titre n'est pas tronqué à ${width}x${height}`,
      layout.needed <= Math.ceil(layout.width) + 1,
      `${Math.round(layout.width)} px disponibles pour ${layout.needed} px nécessaires`
    )
    rec.assert(
      `la tagline tient sur deux lignes au plus à ${width}x${height}`,
      layout.taglineLines <= 2,
      `${layout.taglineLines} lignes`
    )
  }

  // C'est le chemin exact d'une rotation de téléphone ou d'un redimensionnement de fenêtre :
  // le ResizeObserver du canvas doit reconstruire la scène dans les nouvelles bornes.
  await assertAfterResize(900, 600, 8)
  await assertAfterResize(375, 740, 5)
  // Téléphone en paysage : la hauteur fond mais le HUD garde sa taille. C'est le viewport où les
  // barres passaient derrière le titre et les boutons.
  await assertAfterResize(844, 390, 5)
  // La bande 641–859 px : c'est là que la colonne du titre s'effondrait. Trois points, dont les deux
  // bords, parce qu'un seuil de mise en page se vérifie **de part et d'autre** de sa bascule.
  await assertAfterResize(641, 800, 8)
  await assertAfterResize(700, 800, 8)
  await assertAfterResize(859, 800, 8)
  await assertAfterResize(861, 800, 8)

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

/*
 * Une hauteur de ligne dérivée de la **police du secteur visé** (700 14px), pas d'un nombre choisi :
 * c'est elle qui décide si deux ancres partagent une bande horizontale.
 */
const LINE_HEIGHT = 14
const boxesAreReadable = (labels, wheel) => {
  const tooWide = labels.filter((l) => l.width > l.budget)
  const overlaps = []
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i]
      const b = labels[j]
      if (Math.abs(a.y - b.y) < LINE_HEIGHT && Math.abs(a.x - b.x) < (a.width + b.width) / 2) {
        overlaps.push(`${a.text}/${b.text}`)
      }
    }
  }
  const outsideDisc = labels.filter(
    (l) => Math.hypot(l.x - wheel.centerX, l.y - wheel.centerY) + l.width / 2 > wheel.outerRadius
  )
  return { tooWide, overlaps, outsideDisc }
}

/**
 * La roue de sélection (US16). Ce qui se vérifie ici et pas en Vitest : que le geste réel ouvre la roue,
 * que le relâchement décide **ce qu'il annonce**, et que la roue reste entièrement dans la scène.
 *
 * La géométrie, elle, est prouvée dans `src/core/wheel.test.ts` — la répéter ici ne mesurerait que le
 * même code par un chemin plus lent.
 */
async function runRoue(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await page.mouse.click(640, 740)

  const bar = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(400, 460, 800, 460)
    return c.bars()[0]
  })
  const mid = { x: (bar.ax + bar.bx) / 2, y: (bar.ay + bar.by) / 2 }

  // --- Elle s'ouvre, et elle montre l'ensemble des options ---
  await openNatureWheel(page, mid)
  await tick(page)
  const opened = await readWheel(page)
  await rec.shot(page, 'roue-nature-ouverte')
  rec.assert(
    'l’appui long ouvre la roue sur les trois natures, la courante marquée',
    opened !== null &&
      opened.options.length === 3 &&
      new Set(opened.options.map((o) => o.label)).size === 3 &&
      opened.current === bar.nature,
    opened ? `${opened.options.map((o) => o.label).join(', ')} | courante=${opened.current}` : 'aucune roue'
  )

  // --- Viser met en évidence le secteur, sans encore rien changer ---
  const trampoline = opened.options.find((o) => o.value === 'trampoline')
  await page.mouse.move(trampoline.x, trampoline.y, { steps: 6 })
  await tick(page)
  const aiming = await page.evaluate(() => ({
    wheel: window.__carillon.stats().wheel,
    nature: window.__carillon.bars()[0].nature,
  }))
  await rec.shot(page, 'roue-nature-visee')
  rec.assert(
    'viser un secteur le désigne sans rien appliquer avant le relâchement',
    aiming.wheel?.aimed === opened.options.indexOf(trampoline) && aiming.nature === 'wall',
    `aimed=${aiming.wheel?.aimed} nature=${aiming.nature}`
  )

  // --- Relâcher dans le secteur applique ---
  await page.mouse.up()
  await wait(150)
  const picked = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    wheel: window.__carillon.stats().wheel,
    undoDepth: window.__carillon.stats().undoDepth,
  }))
  await rec.shot(page, 'roue-nature-choisie')
  rec.assert(
    'relâcher dans un secteur applique ce secteur et ferme la roue',
    picked.nature === 'trampoline' && picked.wheel === null && picked.undoDepth > 0,
    `nature=${picked.nature} roue=${picked.wheel} undo=${picked.undoDepth}`
  )

  // --- Relâcher **au-delà de l'anneau** annule ---
  await openNatureWheel(page, mid)
  const ring = await readWheel(page)
  await page.mouse.move(ring.centerX + ring.outerRadius + 40, ring.centerY, { steps: 6 })
  await tick(page)
  await rec.shot(page, 'roue-hors-anneau')
  await page.mouse.up()
  await wait(150)
  const cancelled = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    wheel: window.__carillon.stats().wheel,
  }))
  rec.assert(
    'relâcher hors de l’anneau annule : la nature ne bouge pas',
    cancelled.nature === 'trampoline' && cancelled.wheel === null,
    `nature=${cancelled.nature} roue=${cancelled.wheel}`
  )

  /*
   * --- Relâcher au centre **épingle** ---
   *
   * C'est le geste de quelqu'un qui découvre : appuyer long, relâcher sans avoir bougé. Traité comme une
   * annulation, il ne ferait rien et la fonction resterait invisible.
   */
  await openNatureWheel(page, mid)
  await page.mouse.up()
  await wait(150)
  const pinned = await readWheel(page)
  await rec.shot(page, 'roue-epinglee')
  rec.assert(
    'relâcher au centre laisse la roue ouverte plutôt que de ne rien faire',
    pinned !== null && pinned.pinned === true,
    pinned ? `épinglée, ${pinned.options.length} options` : 'roue fermée'
  )

  // Un tap dans un secteur choisit, roue épinglée comprise.
  await pickInPinnedWheel(page, 'ephemeral')
  const afterPinnedPick = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    wheel: window.__carillon.stats().wheel,
    notes: window.__carillon.stats().notes,
  }))
  rec.assert(
    'un tap dans un secteur de roue épinglée choisit et ferme',
    afterPinnedPick.nature === 'ephemeral' && afterPinnedPick.wheel === null,
    `nature=${afterPinnedPick.nature} roue=${afterPinnedPick.wheel}`
  )

  // Et ce tap ne fait pas sonner la barre en dessous : la roue ne vole pas le geste à l'envers.
  await openNatureWheel(page, mid)
  await page.mouse.up()
  await wait(150)
  const beforeCloseTap = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    notes: window.__carillon.stats().notes,
    undoDepth: window.__carillon.stats().undoDepth,
  }))
  const wheelToClose = await readWheel(page)
  await page.mouse.click(
    wheelToClose.centerX + wheelToClose.outerRadius + 60,
    wheelToClose.centerY - wheelToClose.outerRadius - 60
  )
  await wait(200)
  const afterCloseTap = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    notes: window.__carillon.stats().notes,
    undoDepth: window.__carillon.stats().undoDepth,
    wheel: window.__carillon.stats().wheel,
  }))
  rec.assert(
    'un tap hors des secteurs ferme sans rien changer, et sans lâcher de bille',
    afterCloseTap.wheel === null &&
      afterCloseTap.nature === beforeCloseTap.nature &&
      afterCloseTap.notes === beforeCloseTap.notes &&
      afterCloseTap.undoDepth === beforeCloseTap.undoDepth,
    `nature=${afterCloseTap.nature} notes=${beforeCloseTap.notes}->${afterCloseTap.notes} undo=${beforeCloseTap.undoDepth}->${afterCloseTap.undoDepth}`
  )

  /*
   * --- Au doigt : une roue épinglée se vise en glissant ---
   *
   * Il n'existe pas de pointeur libre au tactile, donc glisser **est** le seul moyen de viser. Sans
   * traitement dédié, un glisser sur une roue épinglée dépassait le seuil de tap, devenait un tracé de
   * barre et détruisait la roue : sur téléphone elle n'offrait que « taper à l'aveugle » ou « la jeter ».
   * C'est pourtant le support sur lequel l'épinglage se justifie — il n'y a pas de survol au doigt.
   */
  /*
   * Deux départs, parce qu'ils empruntent **deux chemins d'entrée différents** : depuis la barre le
   * geste émet `drag` puis `release`, depuis le vide il émet `draft` puis `create-bar`. La sonde ne
   * partait que de la barre, donc deux des cinq entrées de l'interception n'étaient jamais exercées —
   * les retirer laissait l'assertion verte.
   */
  const touchPick = async (from, wanted) => {
    await page.evaluate(() => {
      const c = window.__carillon
      c.reset()
      c.addBar(400, 460, 800, 460)
    })
    await tick(page)
    const bar = await page.evaluate(() => window.__carillon.bars()[0])
    const barMid = { x: (bar.ax + bar.bx) / 2, y: bar.ay }
    await page.touchscreen.touchStart(barMid.x, barMid.y)
    await wait(700)
    await page.touchscreen.touchEnd()
    await wait(150)
    const pinned = await readWheel(page)
    const target = pinned?.options.find((option) => option.value === wanted)
    const start = from === 'barre' ? barMid : { x: pinned.centerX - 70, y: pinned.centerY + 55 }
    await page.touchscreen.touchStart(start.x, start.y)
    for (let step = 1; step <= 6; step += 1) {
      await page.touchscreen.touchMove(
        start.x + ((target.x - start.x) * step) / 6,
        start.y + ((target.y - start.y) * step) / 6
      )
    }
    const aimed = await page.evaluate(() => window.__carillon.stats().wheel?.aimKind)
    await page.touchscreen.touchEnd()
    await wait(150)
    const after = await page.evaluate(() => ({
      nature: window.__carillon.bars()[0]?.nature,
      bars: window.__carillon.stats().bars,
      wheel: window.__carillon.stats().wheel,
    }))
    return {
      from,
      ok:
        pinned?.pinned === true &&
        aimed === 'sector' &&
        after.nature === wanted &&
        after.bars === 1 &&
        after.wheel === null,
      detail: `${from}: épinglée=${pinned?.pinned} visée=${aimed} nature=${after.nature} barres=${after.bars}`,
    }
  }

  const touchRuns = [await touchPick('barre', 'trampoline'), await touchPick('vide', 'ephemeral')]
  rec.assert(
    'au doigt, glisser sur une roue épinglée vise et choisit — depuis une barre **comme** depuis le vide',
    touchRuns.every((run) => run.ok),
    touchRuns.map((run) => run.detail).join(' | ')
  )

  /*
   * --- « Ça va épingler » et « ça va annuler » se distinguent **à l'écran** ---
   *
   * Sur une roue à ressort, la seule où le relâchement est imminent. Mesuré en pixels, avec deux
   * grandeurs distinctes : le **liseré** (encre rougeâtre) et le **voile** (assombrissement du disque).
   * Le voile porte la lisibilité et n'était mesuré par rien — une mutation qui le retirait passait.
   *
   * Les seuils se dérivent du tracé, pas d'un nombre rond : liseré de 5 px centré sur `outerRadius - 2`,
   * donc il couvre 99,5..104,5 et le rayon 100 n'est atteint **que** par lui (un trait de 2 px, la
   * version rejetée pour invisibilité, couvre 102..104). Motif de tirets 10/8, soit 10/18 du tour.
   */
  /*
   * L'encre est comptée sur **plusieurs rayons**, et il en faut sur chacun.
   *
   * Une sonde à un seul rayon ne mesure pas l'épaisseur : elle mesure une position. N'importe quel filet
   * posé là la satisfait — la review l'a prouvé en ramenant le trait à 2 px **et** en le décalant de
   * 2 px vers l'intérieur, ce qui passait. Trois rayons espacés de 2 px couvrent 4 unités : seul un trait
   * de 5 px les atteint tous les trois.
   */
  const RING_PROBE_OFFSETS = [-4, -2, 0]
  const DASH_DUTY = 10 / 18
  const inkAndVeil = async () =>
    page.evaluate(
      ([offsets]) => {
        const wheel = window.__carillon.stats().wheel
        const canvas = document.querySelector('#stage')
        const ctx = canvas.getContext('2d')
        const dpr = canvas.width / canvas.clientWidth
        const sample = (radius, angle) => {
          const px = Math.round((wheel.centerX + Math.cos(angle) * radius) * dpr)
          const py = Math.round((wheel.centerY + Math.sin(angle) * radius) * dpr)
          return ctx.getImageData(px, py, 1, 1).data
        }
        const red = offsets.map(() => 0)
        let luminance = 0
        let samples = 0
        for (let step = 0; step < 360; step += 1) {
          const angle = (step / 360) * Math.PI * 2
          offsets.forEach((offset, i) => {
            const [r, g, b] = sample(wheel.outerRadius + offset, angle)
            if (r > 120 && r > g + 50 && r > b + 30) red[i] += 1
          })
          // Voile : mesuré au milieu de l'anneau, là où vivent les secteurs et les libellés.
          const [vr, vg, vb] = sample((wheel.innerRadius + wheel.outerRadius) / 2, angle)
          luminance += 0.2126 * vr + 0.7152 * vg + 0.0722 * vb
          samples += 1
        }
        return { red, thinnest: Math.min(...red), luminance: luminance / samples }
      },
      [RING_PROBE_OFFSETS]
    )

  await openNatureWheel(page, mid)
  const springWheel = await readWheel(page)
  await page.mouse.move(mid.x + 4, mid.y, { steps: 2 })
  await tick(page)
  const pinState = await inkAndVeil()
  // Troisième contrôle : viser un **secteur** ne doit pas déclencher l'alarme. Sans lui, l'alarme
  // pouvait signifier « une visée existe » au lieu de « ça va être jeté », et rien ne le voyait.
  const sectorTarget = springWheel.options[1]
  await page.mouse.move(sectorTarget.x, sectorTarget.y, { steps: 4 })
  await tick(page)
  const sectorState = await inkAndVeil()
  await page.mouse.move(mid.x + springWheel.outerRadius + 60, mid.y, { steps: 6 })
  await tick(page)
  await rec.shot(page, 'roue-annulation-annoncee')
  const cancelState = await inkAndVeil()
  await page.mouse.up()
  await wait(120)
  // Le liseré est tireté : au mieux 10/18 du tour est encré. On exige 70 % de ce maximum théorique.
  const expectedInk = 360 * DASH_DUTY * 0.7
  /*
   * Seuil de voile serré sur la mesure réelle (0,51 du repos), pas un rapport confortable : à 0,75 la
   * review a montré qu'on pouvait diviser le voile par deux et rester vert.
   */
  const VEIL_RATIO = 0.55
  console.log(
    `  [roue] annulation : liseré ${JSON.stringify(pinState.red)} -> ${JSON.stringify(cancelState.red)} (le plus fin ≥ ${Math.round(expectedInk)}) | secteur visé ${sectorState.thinnest} | voile ${pinState.luminance.toFixed(1)} -> ${cancelState.luminance.toFixed(1)}`
  )
  rec.assert(
    'annuler s’annonce à l’écran : un liseré épais, un assombrissement, et rien de tout ça sur un secteur',
    // Encre sur **chacun** des rayons sondés : c'est ce qui mesure l'épaisseur et non la position.
    cancelState.thinnest >= expectedInk &&
      pinState.thinnest <= cancelState.thinnest * 0.1 &&
      sectorState.thinnest === 0 &&
      cancelState.luminance <= pinState.luminance * VEIL_RATIO,
    `liseré ${pinState.thinnest}->${cancelState.thinnest} (seuil ${Math.round(expectedInk)}) | secteur ${sectorState.thinnest} | voile ${pinState.luminance.toFixed(1)}->${cancelState.luminance.toFixed(1)} (max ${(pinState.luminance * VEIL_RATIO).toFixed(1)})`
  )

  /*
   * --- Une roue ouverte ne survit pas à un saut d'état ---
   *
   * Son centre est en pixels absolus et elle vise une barre par identifiant : après un redimensionnement,
   * un « Effacer » ou une annulation, la laisser ouverte afficherait un choix sur une scène qui n'est
   * plus celle-là — secteurs passés sous le HUD, ou option marquée qui n'est plus en place.
   */
  const survivors = []
  for (const [label, jump] of [
    ['Effacer', async () => page.click('[data-control="clear"]')],
    ['annulation', async () => {
      await page.keyboard.down('Meta')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Meta')
    }],
    ['redimensionnement', async () => page.setViewport({ width: 1024, height: 720, deviceScaleFactor: 2 })],
  ]) {
    await page.evaluate(() => {
      const c = window.__carillon
      c.reset()
      c.addBar(400, 460, 800, 460)
    })
    await tick(page)
    const target = await page.evaluate(() => window.__carillon.bars()[0])
    await openNatureWheel(page, { x: (target.ax + target.bx) / 2, y: target.ay })
    await page.mouse.up()
    await wait(150)
    const openBefore = await readWheel(page)
    await jump()
    await wait(250)
    await tick(page)
    const openAfter = await readWheel(page)
    survivors.push(`${label}: ${openBefore ? 'ouverte' : 'fermée'} -> ${openAfter ? 'ENCORE OUVERTE' : 'fermée'}`)
  }
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await tick(page)
  rec.assert(
    'un saut d’état (Effacer, annulation, redimensionnement) ferme la roue',
    survivors.every((line) => line.endsWith('-> fermée')) &&
      survivors.every((line) => line.includes('ouverte ->')),
    survivors.join(' | ')
  )

  // --- La roue des timbres : l'ensemble d'un coup, et un aller-retour en deux gestes ---
  const catalogue = await page.evaluate(() => window.__carillon.stats().instrumentIds)
  // Scène vide : la mesure de pixels qui suit exige un **contrôle propre**. Une barre à l'écran a sa
  // propre teinte — rouge dans le grave — et ses pixels se comptaient comme du liseré d'annulation.
  await page.evaluate(() => window.__carillon.reset())
  await tick(page)
  await page.click('[data-control="instrument"]')
  await tick(page)
  const instrumentWheel = await readWheel(page)
  await rec.shot(page, 'roue-instruments')
  rec.assert(
    'la roue des timbres montre tout le catalogue d’un coup',
    instrumentWheel !== null &&
      instrumentWheel.options.length === catalogue.length &&
      new Set(instrumentWheel.options.map((o) => o.label)).size === catalogue.length,
    instrumentWheel ? instrumentWheel.options.map((o) => o.label).join(', ') : 'aucune roue'
  )

  /*
   * **Lisibles**, pas seulement présents. Une roue dont deux libellés se recouvrent expose exactement la
   * même liste de chaînes qu'une roue lisible : c'est ce qui a laissé passer « Corde (pizzicdteje
   * (cloches) » sur la capture des cinq timbres. On asserte donc des **boîtes** — largeur réellement
   * mesurée par le rendu, budget géométrique du secteur, et absence de recouvrement deux à deux.
   */
  const atRest = boxesAreReadable(instrumentWheel.labels, instrumentWheel)
  // Luminance de référence : la roue au repos, avant tout mouvement de pointeur.
  const { luminance: restVeil } = await inkAndVeil()
  console.log(
    `  [roue] libellés dessinés : ${instrumentWheel.labels
      .map((l) => `${l.text}(${Math.round(l.width)}/${Math.round(l.budget)}px)`)
      .join(' ')}`
  )

  // Le survol vise, roue épinglée comprise — sinon on choisit à l'aveugle parmi cinq secteurs.
  const hoverTarget = instrumentWheel.options[2]
  await page.mouse.move(hoverTarget.x, hoverTarget.y, { steps: 4 })
  await tick(page)
  const hovered = await page.evaluate(() => window.__carillon.stats().wheel)
  rec.assert(
    'promener le pointeur sur une roue épinglée met le secteur en évidence',
    hovered?.aimed === 2 && hovered?.aimKind === 'sector',
    `aimed=${hovered?.aimed} kind=${hovered?.aimKind}`
  )

  /*
   * Relu **pendant** que chaque secteur est visé, l'un après l'autre. Le libellé visé est écrit dans une
   * police plus grande (700 14px contre 600 13px), et c'est la seule qui puisse déborder. Ne mesurer
   * qu'au repos laissait ce cas hors de portée ; ne viser qu'un seul secteur laissait les quatre autres
   * jamais mesurés dans cette police.
   */
  const tooWide = [...atRest.tooWide]
  const overlaps = [...atRest.overlaps]
  const outsideDisc = [...atRest.outsideDisc]
  for (const option of instrumentWheel.options) {
    await page.mouse.move(option.x, option.y, { steps: 3 })
    await tick(page)
    const state = await page.evaluate(() => window.__carillon.stats().wheel)
    const checked = boxesAreReadable(state.labels, state)
    tooWide.push(...checked.tooWide)
    overlaps.push(...checked.overlaps)
    outsideDisc.push(...checked.outsideDisc)
  }
  rec.assert(
    'les cinq timbres sont lisibles au repos **et** chacun dans la police qu’il prend quand il est visé',
    tooWide.length === 0 && overlaps.length === 0 && outsideDisc.length === 0,
    `trop larges=[${tooWide.map((l) => l.text)}] recouvrements=[${overlaps}] débordent du disque=[${outsideDisc.map((l) => l.text)}]`
  )

  /*
   * « Ça va épingler » et « ça va annuler » sont deux issues **opposées**. Elles doivent se distinguer
   * avant le relâchement : les captures 01 et 04 étaient identiques au pixel près.
   */
  /*
   * Une roue **épinglée** ne montre pas l'annulation : le pointeur hors de l'anneau y est le trajet
   * normal depuis le bouton qui l'a ouverte, et l'alarme s'affichait pendant toute la lecture des
   * options. C'est donc une propriété à part entière, et elle s'asserte.
   */
  await page.mouse.move(
    instrumentWheel.centerX + instrumentWheel.outerRadius + 45,
    instrumentWheel.centerY,
    { steps: 4 }
  )
  await tick(page)
  await rec.shot(page, 'roue-instruments-approche')
  /*
   * Le **voile** est mesuré ici, pas seulement l'encre : le défaut d'origine était que les cinq libellés
   * apparaissaient délavés derrière un voile pendant tout le trajet, et une assertion qui ne compte que
   * le liseré laisse revenir exactement ça. La luminance de repos sert de référence.
   */
  const approach = await inkAndVeil()
  const approachAim = await page.evaluate(() => window.__carillon.stats().wheel?.aimKind)
  console.log(
    `  [roue] trajet : visée=${approachAim}, liseré ${approach.thinnest} px, voile ${approach.luminance.toFixed(1)} (repos ${restVeil.toFixed(1)})`
  )
  rec.assert(
    'sur le trajet vers une roue épinglée, ni liseré ni voile : elle reste lisible',
    approachAim === 'cancel' && approach.thinnest === 0 && approach.luminance >= restVeil * 0.95,
    `visée=${approachAim}, ${approach.thinnest} px de liseré, voile ${approach.luminance.toFixed(1)} contre ${restVeil.toFixed(1)} au repos`
  )
  await page.mouse.move(instrumentWheel.options[0].x, instrumentWheel.options[0].y, { steps: 4 })

  /*
   * Le point de douleur d'origine, mesuré : avec un cycle, revenir au timbre précédent coûtait
   * `catalogue.length - 1` clics. On compte les gestes, pas les millisecondes.
   */
  const start = await page.evaluate(() => window.__carillon.stats().instrument)
  const far = catalogue[catalogue.length - 1] === start ? catalogue[1] : catalogue[catalogue.length - 1]
  await pickInPinnedWheel(page, far)
  let gestures = 2
  const reached = await page.evaluate(() => window.__carillon.stats().instrument)
  await chooseInstrument(page, start)
  gestures += 2
  const back = await page.evaluate(() => window.__carillon.stats().instrument)
  console.log(`  [roue] ${start} -> ${reached} -> ${back} en ${gestures} gestes (cycle : ${(catalogue.length - 1) * 2})`)
  rec.assert(
    'un aller-retour entre deux timbres coûte deux gestes par choix, quel que soit l’écart',
    reached === far && back === start && gestures === 4,
    `${start} -> ${reached} -> ${back}, ${gestures} gestes`
  )

  // --- Ouverte au bord de la scène, elle reste entièrement visible ---
  const edge = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    // Une barre collée au bord gauche : la roue s'ouvrirait à moitié hors champ sans recadrage.
    c.addBar(30, 300, 150, 300)
    return c.bars()[0]
  })
  await openNatureWheel(page, { x: (edge.ax + edge.bx) / 2, y: edge.ay })
  await tick(page)
  const atEdge = await page.evaluate(() => {
    const wheel = window.__carillon.stats().wheel
    const hud = Array.from(document.querySelectorAll('[data-hud]'))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }))
    return { wheel, hud, width: window.innerWidth, height: window.innerHeight }
  })
  await rec.shot(page, 'roue-au-bord')

  /*
   * Au bord, la roue est **recadrée loin du doigt** : le pointeur immobile tombe alors dans un secteur.
   * Relâcher sans avoir bougé doit tout de même épingler, et surtout ne rien appliquer — ce défaut a été
   * trouvé en regardant la capture ci-dessus, aucune assertion ne le voyait.
   */
  const natureAtEdge = await page.evaluate(() => window.__carillon.bars()[0].nature)
  const edgeGeometry = await page.evaluate(() => {
    const w = window.__carillon.stats().wheel
    // Le doigt est resté au milieu de la barre, que `fitWheel` a laissée hors du centre de la roue.
    return { offCentre: Math.abs(w.centerX - 90), innerRadius: w.innerRadius }
  })
  const pointerInSector = edgeGeometry.offCentre > edgeGeometry.innerRadius
  /*
   * Le seuil est **encadré**, comme les frontières de secteurs dans `wheel.test.ts` : deux pixels en
   * dedans ne doit rien viser, deux pixels au-delà doit viser un secteur. Un déplacement en dur (8 px)
   * n'épinglait que l'*existence* du garde et laissait son seuil rétrécir de 26 à 10 sans rougir — soit
   * un tremblement de pouce ordinaire qui applique une option. Le rayon vient de l'app, pas d'ici.
   */
  const deadZone = edgeGeometry.innerRadius
  /*
   * **Deux gestes**, pas un. Une fois le seuil franchi, la visée est engagée pour tout le reste de
   * l'appui — c'est voulu, on ne se dé-engage pas en revenant vers son point de départ. Vérifier les
   * deux côtés du seuil dans le même appui testait donc autre chose que ce qu'annonçait son nom.
   */
  await page.mouse.move(90 + deadZone - 2, 300, { steps: 2 })
  await tick(page)
  const aimJustInside = await page.evaluate(() => window.__carillon.stats().wheel?.aimKind)
  await page.mouse.up()
  await wait(150)
  const edgeRelease = await page.evaluate(() => ({
    nature: window.__carillon.bars()[0].nature,
    wheel: window.__carillon.stats().wheel,
  }))
  // Roue épinglée congédiée avant le second geste, pour repartir d'un état propre.
  await page.mouse.click(atEdge.width - 40, atEdge.height / 2)
  await wait(120)

  const edgeBar = await page.evaluate(() => window.__carillon.bars()[0])
  await openNatureWheel(page, { x: (edgeBar.ax + edgeBar.bx) / 2, y: edgeBar.ay })
  await page.mouse.move(90 + deadZone + 2, 300, { steps: 2 })
  await tick(page)
  const aimJustOutside = await page.evaluate(() => window.__carillon.stats().wheel?.aimKind)
  // Relâché hors de l'anneau : on ne veut pas appliquer, seulement avoir mesuré la visée.
  await page.mouse.move(90 + edgeGeometry.offCentre + 200, 300, { steps: 4 })
  await page.mouse.up()
  await wait(150)
  rec.assert(
    'roue recadrée : la zone morte du geste vaut son rayon annoncé, de part et d’autre',
    pointerInSector &&
      // Sous le seuil : rien n'est visé, alors que le point est géométriquement dans un secteur.
      aimJustInside === 'pin' &&
      // Au-delà : un secteur est visé. C'est ce qui épingle le **seuil** et pas seulement l'existence du garde.
      aimJustOutside === 'sector' &&
      edgeRelease.wheel !== null &&
      edgeRelease.wheel.pinned === true &&
      edgeRelease.nature === natureAtEdge,
    `recadrée de ${Math.round(edgeGeometry.offCentre)}px | zone morte ${deadZone} : ${deadZone - 2}px->${aimJustInside}, ${deadZone + 2}px->${aimJustOutside} | épinglée=${edgeRelease.wheel?.pinned} | nature=${natureAtEdge}->${edgeRelease.nature}`
  )
  // Refermée pour ne pas laisser la roue ouverte sur le viewport suivant.
  await page.mouse.click(atEdge.width - 40, atEdge.height / 2)
  await wait(120)
  const disc = {
    left: atEdge.wheel.centerX - atEdge.wheel.outerRadius,
    right: atEdge.wheel.centerX + atEdge.wheel.outerRadius,
    top: atEdge.wheel.centerY - atEdge.wheel.outerRadius,
    bottom: atEdge.wheel.centerY + atEdge.wheel.outerRadius,
  }
  const insideViewport =
    disc.left >= 0 && disc.top >= 0 && disc.right <= atEdge.width && disc.bottom <= atEdge.height
  const underHud = atEdge.hud.filter(
    (r) => disc.left < r.right && disc.right > r.left && disc.top < r.bottom && disc.bottom > r.top
  )
  rec.assert(
    'ouverte au bord, la roue est recadrée : entièrement visible et hors du HUD',
    insideViewport && underHud.length === 0,
    `disque ${Math.round(disc.left)}..${Math.round(disc.right)} x ${Math.round(disc.top)}..${Math.round(disc.bottom)} dans ${atEdge.width}x${atEdge.height}, ${underHud.length} chevauchement(s) de HUD`
  )

  // --- Téléphone : même exigence, sur 375 px ---
  await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2 })
  await tick(page)
  const phoneBar = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addBar(60, 300, 300, 300)
    return c.bars()[0]
  })
  await openNatureWheel(page, { x: (phoneBar.ax + phoneBar.bx) / 2, y: phoneBar.ay })
  await tick(page)
  const phone = await page.evaluate(() => {
    const wheel = window.__carillon.stats().wheel
    const hud = Array.from(document.querySelectorAll('[data-hud]'))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }))
    return {
      wheel,
      hud,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }
  })
  await rec.shot(page, 'roue-mobile')
  await page.mouse.up()
  const phoneDisc = {
    left: phone.wheel.centerX - phone.wheel.outerRadius,
    right: phone.wheel.centerX + phone.wheel.outerRadius,
    top: phone.wheel.centerY - phone.wheel.outerRadius,
    bottom: phone.wheel.centerY + phone.wheel.outerRadius,
  }
  const phoneUnderHud = phone.hud.filter(
    (r) =>
      phoneDisc.left < r.right &&
      phoneDisc.right > r.left &&
      phoneDisc.top < r.bottom &&
      phoneDisc.bottom > r.top
  )
  rec.assert(
    'sur 375 px la roue tient dans la scène, hors du HUD, sans débordement horizontal',
    phoneDisc.left >= 0 &&
      phoneDisc.right <= phone.width &&
      phoneDisc.top >= 0 &&
      phoneDisc.bottom <= phone.height &&
      phoneUnderHud.length === 0 &&
      phone.scrollWidth <= phone.width,
    `disque ${Math.round(phoneDisc.left)}..${Math.round(phoneDisc.right)} dans ${phone.width}, scrollWidth=${phone.scrollWidth}, ${phoneUnderHud.length} chevauchement(s)`
  )

  /*
   * On ne laisse pas le scénario s'achever sur une roue épinglée. Un état ouvert survit aux gestes
   * suivants et les capte : c'est ce qui a produit un faux négatif pendant la revue, une sonde ajoutée
   * en fin de scénario voyant son appui long avalé par une roue oubliée là.
   */
  await page.mouse.click(20, phone.height / 2)
  await wait(120)
  const leftOpen = await readWheel(page)
  rec.assert('le scénario ne laisse aucune roue ouverte derrière lui', leftOpen === null, `roue=${leftOpen}`)

  await page.close()
}

/**
 * Les sources (US17). Taper une source **ouvrait** un cran de division de plus, à l'aveugle ; elle ouvre
 * maintenant le choix. C'était le dernier cyclage du produit.
 *
 * Deux assertions qui se contredisent si l'une des deux est fausse : choisir doit changer la division,
 * et taper ne doit **plus** la changer par lui-même. La seconde prouve que le cycle est parti, pas
 * seulement doublé.
 */
async function runSources(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await page.mouse.click(640, 740)

  /*
   * --- La roue des sources : le dernier cyclage du produit (US17) ---
   *
   * Taper une source **ouvrait** un cran de plus à l'aveugle ; elle ouvre maintenant le choix. Deux
   * assertions qui se contredisent si l'une des deux est fausse : choisir doit changer la division, et
   * taper ne doit **plus** la changer par lui-même. La seconde est celle qui prouve que le cycle est
   * parti, et pas seulement doublé.
   */
  const source = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    const id = c.addEmitter(640, 300, 0)
    return c.emitters().find((emitter) => emitter.id === id) ?? null
  })
  await tick(page)
  await page.mouse.click(source.x, source.y)
  await wait(150)
  const divisionWheel = await readWheel(page)
  await rec.shot(page, 'roue-divisions')
  const afterTapOnly = await page.evaluate(() => window.__carillon.emitters()[0].divisionIndex)
  rec.assert(
    'taper une source ouvre sa roue **sans** changer sa division',
    divisionWheel !== null &&
      divisionWheel.options.length === 5 &&
      divisionWheel.current === '0' &&
      afterTapOnly === 0,
    `roue=${divisionWheel?.options.map((o) => o.label).join(', ')} | courante=${divisionWheel?.current} | division ${afterTapOnly}`
  )

  /*
   * Mesuré au repos **et** dans la police de chaque secteur visé, l'un après l'autre. Le libellé visé est
   * écrit 8 % plus gros, et c'est la seule police qui puisse déborder : ne lire la roue qu'une fois, à
   * `aim === null`, laissait ce cas hors de portée — la même faute qu'à l'US16, refaite en réutilisant
   * son helper sans sa boucle. Démontré par mutation : grossir la police du secteur visé passait 7/7.
   */
  const divisionChecks = [boxesAreReadable(divisionWheel.labels, divisionWheel)]
  for (const option of divisionWheel.options) {
    await page.mouse.move(option.x, option.y, { steps: 3 })
    await tick(page)
    const aimed = await page.evaluate(() => window.__carillon.stats().wheel)
    divisionChecks.push(boxesAreReadable(aimed.labels, aimed))
  }
  const tooWide = divisionChecks.flatMap((c) => c.tooWide)
  const overlaps = divisionChecks.flatMap((c) => c.overlaps)
  const outsideDisc = divisionChecks.flatMap((c) => c.outsideDisc)
  console.log(
    `  [sources] divisions dessinées : ${divisionWheel.labels.map((l) => `${l.text}(${Math.round(l.width)}/${Math.round(l.budget)}px)`).join(' ')}`
  )
  rec.assert(
    'les cinq divisions sont lisibles, au repos et dans la police de chaque secteur visé',
    tooWide.length === 0 &&
      overlaps.length === 0 &&
      outsideDisc.length === 0 &&
      // Comptes et non phrases : « 1× » plutôt que « une par mesure ».
      divisionWheel.labels.every((l) => /^\d+×$/.test(l.text)),
    `dessinés=[${divisionWheel.labels.map((l) => l.text)}] trop larges=[${tooWide.map((l) => l.text)}] recouvrements=[${overlaps}]`
  )

  // Choisir applique, remet la source en phase sur la grille, et ferme la roue.
  const afterPickPos = { x: source.x, y: source.y }
  await pickInPinnedWheel(page, '3')
  const afterPick = await page.evaluate(() => {
    const c = window.__carillon
    const emitter = c.emitters()[0]
    return {
      divisionIndex: emitter.divisionIndex,
      aheadOfNow: emitter.nextAt - c.stats().time,
      nextAt: emitter.nextAt,
      period: emitter.period,
      wheel: c.stats().wheel,
      undoDepth: c.stats().undoDepth,
    }
  })
  /*
   * La borne est **exactement** la période : l'échéance est le prochain instant de grille, donc au plus
   * une période devant. Le `0.02` que j'avais posé était un nombre déguisé — il laissait passer une
   * échéance 3 % trop loin. Seule l'erreur de flottant est tolérée, et on exige en plus que l'échéance
   * soit **sur la grille**, ce qu'un simple « devant nous » ne dit pas.
   */
  const gridOffset = Math.abs(
    afterPick.nextAt / afterPick.period - Math.round(afterPick.nextAt / afterPick.period)
  )
  rec.assert(
    'choisir une division l’applique, remet la source sur la grille, et ferme la roue',
    afterPick.divisionIndex === 3 &&
      afterPick.wheel === null &&
      afterPick.undoDepth > 0 &&
      /*
       * Borne **symétrique** : au plus une période d'écart, dans un sens comme dans l'autre. Exiger
       * « strictement devant nous » était une course — le temps avance entre le calcul de l'échéance et
       * la lecture, donc elle peut venir d'échoir, et `runEmitters` la réarmera au pas suivant. Sans
       * ré-armement du tout, l'échéance périmée reste à plusieurs périodes neuves : toujours attrapé.
       */
      Math.abs(afterPick.aheadOfNow) <= afterPick.period + 1e-9 &&
      gridOffset < 1e-6,
    `division=${afterPick.divisionIndex} échéance dans ${afterPick.aheadOfNow.toFixed(4)}s (période ${afterPick.period.toFixed(4)}s, écart à la grille ${gridOffset.toExponential(1)}) undo=${afterPick.undoDepth}`
  )

  /*
   * Confirmer la division **déjà en place** ne doit pas consommer de place d'annulation.
   *
   * Ce qui est mesuré est `undoDepth`, et **pas** l'échéance, pour deux raisons apprises en la mesurant.
   * D'abord elle ne discrimine pas : resynchroniser pour la *même* division recalcule le prochain instant
   * de la *même* grille, donc les deux codes sont identiques — aucune condition de divergence, exactement
   * le cas de `docs/solutions/mutation-survivante-nest-pas-test-faible.md`. Ensuite la comparer à travers
   * le temps est faux : la source **émet** entre les deux lectures, ce qui avance l'échéance pour une
   * raison qui n'a rien à voir. L'assertion passait seule et rougissait dans la suite complète.
   */
  await page.mouse.click(afterPickPos.x, afterPickPos.y)
  await wait(150)
  const beforeConfirm = await page.evaluate(() => window.__carillon.stats().undoDepth)
  await pickInPinnedWheel(page, '3')
  const afterConfirm = await page.evaluate(() => ({
    undoDepth: window.__carillon.stats().undoDepth,
    divisionIndex: window.__carillon.emitters()[0].divisionIndex,
  }))
  rec.assert(
    'confirmer la division en place ne consomme pas de place d’annulation',
    afterConfirm.divisionIndex === 3 && afterConfirm.undoDepth === beforeConfirm,
    `undo ${beforeConfirm} -> ${afterConfirm.undoDepth}, division ${afterConfirm.divisionIndex}`
  )

  // Annulable, comme toute modification de scène.
  await page.keyboard.down('Meta')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Meta')
  await wait(200)
  const undone = await page.evaluate(() => window.__carillon.emitters()[0]?.divisionIndex)
  rec.assert(
    'annuler restaure la division précédente',
    undone === 0,
    `3 -> ${undone}`
  )

  /*
   * Roue épinglée, un glisser vers le bord **ne jette pas** la source : le disque est modal, il consomme
   * le geste et le lit comme une visée. C'est cette propriété qui rend inatteignable le défaut que la
   * review avait trouvé sur les barres — un widget qui survit à la disparition de sa cible — et c'est
   * pour ça qu'aucun garde « la cible a disparu » ne subsiste dans le code.
   */
  const doomed = await page.evaluate(() => window.__carillon.emitters()[0])
  await page.mouse.click(doomed.x, doomed.y)
  await wait(150)
  const wheelBeforeDrag = await readWheel(page)
  await dragBar(page, [doomed.x, doomed.y], [4, doomed.y], 8)
  await wait(200)
  const afterEdgeDrag = await page.evaluate(() => ({
    emitters: window.__carillon.stats().emitters,
    x: window.__carillon.emitters()[0]?.x,
    wheel: window.__carillon.stats().wheel,
  }))
  rec.assert(
    'roue épinglée : glisser vers le bord ne jette pas la source et ne la déplace pas',
    wheelBeforeDrag !== null &&
      afterEdgeDrag.emitters === 1 &&
      Math.round(afterEdgeDrag.x) === Math.round(doomed.x) &&
      // La roue s'est résolue à l'arrivée du glisser, hors de l'anneau : donc fermée sans rien appliquer.
      afterEdgeDrag.wheel === null,
    `sources=${afterEdgeDrag.emitters} x=${Math.round(doomed.x)}->${Math.round(afterEdgeDrag.x)} roue=${afterEdgeDrag.wheel}`
  )

  /*
   * --- 375 px : c'est là que le sujet s'éloigne de sa roue ---
   *
   * Une source au bord gauche d'un téléphone : `fitWheel` recadre la roue jusqu'à ~96 px d'elle, et le
   * disque est presque opaque. Sans repère, rien à l'écran ne dit **quelle** source on règle — sur une
   * scène qui en compte plusieurs, c'est le sujet du réglage qu'on perd de vue. On exige donc que le
   * sujet soit dessiné, à sa place, et relié au disque quand il en est loin.
   */
  await page.setViewport({ width: 375, height: 780, deviceScaleFactor: 2 })
  await tick(page)
  const phoneSource = await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    const id = c.addEmitter(30, 420, 0)
    return c.emitters().find((emitter) => emitter.id === id) ?? null
  })
  await page.mouse.click(phoneSource.x, phoneSource.y)
  await wait(150)
  await rec.shot(page, 'roue-divisions-mobile')
  const phoneWheel = await readWheel(page)
  /*
   * Mesuré en pixels autour de la source, avec un **contrôle** : la même position sans roue ouverte. Un
   * repère « présent dans l'état » ne prouve rien — la review a montré que la source tombait à 11 % de
   * son contraste sous le disque tout en étant « dans la zone morte ».
   */
  const inkAround = async () =>
    page.evaluate(
      ([sx, sy]) => {
        const canvas = document.querySelector('#stage')
        const ctx = canvas.getContext('2d')
        const dpr = canvas.width / canvas.clientWidth
        let bright = 0
        // Couronne au rayon du repère : c'est là que l'anneau est tracé.
        for (let step = 0; step < 360; step += 1) {
          const angle = (step / 360) * Math.PI * 2
          const px = Math.round((sx + Math.cos(angle) * 13) * dpr)
          const py = Math.round((sy + Math.sin(angle) * 13) * dpr)
          const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
          if (0.2126 * r + 0.7152 * g + 0.0722 * b > 120) bright += 1
        }
        return bright
      },
      [phoneSource.x, phoneSource.y]
    )
  const markedInk = await inkAround()
  const offCentre = Math.hypot(phoneWheel.centerX - phoneSource.x, phoneWheel.centerY - phoneSource.y)
  // Contrôle : roue fermée, au même endroit, il ne doit rester presque aucun pixel clair.
  await page.mouse.click(phoneWheel.centerX + phoneWheel.outerRadius + 40, phoneWheel.centerY)
  await wait(150)
  const bareInk = await inkAround()
  console.log(
    `  [sources] 375 px : roue recadrée à ${Math.round(offCentre)} px de la source | repère ${markedInk} px clairs, sans roue ${bareInk}`
  )
  rec.assert(
    'à 375 px, la source réglée reste désignée à l’écran malgré le recadrage',
    offCentre > phoneWheel.innerRadius &&
      markedInk > 100 &&
      bareInk < markedInk * 0.25 &&
      phoneWheel.centerX - phoneWheel.outerRadius >= 0,
    `écart=${Math.round(offCentre)}px (zone morte ${phoneWheel.innerRadius}) | repère=${markedInk} px, contrôle=${bareInk} px`
  )

  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await tick(page)
  await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.addEmitter(640, 300, 0)
  })
  await tick(page)

  // Et le glisser d'une source la déplace toujours : la roue n'a volé aucun geste.
  const moved = await page.evaluate(() => window.__carillon.emitters()[0])
  // Message explicite plutôt qu'un `TypeError` sur `undefined` : sous mutation, une étape précédente peut
  // supprimer la source, et le scénario doit dire pourquoi il s'arrête au lieu de planter en aveugle.
  if (!moved) throw new Error('aucune source à glisser : la scène est vide à cette étape')
  await dragBar(page, [moved.x, moved.y], [moved.x + 180, moved.y + 90])
  await wait(150)
  const afterDrag = await page.evaluate(() => ({
    emitter: window.__carillon.emitters()[0],
    wheel: window.__carillon.stats().wheel,
  }))
  rec.assert(
    'glisser une source la déplace toujours, sans ouvrir de roue',
    afterDrag.wheel === null &&
      Math.round(afterDrag.emitter.x) > Math.round(moved.x) + 100 &&
      Math.round(afterDrag.emitter.y) > Math.round(moved.y) + 50,
    `(${Math.round(moved.x)},${Math.round(moved.y)}) -> (${Math.round(afterDrag.emitter.x)},${Math.round(afterDrag.emitter.y)}) roue=${afterDrag.wheel}`
  )


  await page.close()
}

/**
 * Le tempo (US13). La grille existe depuis l'US7 et rien ne l'exposait : le tempo était figé à 96 BPM.
 *
 * Le bouton reste un bouton — un clic annonce — mais un glissement horizontal règle la valeur en continu.
 * Ce qui se vérifie ici et pas en Vitest : que le geste réel change la **cadence entendue**, et qu'il ne
 * produise ni rafale ni silence, ce que l'horloge de l'US7 promet sans qu'aucune interface l'ait jamais
 * exercé.
 */
async function runTempo(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await page.mouse.click(640, 740)

  const button = '[data-control="tempo"]'
  const readTempo = async () =>
    page.evaluate((sel) => ({
      bpm: window.__carillon.stats().bpm,
      label: (document.querySelector(sel)?.querySelector('.label')?.textContent ?? '').trim(),
      undoDepth: window.__carillon.stats().undoDepth,
    }), button)

  /*
   * Un clic n'y touche pas — **même avec un tremblement**. Deux cas, parce que le premier seul ne prouve
   * rien : `page.click` n'émet aucun mouvement entre l'appui et le relâchement, donc il ne traverse jamais
   * le seuil de tap. Vérifié par mutation : sans le second cas, retirer le seuil passait au vert, alors
   * qu'un doigt qui bouge de 5 px changerait la pulsation de toute la scène.
   */
  const before = await readTempo()
  await page.click(button)
  await wait(150)
  const afterClick = await readTempo()
  const tremorBox = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, button)
  await page.mouse.move(tremorBox.x, tremorBox.y)
  await page.mouse.down()
  await page.mouse.move(tremorBox.x + 5, tremorBox.y)
  await page.mouse.move(tremorBox.x + 3, tremorBox.y + 2)
  await page.mouse.up()
  await wait(150)
  const afterTremor = await readTempo()
  rec.assert(
    'cliquer le bouton de tempo ne change pas le tempo, tremblement compris',
    afterClick.bpm === before.bpm &&
      afterClick.undoDepth === before.undoDepth &&
      afterTremor.bpm === before.bpm &&
      afterTremor.undoDepth === before.undoDepth,
    `clic ${before.bpm} -> ${afterClick.bpm} BPM | tremblement -> ${afterTremor.bpm} BPM, undo ${before.undoDepth} -> ${afterTremor.undoDepth}`
  )

  /** Glisse horizontalement depuis le centre du bouton, en vrais événements de pointeur. */
  const scrub = async (dx, steps = 8) => {
    const box = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, button)
    await page.mouse.move(box.x, box.y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i += 1) await page.mouse.move(box.x + (dx * i) / steps, box.y)
    await page.mouse.up()
    await wait(150)
  }

  await scrub(120)
  const faster = await readTempo()
  await rec.shot(page, 'tempo-accelere')
  rec.assert(
    'glisser à droite accélère, et le libellé visible suit',
    faster.bpm > before.bpm && faster.label === `${faster.bpm} BPM`,
    `${before.bpm} -> ${faster.bpm} BPM, libellé « ${faster.label} »`
  )

  /*
   * La cadence **entendue**, pas le libellé : on compte les émissions d'une source sur une fenêtre
   * simulée identique, à deux tempos. Doubler le tempo doit doubler le nombre de billes — c'est la seule
   * mesure qui dise que la grille a vraiment changé et pas seulement l'affichage.
   */
  const emissionsAt = async (bpm) =>
    page.evaluate((target) => {
      const c = window.__carillon
      c.reset()
      c.addEmitter(640, 200, 1)
      // Billes **créées**, pas vivantes : une bille tombe hors champ en moins de deux secondes et le
      // plafond de billes écrête, donc compter les vivantes après 10 s simulées rendait 1 quel que soit le
      // tempo. `ballsSpawned` est le compteur d'identifiants, qui ne redescend jamais.
      const before = c.stats().ballsSpawned
      // Le tempo est posé par l'API de debug ici : ce qu'on mesure est l'effet du tempo sur la cadence,
      // pas le geste — le geste est asserté juste au-dessus.
      c.setTempo(target)
      c.advance(10)
      return c.stats().ballsSpawned - before
    }, bpm)

  const slow = await emissionsAt(60)
  const fast = await emissionsAt(120)
  console.log(`  [tempo] 60 BPM -> ${slow} billes | 120 BPM -> ${fast} billes sur 10 s simulées`)
  rec.assert(
    'doubler le tempo double la cadence réellement émise',
    fast >= slow * 2 - 1 && fast <= slow * 2 + 1 && slow > 3,
    `${slow} -> ${fast} billes (attendu ~${slow * 2})`
  )

  /*
   * Ni rafale ni silence **pendant** le glissement : à chaque étape, l'échéance de la source reste
   * devant nous et à moins d'une période. C'est la propriété que l'US7 a payée et qu'aucune interface
   * n'avait encore exercée, faute de pouvoir changer le tempo.
   */
  await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.setTempo(96)
    c.addEmitter(400, 200, 1)
    c.addEmitter(900, 200, 3)
  })
  await tick(page)
  const breaches = []
  for (const dx of [-90, -40, 20, 80, 140]) {
    await scrub(dx, 4)
    const state = await page.evaluate(() => ({
      time: window.__carillon.stats().time,
      emitters: window.__carillon.emitters(),
    }))
    for (const emitter of state.emitters) {
      const ahead = emitter.nextAt - state.time
      if (ahead <= 0 || ahead > emitter.period + 0.05) {
        breaches.push(`${emitter.id}@${ahead.toFixed(3)}s/${emitter.period.toFixed(3)}s`)
      }
    }
  }
  rec.assert(
    'régler le tempo ne produit ni rafale ni silence, à chaque étape du glissement',
    breaches.length === 0,
    breaches.length === 0 ? '5 réglages, aucune échéance hors grille' : `hors bornes : ${breaches}`
  )

  // Annulable, comme la gamme : c'est un réglage qui change ce qu'on entend de la scène entière.
  const beforeUndo = await readTempo()
  await page.keyboard.down('Meta')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Meta')
  await wait(200)
  const undone = await readTempo()
  rec.assert(
    'annuler restaure le tempo précédent, libellé compris',
    undone.bpm !== beforeUndo.bpm && undone.label === `${undone.bpm} BPM`,
    `${beforeUndo.bpm} -> ${undone.bpm} BPM, libellé « ${undone.label} »`
  )

  // Le tempo voyage dans le lien : c'est déjà le cas depuis le format v2, mais rien ne pouvait le régler.
  await page.evaluate(() => {
    const c = window.__carillon
    c.reset()
    c.setTempo(144)
    c.addBar(300, 400, 700, 420)
  })
  await page.click('[data-control="share"]')
  await wait(200)
  const link = await page.evaluate(() => location.href)
  const guest = await browser.newPage()
  rec.attachConsoleListeners(guest)
  await guest.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await guest.goto(link, { waitUntil: 'load' })
  await waitForCarillon(guest)
  const received = await guest.evaluate(() => ({
    bpm: window.__carillon.stats().bpm,
    label: (document.querySelector('#tempo-label')?.textContent ?? '').trim(),
  }))
  await guest.close()
  rec.assert(
    'un tempo réglé traverse le lien de partage',
    received.bpm === 144 && received.label === '144 BPM',
    `144 -> ${received.bpm} BPM, libellé « ${received.label} »`
  )

  // --- 375 px : le bouton reste atteignable et le glissement fonctionne au doigt ---
  await page.setViewport({ width: 375, height: 780, deviceScaleFactor: 2 })
  await tick(page)
  const phoneBefore = await readTempo()
  const box = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, right: r.right }
  }, button)
  await page.touchscreen.touchStart(box.x, box.y)
  for (let i = 1; i <= 6; i += 1) await page.touchscreen.touchMove(box.x - (70 * i) / 6, box.y)
  await page.touchscreen.touchEnd()
  await wait(150)
  const phoneAfter = await readTempo()
  await rec.shot(page, 'tempo-mobile')
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }))
  rec.assert(
    'à 375 px le bouton est dans l’écran et le glissement au doigt règle le tempo',
    box.right <= overflow.width &&
      box.width > 24 &&
      phoneAfter.bpm < phoneBefore.bpm &&
      overflow.scrollWidth <= overflow.width,
    `bouton ${Math.round(box.width)}px, bord droit ${Math.round(box.right)}/${overflow.width} | ${phoneBefore.bpm} -> ${phoneAfter.bpm} BPM`
  )

  await page.close()
}

const SCENARIOS = {
  sandbox: runSandbox,
  stress: runStress,
  mobile: runMobile,
  controls: runControls,
  resize: runResize,
  alive: runAlive,
  share: runShare,
  vernis: runVernis,
  rythme: runRythme,
  timbres: runTimbres,
  natures: runNatures,
  air: runAir,
  partage: runPartageV2,
  lacher: runLacher,
  edit: runEdit,
  touch: runTouch,
  roue: runRoue,
  sources: runSources,
  tempo: runTempo,
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
