# Carillon

**[▶ Jouer en ligne](https://etienne-bernoux.github.io/carillon/)**

**La physique fait la musique.** Dessine des barres, lâche des billes : chaque rebond joue une note
et allume une onde de lumière. Une barre courte sonne aigu, une longue sonne grave — on accorde
l'instrument à la géométrie.

## Jouer

```bash
pnpm install
pnpm dev
```

- **Glisser** dans le vide → dessine une barre (le nom de la note s'affiche pendant le tracé).
- **Cliquer / taper** dans le vide → lâche une bille.
- **Attraper une barre** par son corps → la déplace, sans changer sa note.
- **Attraper le bout d'une barre** → l'étire : c'est comme ça qu'on **accorde** l'instrument, en
  entendant la note monter ou descendre.
- **Taper une barre** → la fait sonner, sans rien modifier.
- **Lâcher une barre sur un bord de l'écran** → la jette. Elle passe en pointillés rouges avant, pour
  qu'on le sache.
- **Appui long** dans le vide → pose une **source** : elle lâche une bille toutes les 0,9 s, donc la
  scène joue toute seule et on l'accorde pendant qu'elle tourne. Une source se déplace et se jette
  comme une barre.
- **Partager** → met un lien vers la scène dans l'URL et le copie. La scène **est** le lien : pas de
  compte, pas de serveur. Ouvert sur un autre écran, il rejoue les mêmes notes.
- **Annuler** ou `Cmd/Ctrl+Z` → revient sur le dernier geste.

Aucun mode, aucune gomme, aucun outil à sélectionner : le geste se désambiguïse par **où il commence**.
- **♪ Gamme** → change de gamme (pentatonique mineure, majeure, dorien, hirajoshi, lydien) et
  **réaccorde tout l'instrument** : la même scène rejouée sonne autrement.
- **Scène surprise** → une cascade générée, différente à chaque appui.

La hauteur dépend de la longueur **relative à la largeur de l'écran** : l'instrument garde donc toute
son étendue sur un téléphone. La **couleur d'une barre encode sa classe de hauteur** — deux barres de
même couleur jouent la même note, éventuellement à l'octave près.

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

## Déploiement

Poussé sur `main` → GitHub Actions construit et publie sur Pages. Le déploiement est **conditionné aux
tests** : `pnpm check` tourne avant le build, donc une régression bloque la mise en ligne. Les 9
scénarios navigateur (`pnpm shoot`) restent une étape locale — le harnais pilote le Chrome du poste.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — méthode de travail (boucle compound engineering, Definition of Done)
- [`STRATEGY.md`](./STRATEGY.md) — produit, backlog, non-buts, décisions techniques
- [`docs/plans/`](./docs/plans/) — un plan par US, avec ses critères d'acceptation
- [`docs/solutions/`](./docs/solutions/) — learnings capitalisés
- [`docs/proofs/`](./docs/proofs/) — captures de preuve, par US

## Dépendances

Aucune dépendance runtime. Canvas 2D et Web Audio suffisent. En dev : Vite, TypeScript, Vitest,
puppeteer-core.
