# Carillon

**La physique fait la musique.** Dessine des barres, lâche des billes : chaque rebond joue une note
et allume une onde de lumière. Une barre courte sonne aigu, une longue sonne grave — on accorde
l'instrument à la géométrie.

## Jouer

```bash
pnpm install
pnpm dev
```

- **Glisser** sur la scène → dessine une barre (le nom de la note s'affiche pendant le tracé).
- **Cliquer / taper** → lâche une bille.
- **Scène surprise** → une cascade générée, différente à chaque appui.

Le son se déverrouille au premier geste (politique d'autoplay des navigateurs).

## Développer

```bash
pnpm check    # typecheck + tests unitaires
pnpm test     # tests seuls
pnpm shoot    # capture les preuves visuelles dans docs/proofs/
```

`pnpm shoot` pilote le Chrome système en headless (via `puppeteer-core`, aucun navigateur
téléchargé), joue les scénarios avec de vrais gestes souris et écrit des captures PNG. C'est la
preuve visuelle exigée avant tout commit — voir `CLAUDE.md` §4.

## Architecture

```
src/core/     simulation + musique : pur, déterministe, testé, zéro DOM
src/audio/    adaptateur Web Audio (mince) + budget de polyphonie (pur, testé)
src/ui/       rendu canvas, interaction pointeur, scènes
src/main.ts   boucle à pas fixe, câblage, API de debug (window.__carillon)
```

La frontière noyau pur / adaptateur navigateur n'est pas décorative : elle rend la physique et la
musique testables en Vitest, sans navigateur et sans flakiness.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — méthode de travail (boucle compound engineering, Definition of Done)
- [`STRATEGY.md`](./STRATEGY.md) — produit, backlog, non-buts, décisions techniques
- [`docs/plans/`](./docs/plans/) — un plan par US, avec ses critères d'acceptation
- [`docs/solutions/`](./docs/solutions/) — learnings capitalisés
- [`docs/proofs/`](./docs/proofs/) — captures de preuve, par US

## Dépendances

Aucune dépendance runtime. Canvas 2D et Web Audio suffisent. En dev : Vite, TypeScript, Vitest,
puppeteer-core.
