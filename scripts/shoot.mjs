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

const ALL_SCENARIOS = ['sandbox', 'stress', 'mobile', 'controls', 'resize']

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

async function runSandbox(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)

  // L'app charge délibérément une scène d'accueil : on compte donc les barres AJOUTÉES,
  // pas le total, sinon l'assertion casse à chaque évolution de la scène par défaut.
  const beforeBars = await page.evaluate(() => window.__carillon.stats().bars)

  // Glisser à la souris pour dessiner 3 barres à des angles différents —
  // on prouve le vrai chemin d'entrée, pas seulement l'API de debug.
  await dragBar(page, [200, 260], [520, 320])
  await dragBar(page, [250, 480], [680, 430])
  await dragBar(page, [650, 180], [920, 560])
  await tick(page)

  await rec.shot(page, 'bars-drawn')
  const afterBars = await page.evaluate(() => window.__carillon.stats())
  rec.assert(
    '3 barres ajoutées à la souris',
    afterBars.bars - beforeBars === 3,
    `avant=${beforeBars} après=${afterBars.bars}`,
  )

  // 5 clics pour lâcher 5 billes (vrai geste souris). y=140 : sous la barre d'outils
  // (haut-droite, ~14-90px à 1280×800) pour ne pas y cliquer par accident — un clic sur
  // "Tout effacer" ou "Scène surprise" au lieu du canvas ferait échouer l'assertion
  // pour la mauvaise raison (bouton actionné, pas bille non lâchée).
  const beforeClicksBalls = (await page.evaluate(() => window.__carillon.stats())).balls
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(150 + i * 180, 140)
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
    for (let i = 0; i < 220; i++) spawn(dropped++)

    const TARGET = 220
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
  rec.assert('au moins 200 billes vivantes à la mesure', stats.balls >= 200, `balls=${stats.balls}`)
  rec.assert('des notes ont réellement été jouées', stats.notes > 0, `notes=${stats.notes}`)
  rec.assert('aucun pas de simulation abandonné', stats.droppedSteps === 0, `droppedSteps=${stats.droppedSteps}`)
  rec.assert('fps >= 60 avec 200+ billes / 12 barres, audio actif', stats.fps >= 60, `fps=${stats.fps.toFixed(1)}`)

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
  const shot1 = await page.screenshot()
  rec.assert('« Scène surprise » remplit la scène', afterSurprise1 > 0, `bars=${afterSurprise1}`)

  // Deuxième appui successif → une scène différente. L'API de debug n'expose pas la géométrie
  // des barres (seulement leur compte), donc l'empreinte de comparaison est le rendu pixel lui-même :
  // deux scènes différentes se dessinent différemment. Repli explicite prévu par la consigne quand
  // l'API ne suffit pas à une empreinte plus fine.
  await page.click('[data-control="surprise"]')
  await tick(page)
  const afterSurprise2 = await page.evaluate(() => window.__carillon.stats().bars)
  const shot2 = await page.screenshot()
  console.log(`  [controls] scène 1 : bars=${afterSurprise1} — scène 2 : bars=${afterSurprise2}`)
  rec.assert('« Scène surprise » (2e appui) remplit aussi la scène', afterSurprise2 > 0, `bars=${afterSurprise2}`)
  rec.assert('« Scène surprise » : deux appuis donnent des scènes différentes', !shot1.equals(shot2), 'comparaison pixel des deux captures')

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

async function runResize(browser, url, rec) {
  const page = await browser.newPage()
  rec.attachConsoleListeners(page)
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto(url, { waitUntil: 'load' })
  await waitForCarillon(page)
  await tick(page)

  async function assertAfterResize(width, height) {
    await page.setViewport({ width, height })
    await tick(page)
    const stats = await page.evaluate(() => window.__carillon.stats())
    console.log(`  [resize] ${width}x${height} → bars=${stats.bars} barsOutOfBounds=${stats.barsOutOfBounds}`)
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
  }

  // C'est le chemin exact d'une rotation de téléphone ou d'un redimensionnement de fenêtre :
  // le ResizeObserver du canvas doit reconstruire la scène dans les nouvelles bornes.
  await assertAfterResize(900, 600)
  await assertAfterResize(375, 740)

  await rec.shot(page, 'resize')
  await page.close()
}

const SCENARIOS = {
  sandbox: runSandbox,
  stress: runStress,
  mobile: runMobile,
  controls: runControls,
  resize: runResize,
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
