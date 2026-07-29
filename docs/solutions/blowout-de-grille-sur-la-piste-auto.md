# Le blowout de grille ne frappe pas que la piste `1fr`

> Tiré de l'US6, trouvé en review indépendante. Un défaut de mise en page **livré en production**,
> invisible à onze largeurs de test sur onze.

## Le symptôme

De 641 px à ~860 px de large, le titre « Carillon » était tronqué en « Caril », passait **sous** les
boutons, et la tagline s'empilait à un mot par ligne :

```
Caril[BOUTON GAMME] [Scène surprise] [Partager] …
la
physique
fait
la
musique
```

Aucune assertion ne bougeait. Les onze largeurs exercées par le harnais — 320, 375, 390, 740×375, 800,
844×390, 900, 1000, 1280 — passaient **toutes** à côté de la bande.

## La cause

```css
/* avant */
grid-template-columns: minmax(0, 1fr) auto;
```

La règle `minmax(0, 1fr)` est là pour empêcher le blowout de la piste flexible : sans elle, un enfant
large pousse la piste au-delà du conteneur. Elle était appliquée, et correctement.

Le piège est que la **piste `auto` d'à côté** produit le défaut symétrique. Une piste `auto` se
dimensionne à son **max-content** : ici la barre d'outils, six libellés en toutes lettres, ~690 px.
Elle prend donc tout, et la piste `minmax(0, 1fr)` — dont le minimum est explicitement **0** — tombe
à 0 px. Le `minmax(0, …)` qui protège d'un débordement autorise, de l'autre côté, un écrasement total.

```css
/* après : la colonne du titre ne descend jamais sous la largeur de son mot le plus long */
grid-template-columns: minmax(min-content, 1fr) auto;
```

Et c'est la barre d'outils qui se replie — elle sait le faire (`flex-wrap`), le titre non.

## Le second piège : un seuil de largeur qui ignore la hauteur

Le plancher `min-content` évite l'écrasement, mais entre 641 et 860 px la colonne du titre ne fait plus
que 83 px : correct, illisible. Le vrai remède est d'**empiler** en une colonne sur cette plage.

Sauf que la première version de cette règle ne regardait que la largeur :

```css
@media (max-width: 860px) { /* empiler */ }
```

À **740×375** — un téléphone en paysage — elle empilait la barre d'outils en bas d'un écran déjà bas,
et une barre de la scène est passée derrière le HUD. Attrapé en régression par un scénario existant
(`share`, après rotation), pas par les nouvelles assertions.

La bonne condition distingue les deux problèmes, parce que ce sont deux problèmes :

```css
/* étroit (toute hauteur), OU moyen ET haut */
@media (max-width: 640px), (max-width: 860px) and (min-height: 481px) { /* empiler */ }
```

L'écrasement du titre n'existe qu'en **mode texte** (barre d'outils à ~690 px). Or le mode icône
s'active aussi sur écran **bas**, où la barre ne fait plus que ~280 px et ne gêne personne — et où la
hauteur est justement la ressource rare.

## Ce que ça change dans la méthode

- **Un `minmax(0, 1fr)` protège d'un débordement et autorise un écrasement.** Dès qu'il cohabite avec
  une piste `auto` dont le contenu peut être large, il faut un **plancher** sur la piste flexible.
- **Un seuil de mise en page se vérifie de part et d'autre de sa bascule**, et sur les deux axes. Les
  assertions ajoutées portent sur 641, 700, 859 et 861 px : les trois premières échouent sur l'ancien
  CSS, la quatrième garde le comportement au-delà.
- **Une propriété de mise en page s'asserte sur la cause, pas sur l'apparence** : « le titre n'est pas
  tronqué » = `h1.scrollWidth <= ceil(width) + 1`, et « la tagline tient sur deux lignes » se calcule
  depuis le `line-height` **calculé**, pas depuis un nombre de pixels magique.
- **Garde-fou aveugle à connaître** : `countUnderHud` ignore les rectangles de largeur nulle (il faut
  bien ignorer les éléments masqués). Un élément **écrasé** à 0 px de large sort donc de la liste HUD —
  l'assertion `barsUnderHud === 0` devenait structurellement aveugle au titre exactement là où il
  chevauchait l'aire de jeu.

## Voir aussi

- [effet-present-dans-letat-invisible-a-lecran.md](effet-present-dans-letat-invisible-a-lecran.md) —
  quand une assertion verte protège du vide
