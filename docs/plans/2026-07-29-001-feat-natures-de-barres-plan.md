---
title: Natures de barres - Plan
date: 2026-07-29
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Natures de barres - Plan

## Goal Capsule

- **Objectif** : donner une nature aux barres — mur, trampoline, éphémère — pour qu'un motif **évolue** au lieu de se répéter à l'identique.
- **Autorité produit** : `STRATEGY.md` (non-buts et critères de succès). Les trois autres directions explorées au brainstorm — harmonie progressive, géométrie mobile, bouton de variation — ne sont **pas** dans le périmètre actif de ce plan.
- **Bloquant ouvert** : aucun. Le périmètre du format de partage est tranché (voir Key Decisions).

---

## Product Contract

### Summary

Les barres cessent d'être interchangeables : chacune porte une nature qui change ce que la physique en fait. Un trampoline renvoie la bille vers le haut, donc répète une note ; une barre éphémère s'efface après quelques impacts puis revient sur un temps de la grille, donc fait dériver le motif d'une mesure à l'autre.

### Problem Frame

L'US7 a réglé le rythme : les sources tombent sur une grille commune et une bille lâchée à la main revient sur le temps de la mesure. Une scène **tourne** désormais.

Et c'est précisément ce qui a créé le manque suivant : elle tourne **à l'identique**, indéfiniment. La géométrie est fixe, toutes les barres se comportent pareil, donc la suite de notes d'une mesure est exactement celle de la suivante. Le produit sait produire une boucle, pas une phrase.

Le second critère de succès de `STRATEGY.md` est « on veut recommencer : on modifie une barre juste pour entendre ce que ça change ». Aujourd'hui la seule façon de faire évoluer une scène est d'y toucher soi-même. Rien dans la scène ne peut évoluer tout seul, et rien ne récompense la patience d'écoute.

Les types de barres figuraient au backlog de l'US3 et y ont été reportés — le YAGNI du dépôt disait à l'époque de ne pas les ajouter avant que le geste d'édition ne soit solide. Il l'est depuis l'US3, et `Bar.restitution` existe déjà dans le contrat de type sans jamais varier.

### Key Decisions

- **Trois natures, pas plus** — chaque nature ajoutée est un rendu supplémentaire à distinguer d'un coup d'œil sur une scène de quinze barres, en plus des poignées et des sources. *Governs R1, R8.*
- **Une barre éphémère revient ; elle ne meurt pas** *(session-settled: user-approved — chosen over une disparition définitive : sans retour, toute scène finit vide et le produit s'éteint tout seul).* *Governs R4.*
- **La nature se change à l'appui long sur la barre, pas au tap** — le tap fait sonner la barre, et c'est comme ça qu'on apprend le lien entre sa couleur et sa hauteur ; le lui voler serait payer une fonction avec une autre. *Governs R6.*
- **La nature ne touche pas la hauteur** — la géométrie reste la seule source de la note, ce qui préserve la promesse centrale du produit. *Governs R5.*
- **Un seul bump de format, portant la nature, le tempo et l'instrument** — trois bumps coûteraient trois fois la rétro-lecture des liens déjà émis, pour un gain nul ; et le tempo comme l'instrument sont restés hors du lien aux US7 et US8 sans qu'on l'ait voulu. *Governs R10.*
- **Les types de barres plutôt que l'harmonie progressive** *(session-settled: user-directed — chosen over une tonique qui se déplace sur une progression : l'harmonie mobile ferait jouer des notes différentes à une même barre selon le moment, ce qui entame « la géométrie **est** la partition »).*

### Key Flows

- F1. Changer la nature d'une barre
  - **Déclencheur** : appui long sur une barre existante.
  - **Étapes** : la barre passe à la nature suivante, en cycle ; le changement s'annonce ; la barre prend immédiatement son nouveau rendu.
  - **Résultat** : la barre se comporte différemment au prochain impact, sans que sa note ait changé.
  - **Couvert par** : R5, R6, R7, R8.

- F2. Cycle de vie d'une barre éphémère
  - **Déclencheur** : un impact audible sur une barre éphémère.
  - **Étapes** : son compte d'impacts restants décroît et se voit ; à zéro, elle s'efface et les billes la traversent ; au prochain temps de mesure de la grille, elle revient avec son compte réarmé.
  - **Résultat** : la suite de notes d'une mesure diffère de celle de la suivante.
  - **Couvert par** : R4, R9, SC1.

### Requirements

**Les natures**

- R1. Une barre porte une nature parmi trois : mur, trampoline, éphémère. La nature par défaut est mur.
- R2. Un mur se comporte exactement comme la barre livrée aujourd'hui : même restitution, une note par impact audible.
- R3. Un trampoline renvoie la bille avec plus d'énergie qu'elle n'en avait, borné de sorte qu'aucune bille ne puisse accumuler de la vitesse sans fin ni quitter la scène par le haut.
- R4. Une barre éphémère s'efface après un nombre fixe d'impacts audibles, puis revient sur un temps de mesure de la grille avec son compte réarmé. Pendant son absence, les billes la traversent sans note.
- R5. La nature d'une barre ne change aucune hauteur : la note reste dérivée de sa seule géométrie.

**Le geste**

- R6. Un appui long sur une barre change sa nature, en cycle, et l'annonce. Le tap continue de faire sonner la barre.
- R7. Un changement de nature est annulable comme toute autre modification de la scène.

