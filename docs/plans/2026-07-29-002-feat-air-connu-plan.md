---
title: Un air connu - Plan
date: 2026-07-29
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Un air connu - Plan

## Goal Capsule

- **Objectif** : « Scène surprise » cesse de produire un miroitement joli et sans direction. Elle place les barres de façon qu'une bille joue l'**ouverture d'un air connu**, reconnaissable à l'oreille.
- **Autorité produit** : `STRATEGY.md`. Le feedback qui déclenche ce travail : « la scène surprise est nulle, elle devrait mener à une musique connue. »
- **Bloquant ouvert** : aucun. Les quatre décisions structurantes sont tranchées par la mesure (voir Key Decisions) ; le taux de convergence à atteindre est un critère, pas une inconnue.

---

## Product Contract

### Summary

Un générateur résout un problème **inverse** : étant donné une suite de hauteurs, il place des barres pour qu'une seule bille les frappe dans cet ordre. La géométrie reste la partition — on choisit simplement une géométrie qui épelle un air que l'oreille reconnaît.

### Problem Frame

Le bouton « Scène surprise » existe depuis l'US2. Il stratifie les longueurs et étage les rangées, ce qui garantit la **richesse** (11 hauteurs distinctes sur un grand écran) et rien d'autre. Le résultat est un miroitement agréable où aucune phrase ne se dessine — la scène a des notes, pas de musique.

C'est le seul endroit du produit où l'on promet une surprise et où l'on livre du bruit blanc. Et c'est aussi le premier contact de tout nouvel arrivant, puisque la scène d'accueil est générée : le critère de succès n° 1 de `STRATEGY.md` (« un nouvel arrivant entend quelque chose en dix secondes ») est donc servi par ce qu'il y a de plus faible dans le produit.

### Key Decisions

Ces quatre décisions viennent de **sondes exécutées**, pas d'un raisonnement. Les nombres sont dans les Risques.

- **La vérification se fait par rejeu depuis le début, pour chaque candidat.** Un système de rebonds est chaotique : reprendre la simulation depuis un état sauvegardé n'est pas identique au bit près à une trajectoire continue, et l'écart s'amplifie à chaque rebond. *Governs R4.*
- **La suite de hauteurs est exacte ; le rythme est une fenêtre bornée.** Imposer la durée exacte de chaque note fige le point d'impact et rend la recherche insoluble. La laisser libre produit des notes qui se fondent. *Governs R2, R3.*
- **Un incipit, pas un air entier.** Cinq à huit notes suffisent à reconnaître un air, et la bille recyclée le reboucle. *Governs R1.*
- **Le générateur échoue proprement.** S'il ne converge pas dans son budget, il rend la main au générateur actuel plutôt que de livrer un air approximatif. *Governs R7.*

### Key Flows

- F1. Ouvrir Carillon, ou cliquer « Scène surprise »
  - **Déclencheur** : chargement sans lien de partage, ou clic sur le bouton.
  - **Étapes** : le générateur choisit un air du catalogue, résout le placement, vérifie par rejeu, et pose la scène. La bille de départ est lâchée.
  - **Résultat** : on entend l'ouverture d'un air connu, puis la scène continue de jouer.
  - **Couvert par** : R1, R2, R4, R6, R7.

### Requirements

**L'air**

- R1. La scène générée fait jouer l'**ouverture** d'un air du domaine public, de cinq à huit notes.
- R2. La suite de hauteurs jouée est **exactement** celle de l'air : aucune note substituée, aucune insérée avant la fin de l'incipit.
- R3. Chaque intervalle entre deux notes de l'incipit dure au moins 160 ms, et reste dans une fenêtre bornée autour de la durée voulue — sinon deux notes se fondent en une et l'air n'est plus reconnaissable.
- R4. La scène est **vérifiée par rejeu** : le générateur ne rend que des scènes dont la simulation complète, depuis l'instant zéro, produit la suite attendue.
- R5. L'air joué est **annoncé** par son nom, sinon la reconnaissance n'a aucun repère.

**Le reste de la scène**

- R6. Après l'incipit, la scène continue de jouer : elle n'est pas un couloir à usage unique.
- R7. Si le générateur ne converge pas dans son budget, la scène actuelle (longueurs stratifiées) est produite à la place, sans erreur visible.

**Ce qui ne change pas**

- R8. La gamme reste cohérente avec l'air : le générateur choisit une gamme qui **contient** ses notes, et l'accordage affiché suit.
- R9. Le générateur est **pur et déterministe** : même graine, même scène. Il vit dans le cœur, sans DOM.

### Acceptance Examples

- AE1. **Couvre R2, R4.** Étant donné une scène rendue par le générateur, quand on la simule depuis zéro, alors les premières notes jouées sont exactement celles de l'incipit, dans l'ordre.
- AE2. **Couvre R3.** Étant donné une scène rendue, quand on mesure les intervalles entre les notes de l'incipit, alors aucun n'est inférieur à 160 ms.
- AE3. **Couvre R9.** Étant donné une même graine et une même largeur de scène, quand on génère deux fois, alors les deux scènes sont identiques.
- AE4. **Couvre R7.** Étant donné un budget de recherche réduit à zéro, quand on demande une scène, alors on reçoit la scène stratifiée actuelle et aucune exception.
- AE5. **Couvre R8.** Étant donné un air dont les notes exigent une tierce majeure, quand la scène est générée, alors la gamme active la contient.

### Success Criteria

