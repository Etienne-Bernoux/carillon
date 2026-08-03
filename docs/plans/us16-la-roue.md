# US16 — La roue

> Statut : **livrée** · Branche `feat/us16-la-roue` · PR #14 · 318 tests unitaires, 17 scénarios
> navigateur (230 assertions), 28 mutations tuées sur 28 · **trois** passes de review adverse déléguées,
> qui ont trouvé onze défauts réels — dont sept assertions creuses ou contournables portant précisément
> sur les correctifs que cette US revendique

## Intent

Deux réglages se changent aujourd'hui **en cyclant** :

- l'appui long sur une barre passe à la nature suivante — 3 options ;
- le bouton d'instrument passe au timbre suivant — 5 options.

Cycler ne passe pas l'échelle. Revenir en arrière d'un cran sur l'instrument coûte **quatre clics**, et
rien n'annonce combien d'options existent ni lesquelles : on découvre le cinquième timbre en cliquant
cinq fois, ou jamais. Un cycle cache l'ensemble ; une roue le **montre**.

C'est aussi ce qui débloque la suite : chaque nouvelle option ajoutée à un cycle en dégrade l'usage,
donc le cycle est un plafond sur le produit.

## La décision structurante : une géométrie, deux câblages

La roue est un **module de géométrie pur** (`src/core/wheel.ts`) qui ne connaît ni barres, ni timbres,
ni canvas : un centre, un anneau, N secteurs, et la question « quel secteur sous ce point ». Le rendu la
dessine, l'entrée lui passe des points, `main.ts` décide ce que chaque secteur veut dire.

Elle est câblée sur **deux** cibles dans cette US, pas une :

- **nature d'une barre** — appui long sur la barre (remplace le cyclage) ;
- **instrument** — appui sur le bouton de la barre d'outils (remplace le cyclage).

Un mécanisme générique justifié par un seul cas à 3 options serait de la sur-ingénierie déguisée. Le
second câblage est ce qui prouve que la géométrie est réellement indépendante de son contenu — et c'est
lui qui porte le vrai point de douleur (5 options).

## La décision d'interaction : relâcher au centre **épingle**, relâcher dehors **annule**

La roue est à ressort : elle s'ouvre pendant que le pointeur est enfoncé, et le **relâchement décide**.

| Où on relâche | Ce qui se passe |
|---|---|
| dans un secteur | ce secteur est choisi |
| au-delà de l'anneau extérieur | annulé, rien ne change |
| dans la zone morte centrale | la roue **reste ouverte** (épinglée) |

Le troisième cas n'est pas un détail. Le geste le plus probable la première fois est « j'appuie long,
je relâche sans bouger » — c'est exactement ce que fait quelqu'un qui découvre. Une roue purement à
ressort ne ferait alors **rien**, et la fonction resterait invisible : le même défaut que le cycle
qu'elle remplace. Épinglée, elle laisse le temps de lire les options, et un second tap choisit ou ferme.

Une fois épinglée : un tap dans un secteur choisit, un tap ailleurs ferme sans rien changer.

## Périmètre

**Dedans** : `src/core/wheel.ts` pur et testé (secteurs, zone morte, recadrage dans la scène), le rendu
dans `src/ui/renderer.ts`, le suivi du pointeur après l'appui long dans `src/ui/input.ts`, les deux
câblages dans `main.ts`, l'annonce accessible.

`prefers-reduced-motion` figurait dans ce périmètre à la rédaction : **il n'y avait rien à faire**. La
roue n'a aucune animation — elle apparaît, elle se lit, elle disparaît. Le noter plutôt que de laisser
la ligne cocher une fonction inexistante : une préférence « respectée » parce qu'elle ne s'applique pas
n'est pas une préférence respectée, et si une transition d'ouverture est ajoutée un jour, c'est ici
qu'il faudra revenir.

**Dehors**

- **La gamme** reste un bouton qui cycle. Elle **réaccorde toute la scène** — un effet de bord que les
  deux autres réglages n'ont pas —, et son nombre d'options n'est pas figé. La mettre dans la roue est
  une décision produit à part, pas une conséquence de celle-ci.
- **Le clavier** : la roue n'est pas pilotable sans pointeur. C'est l'US14, qui traite le sujet en
  entier plutôt qu'un modèle de focus bricolé pour un seul widget.
- **Les sous-menus** (roue à deux niveaux) : rien n'en a besoin aujourd'hui.
- **Le format de partage** : aucun état nouveau à faire voyager. La roue est un moyen de changer des
  valeurs qui voyagent déjà.