**La lisibilité**

- R8. Les trois natures se distinguent l'une de l'autre sans texte, sans survol et sans interaction, sur une scène dense.
- R9. Une barre éphémère montre où elle en est : combien d'impacts lui restent, et le fait qu'elle est absente.

**Le partage**

- R10. La nature des barres, le tempo et l'instrument voyagent dans le lien de partage. Un lien émis avant ce travail reste lisible : ses barres sont des murs, son tempo et son instrument sont ceux par défaut.

### Acceptance Examples

- AE1. **Couvre R3.** Étant donné une bille lâchée d'une hauteur quelconque sur un trampoline, quand elle rebondit vingt fois de suite, alors elle ne sort jamais par le haut de la scène et sa vitesse reste bornée.
- AE2. **Couvre R4.** Étant donné une barre éphémère à un impact restant, quand une bille la frappe, alors elle s'efface, la bille suivante la traverse sans note, et la barre est de retour au prochain temps de mesure.
- AE3. **Couvre R4, SC1.** Étant donné une scène tempo-verrouillée contenant une barre éphémère, quand on compare la suite de notes de deux mesures consécutives, alors les deux suites diffèrent.
- AE4. **Couvre R5.** Étant donné une barre de nature quelconque, quand sa nature change, alors sa note reste identique.
- AE5. **Couvre R10.** Étant donné un lien de partage émis avant ce travail, quand on l'ouvre, alors la scène se remplit, toutes ses barres sont des murs, et le tempo comme l'instrument sont ceux par défaut.
- AE6. **Couvre R10.** Étant donné une scène dont on a changé une nature, le tempo et l'instrument, quand on ouvre son lien sur un autre écran, alors les trois sont restitués.

### Success Criteria

- SC1. Sur une scène tempo-verrouillée comportant au moins une barre éphémère, la suite de notes d'une mesure **diffère** de celle de la suivante — vérifiable dans le cœur pur, sans navigateur.
- SC2. Le budget de perf tient : au moins 60 fps au plafond de billes avec les trois natures présentes sur la scène.
- SC3. Le HUD ne grandit pas : aucun contrôle permanent ajouté à la barre d'outils, qui en porte déjà sept.

### Scope Boundaries

- L'harmonie progressive (une tonique qui se déplace), la géométrie mobile (des barres qui oscillent) et le bouton de variation : explorés au brainstorm, non retenus ici.
- Un instrument par barre : demanderait une notion de sélection que le produit n'a pas.
- Une quatrième nature (barre à sens unique, barre qui accélère) : à juger après avoir écouté les trois.
- Les non-buts de `STRATEGY.md` restent entiers : pas de backend, pas de partition, pas d'export, aucune dépendance runtime.

### Dependencies / Assumptions

- Dépend de la grille musicale de l'US7 (`src/core/clock.ts`), sans laquelle le retour d'une barre éphémère n'aurait pas d'instant à viser.
- Suppose que l'appui long sur une barre est libre. À vérifier : l'entrée n'arme aujourd'hui son minuteur d'appui long que **dans le vide**, et retourne dès qu'une cible est attrapée. C'est une modification de l'entrée, pas un obstacle.
- Suppose que `Bar.restitution` peut varier par barre sans que la détection de collision continue perde sa justesse.

### Outstanding Questions

**Deferred to Planning**

- Q2. Comment distinguer les trois natures au rendu, sans texte ni survol.
- Q3. Combien d'impacts avant qu'une barre éphémère s'efface, et sur quelle division elle revient.
- Q4. Quelle borne exacte sur l'énergie rendue par un trampoline.

### Sources / Research

- `STRATEGY.md` — non-buts, critères de succès, et backlog (à mettre à jour : l'US6 y figure sans ✅, les US7 et US8 en sont absentes).
- `docs/plans/us3-le-geste-agreable.md` — les types de barres y sont explicitement reportés, avec la raison.
- `src/core/types.ts` — `Bar.restitution` existe déjà et ne varie jamais.
- `src/core/physics.ts` — collision continue cercle/capsule ; c'est là que la restitution s'applique.
- `src/core/clock.ts` — `gridTimeAfter`, l'instant que viserait le retour d'une barre éphémère.
- `src/ui/input.ts` — le minuteur d'appui long n'est armé que dans le vide.
- `src/core/share.ts` — format v1, versionné, à faire évoluer pour R10.

---

<!-- ce-section: work-relationships -->
## How This Work Fits Together

Ce plan porte **une** des quatre directions explorées au brainstorm : les natures de barres. Le découpage ci-dessous est la compréhension actuelle, pas une feuille de route engagée — une US ultérieure peut le réviser, le scinder ou l'écarter.

- Natures de barres — **ce plan**.
- Format de partage v2 — absorbé dans **ce plan** (R10) : il porte la nature, le tempo (US7) et l'instrument (US8), tous trois restés hors du lien jusqu'ici. Un seul bump, décidé.
- Harmonie progressive — *Can proceed independently of* ce plan. Plus gros gain musical du lot, au prix de la lisibilité « une barre, une note ».
- Géométrie mobile — *Depends on* la grille de l'US7 pour rester déterministe. *Shares* avec ce plan la question du rendu d'une barre qui n'est pas au repos.
- Bouton de variation — *Can proceed independently of* ce plan. Sert le critère « on veut recommencer » sans matière musicale nouvelle.