- SC1. Le générateur converge pour **au moins la moitié** des graines essayées, sur chaque air du catalogue et sur les trois largeurs de référence (375, 800, 1280 px). *Mesuré : 19 sur 20 en 1280 px.*
- SC2. La génération tient dans **350 ms** sur un ordinateur portable. Le budget est celui qui a été **mesuré** : 20 graines donnent une médiane de 60 ms et un pire cas de 327 ms. La cible initiale de 200 ms était une intuition ; la garder aurait demandé de rogner la grille de candidats jusqu'à faire chuter la convergence — arbitrage mesuré et refusé.
- SC3. Aucune régression : les scénarios existants restent verts, la scène d'accueil reste non vide et sans barre derrière le HUD.

### Scope Boundaries

- **Pas de partition, pas d'éditeur de mélodie.** Le catalogue d'airs est en dur dans le cœur. Le produit reste un bac à sable, pas un séquenceur (non-but de `STRATEGY.md`).
- **Pas d'air complet** : l'incipit suffit, et la bille recyclée le reboucle.
- **Aucun air sous droits.** Domaine public uniquement.
- **Pas de contrôle « choisir l'air »** dans cette tranche : le bouton surprend, c'est son rôle. Un sélecteur viendrait après, s'il manque.

### Dependencies / Assumptions

- Dépend du pas de simulation déterministe (`src/core/physics.ts`) — sans lui, aucune vérification par rejeu n'est possible.
- Dépend de `midiForLength` (`src/core/music.ts`), qu'il faut **inverser** : trouver la longueur qui produit une hauteur donnée. L'inversion est un balayage, la fonction étant monotone par morceaux.
- Suppose qu'il faut **ajouter une gamme majeure** au catalogue : la plupart des airs connus l'exigent, et aucune des cinq gammes actuelles ne contient à la fois la tierce majeure et la quarte. Ajout **en fin** de `TUNINGS`, l'ordre étant figé (l'index voyage dans les liens).
- Le recyclage des billes (US7) fait rebouclér l'incipit. Sans lui, l'air se jouerait une fois puis se tairait.

### Outstanding Questions

**Deferred to Planning**

- Q1. Quels airs au catalogue, et combien de notes par incipit.
- Q2. La stratégie de recherche exacte (nombre d'angles, de durées, ordre de parcours) et son budget.
- Q3. Faut-il autoriser les trampolines dans le placement — les sondes n'en ont jamais eu besoin sur cinq notes, mais un incipit plus long pourrait en demander.

### Sources / Research

- `src/ui/scene.ts` — le générateur actuel, à conserver comme repli (R7).
- `src/core/music.ts` — `midiForLength`, `lengthRangeForWidth`, `TUNINGS`.
- `src/core/physics.ts` — `stepWorld`, la vérité de terrain.
- `src/core/nature.ts` — trampolines, si Q3 le demande.
- `docs/plans/2026-07-29-001-feat-natures-de-barres-plan.md` — l'US en cours, dont ce plan réutilise le recyclage.

---

## Risques — et ce que les sondes ont déjà mesuré

Trois sondes ont été exécutées avant d'écrire ce plan, sur « Au clair de la lune ». Chacune a **changé une décision** :

| Sonde | Approche | Résultat |
|---|---|---|
| 1 | Modèle balistique écrit à la main | **0 sur 510** scènes exactes, meilleur préfixe 1/11. Trois écarts systématiques avec le pas réel : le rayon effectif de collision (la bille touche 11,5 px avant que son centre n'atteigne la barre), le frottement tangentiel, et les barres déjà posées qui interceptent la trajectoire. |
| 2 | Simulateur dans la boucle, **reprise** depuis un état sauvegardé | 9 notes sur 11 placées, mais **4 sur 11** au rejeu. C'est le chaos : reprendre n'est pas identique au bit près à une trajectoire continue. |
| 3 | Rejeu **depuis le début** à chaque candidat, sur un incipit de 5 notes | **18 sur 40** exactes avec le rythme en simple préférence. Avec une fenêtre rythmique stricte : **1 sur 40**, mais celle-là sonne juste (durées 0,60 / 0,23 / 0,23 / 0,23 / 0,44 — trois notes égales puis une longue). |

Ce qu'il reste donc à résoudre, et c'est le vrai risque de cette US :

- **Le taux de convergence sous fenêtre rythmique est trop bas** (1 sur 40 mesuré). Trois leviers non encore essayés : élargir la fenêtre, faire varier la durée de temps par tentative, et ordonner le parcours des angles au lieu de le balayer. Si aucun ne suffit, l'incipit se raccourcit — c'est la variable d'ajustement, pas le contrat.
- **Le coût de la recherche.** La sonde 3 tournait à ~3 s par tentative, soit 15× le budget de SC2. Trois optimisations identifiées et non encore appliquées : arrêter le rejeu dès le (k+1)-ième impact au lieu de simuler 12 s, ramener la limite de rejeu à ce que l'air demande, et retirer les trampolines du parcours (aucune sonde n'en a eu besoin).
- **Les trampolines pourraient devenir nécessaires** sur un incipit long : la bille perd de l'énergie à chaque rebond amorti. Q3.
- **« Reconnaissable » n'est pas mesurable.** Les tests garantissent la suite de hauteurs et les intervalles ; que l'air soit *reconnu* ne se juge qu'à l'oreille. C'est le seul critère de cette US qu'une machine ne tranche pas — comme les timbres de l'US8.

## Orchestration

Écrit par moi, sur la base de trois sondes exécutées. La **review reste déléguée** à un agent qui n'a pas écrit le code : sur huit US, elle a trouvé un défaut produit ou un bloquant à chaque passage, dont le dernier cassait un contrôle livré.