## Découpage

1. **`src/core/wheel.ts` + tests** — angles de secteurs, `sectorAt`, zone morte, anneau, `fitWheel`
   (recadrage pour qu'une roue ouverte au bord reste entièrement dans la scène), ancres de libellés.
2. **`src/ui/input.ts`** — après un appui long, continuer à émettre la position du pointeur, et émettre
   le relâchement avec son point. L'entrée ne connaît **pas** la roue : elle émet `long-press-move` et
   `long-press-end`, `main.ts` décide.
3. **`src/ui/renderer.ts`** — dessin de la roue : secteurs, secteur survolé, secteur courant marqué,
   libellés, zone morte.
4. **`main.ts`** — les deux câblages, l'annonce, l'undo (changer une nature reste annulable).
5. **`scripts/shoot.mjs`** — scénario roue : ouverture, choix, annulation, épinglage, bord d'écran,
   375 px.

## Critères d'acceptation

Chacun avec sa preuve, chacun validé par **test de mutation** (neutraliser, vérifier que ça rougit,
restaurer).

### Géométrie (Vitest, pur)

1. **Tout secteur est atteignable** : pour tout `n` de 2 à 8 et tout indice `i`, un point posé à
   l'angle médian et au rayon médian du secteur `i` est rendu par `sectorAt` comme `i`. Propriété sur
   tout le domaine, pas sur deux cas regardés.
2. **La zone morte ne choisit rien** : tout point à une distance strictement inférieure au rayon
   intérieur renvoie `pin`, quel que soit l'angle — jamais un secteur.
3. **Au-delà de l'anneau, annulé** : `cancel` au-delà du rayon extérieur, quel que soit l'angle.
4. **Les frontières sont exactes** : un point posé exactement sur la frontière entre deux secteurs
   appartient à un seul des deux, et le partitionnement ne laisse **aucun trou** — la somme des
   secteurs couvre 360°.
5. **Une roue ouverte au bord reste dans la scène** : pour un appui à chacun des quatre coins de la
   zone de scène, `fitWheel` renvoie un centre tel que le disque entier est contenu dans la zone. Une
   roue dont un secteur sort de l'écran a un secteur qu'on ne peut pas choisir.

### Interaction (Vitest sur `input.ts`, faux pointeur)

6. **Le pointeur est suivi après l'appui long** : bouger après le déclenchement émet des positions, et
   le relâchement émet son point. Aujourd'hui le mouvement est **supprimé** après un appui long.
7. **Aucun geste existant n'est volé** : le tap sur une barre la fait toujours sonner, le tap sur une
   source cycle toujours sa division, l'appui long dans le vide pose toujours une source, le glisser
   dessine toujours. Assertion sur la séquence exacte de gestes émis.

### Produit (harnais navigateur)

8. **La roue s'ouvre sur une barre** et montre **les trois natures**, la nature courante marquée.
9. **Choisir change** : relâcher sur le secteur « trampoline » donne une barre trampoline (assertion
   sur l'état exposé, **et** capture regardée).
10. **Annuler ne change rien** : relâcher au-delà de l'anneau laisse la nature d'origine.
11. **Épingler laisse la roue ouverte** : relâcher au centre, la roue est toujours dessinée ; un tap
    hors secteur la ferme sans rien changer.
12. **L'instrument a sa roue** : les cinq timbres sont visibles d'un coup, le courant marqué, et en
    choisir un change le timbre — un aller-retour coûte **deux gestes, pas huit**.
13. **375 px** : roue entièrement visible, zéro débordement horizontal, aucun secteur sous le HUD.
14. **La roue ouverte au bord de la scène** reste entièrement visible (preuve visuelle du critère 5).

### Non-régression

15. `pnpm check` vert ; les scénarios du harnais existants inchangés et verts.
16. Aucun coût dans la boucle chaude : la roue n'est dessinée que si elle est ouverte, et le
    garde-fou de perf reste dans son budget.

## Risques

- **Voler un geste.** C'est le risque principal, et le produit s'est déjà fait mal là-dessus (le tap
  d'écoute volé par l'appui long, corrigé par `handled`). D'où le critère 7, assertion sur la séquence
  exacte.
- **Un secteur hors écran.** Une roue ouverte près d'un bord a des options inatteignables — un défaut
  qu'aucun test de géométrie « au centre » ne verrait. D'où `fitWheel` et le critère 5.
- **Un mécanisme qui ne sert qu'une fois.** Écarté par construction : deux câblages dans l'US.
- **Le rendu joli mais illisible.** Les libellés de secteurs sur un fond de scène chargé. Se juge en
  **regardant** les captures, pas en comptant des pixels.

## Ce que la vérification a trouvé

### Le défaut que seule la capture voyait

Les douze assertions du scénario passaient. En regardant `docs/proofs/roue/07-roue-au-bord.png`, un
défaut de principe : près d'un bord, `fitWheel` recadre la roue **loin du doigt**. Le pointeur immobile
tombe alors dans un secteur — donc « appuyer long, relâcher sans bouger », le geste de la découverte,
**appliquait « éphémère »** au lieu d'épingler. La roue modifiait la scène sans que personne ait visé.

Correctif : la zone morte se mesure depuis l'**origine du geste**, pas depuis le centre du dessin. Un
geste qui n'a jamais quitté son point de départ n'a rien visé. Mutation qui le prouve : mesurer depuis
le centre fait rougir l'assertion avec `nature=wall->ephemeral`.

Leçon générale : **un recadrage qui déplace un widget déplace aussi son repère d'interaction.** Tant que
la roue s'ouvrait sous le doigt, « centre du dessin » et « origine du geste » étaient le même point —
deux notions confondues qui divergent exactement là où le recadrage agit.

### Une mutation survivante qui condamnait le test, pas le code

Retirer le centrage `- step / 2` de `sectorStartAngle` laissait le test « premier secteur centré sur le
haut » **vert**. Le test visait pile la verticale, qui reste dans le premier secteur même quand le haut
devient une **frontière** entre deux secteurs. La propriété réelle est le voisinage : si le haut est une
frontière, viser en haut est un tirage au sort entre deux options. Test corrigé pour asserter un
voisinage angulaire, puis mutation tuée.

### Ce que la review adverse a trouvé, que je n'avais pas vu

Trois constats sérieux, tous réels.

**Mon assertion phare était creuse.** Muter « la zone morte se mesure depuis l'origine du geste » vers
« depuis le centre du dessin » — le défaut ci-dessus, celui que l'US revendique d'avoir corrigé —
laissait les **douze assertions vertes**. Cause : le bloc du bord ne bougeait jamais le pointeur, donc
`aimWheel` n'était jamais appelée, `committed` restait faux, et l'assertion ne testait que
`resolveWheel`. Elle testait la conséquence, pas le garde. Corrigée par un micro-mouvement sous le
seuil, et une assertion sur la visée lue (`aimKind === 'pin'`) en plus de la nature inchangée.

Leçon : **une assertion écrite pour un correctif doit exercer le chemin que le correctif a ajouté.**
Ici le correctif vivait dans `aimWheel`, et l'assertion n'appelait jamais `aimWheel`.

**Deux timbres sur cinq étaient illisibles.** À cinq options, « Corde (pizzicato) » et « Verre
(cloches) » partagent la même ordonnée à 76 px d'écart et mesurent ~95 px : **18 px de recouvrement,
garantis par l'arithmétique**. La capture montrait « Corde (pizzicdteje (cloches) ». Le risque « joli
mais illisible » que ce plan listait s'est réalisé, sur le câblage que ce plan désigne comme le vrai
point de douleur — et le critère 12 n'était pas tenu. Aucune assertion ne pouvait le voir : toutes
lisaient les libellés depuis `stats()`, jamais des pixels ni des boîtes.

**On choisissait à l'aveugle.** Une roue épinglée — donc **toute** roue d'instrument, ouverte au clic —
ne mettait jamais le secteur survolé en évidence : `hover` n'est émis qu'au changement de cible, et la
cible ne change pas dans un disque. Toute la branche « visé » du rendu était morte pour ce cas.

**Et deux issues opposées avaient le même dessin** : la zone morte (qui garde la roue) et l'extérieur de
l'anneau (qui la jette) produisaient des captures identiques au pixel près. Corrigé par un liseré rouge
et un estompage — dont la **première version était mesurable et invisible** (251 pixels rouges contre 0,
et rien à l'œil sur la capture). Épaissie, puis remesurée avec un contrôle propre : 0 → 589. Un signal
qui ne passe que le test n'est pas un signal.

### Deuxième passe de review : le seuil qui validait ce que je venais de rejeter

Le constat le plus utile des deux passes. Après avoir jugé « à refaire » un liseré d'annulation
invisible — mesuré à 251 pixels rouges contre 0 —, l'assertion écrite juste après portait le seuil
`> 100`. **251 > 100** : elle aurait validé la version rejetée. Un seuil rond est un nombre déguisé.

Corrigé en posant la sonde là où **seule** la version acceptée arrive (le rayon `outerRadius - 4`, que
couvre un trait de 5 px et pas un de 2 px) et en déduisant l'attendu du tracé lui-même — épaisseur et
motif de tirets. Et en mesurant le **voile** séparément, par sa luminance : il ne l'était par rien, donc
le retirer passait.

Deux autres trous de la même famille : les libellés n'étaient mesurés que dans la police au repos, alors
que le secteur visé est écrit 8 % plus gros et que c'est la seule police qui puisse déborder ; et le
tactile — le support sur lequel l'épinglage se justifie, puisqu'il n'y a pas de survol au doigt — n'avait
aucune assertion, alors qu'un glisser y **dessinait une barre** au lieu de viser.

### Troisième passe : cinq assertions sur six contournables

La passe la plus instructive, et la plus humiliante. Les six assertions écrites *en réponse* aux deux
premières passes ont été attaquées une par une : **cinq se laissaient contourner**, toutes pour la même
raison de fond. Elles mesuraient une **position** ou une **existence** là où la propriété porte sur une
**épaisseur** ou un **seuil**.

- Le liseré était compté à **un seul rayon** : n'importe quel filet posé là satisfaisait la sonde, et un
  trait de 2 px — l'épaisseur rejetée pour invisibilité — décalé de 2 px vers l'intérieur passait.
- Le seuil de voile à 0,75 laissait 40 % de mou quand la mesure réelle vaut 0,51 : on pouvait diviser le
  voile par deux et rester vert.
- Rien n'exigeait l'**absence** d'alarme quand on vise un secteur, donc l'alarme pouvait vouloir dire
  « une visée existe » plutôt que « ça va être jeté ».
- L'assertion du trajet ne comptait que l'encre, alors que le défaut d'origine était le **voile**.
- La sonde tactile ne partait que d'une barre, donc deux des cinq entrées de la modalité n'étaient jamais
  exercées : les retirer laissait l'assertion verte.
- Le micro-mouvement de 8 px en dur n'épinglait que l'*existence* du garde ; son seuil pouvait tomber de
  26 à 10 px sans rougir, soit un tremblement de pouce ordinaire qui applique une option.

Ce qu'il faut en retenir tient en une phrase : **une sonde à un seul point mesure une position, pas une
grandeur.** Quand la propriété porte sur une épaisseur, un seuil ou une plage, la sonde doit encadrer —
deux côtés de la frontière, plusieurs rayons, toutes les polices — et son paramètre doit être **lu dans
l'app**, jamais recopié dans le test.

### La liste de cas qui aurait dû être un invariant

Une roue épinglée captait d'abord les gestes « décisifs ». Puis il a fallu le survol pour viser à la
souris. Puis le tracé pour viser au doigt. Puis le glisser — parce qu'un glisser commencé **sur une
barre** émet `drag` et déplaçait la barre sous la roue.

Le troisième ajout était l'aveu : la bonne règle n'est pas une liste, c'est une propriété. Le disque est
**modal** — il consomme tout jusqu'à décision. Et son corollaire visuel, que la review a formulé mieux
que moi : *un disque qui capte les gestes doit avoir l'air de les capter*. D'où le survol neutralisé sous
la roue et l'opacité portée à 0,94.

### Les mutations

Géométrie (Vitest) : zone morte neutralisée · anneau extérieur sans borne · recadrage neutralisé ·
premier secteur non centré · libellé posé hors de l'anneau · clamp d'index retiré.
Interaction (harnais) : visée jamais mise à jour · relâcher au centre annule au lieu d'épingler · zone
morte mesurée depuis le centre · roue épinglée qui ne capte plus les gestes décisifs · fermeture retirée
de `clearAll`, de `undo`, du redimensionnement (trois mutations distinctes) · libellé long imposé sans
repli court · survol qui ne vise plus.

Rendu (harnais) : voile d'annulation retiré · liseré ramené à 2 px, la version rejetée que la review
avait fait passer · police du secteur visé grossie · annulation affichée aussi sur une roue épinglée ·
glisser plus capté par une roue épinglée · garde `handled` du relâchement retirée.

**Vingt-deux mutations, vingt-deux tuées** — dont celle que la première passe de review avait vue
**survivre**, et les trois que la seconde avait prouvées passantes. C'est le vrai verdict sur une
assertion : ce sont elles qui ont montré que la preuve manquait, pas le code.
