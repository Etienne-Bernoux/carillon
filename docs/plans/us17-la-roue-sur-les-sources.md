# US17 — La roue sur les sources

> Statut : **livrée** · Branche `feat/us17-roue-sources` · PR #15 · 323 tests unitaires, 18 scénarios
> navigateur (238 assertions), 9 mutations tuées sur 9 · une passe de review adverse déléguée, qui a
> trouvé trois assertions creuses ou fausses et un défaut produit

## Intent

L'US16 a retiré deux cyclages sur trois. **Il en reste un** : taper une source périodique passe à la
division suivante, en boucle sur cinq valeurs. Le même défaut que les deux autres, avec le même coût —
revenir d'un cran demande quatre taps, et rien n'annonce ni combien de rythmes existent ni lequel est en
place. Sur une source, c'est même pire que pour un timbre : la période ne s'entend qu'**à la mesure
suivante**, donc un tap qui a « sauté trop loin » se paie en attente avant de pouvoir corriger.

Demandé en retour direct d'Etienne après l'US16 : la roue sert les objets de la scène, points de
lancement compris.

## La décision d'interaction : le tap **ouvre** la roue

Le tap est le geste des sources depuis l'US4 — il ne change pas. Ce qu'il produit change : au lieu
d'avancer d'un cran à l'aveugle, il **ouvre le choix**, épinglé, exactement comme le bouton d'instrument.

Trois raisons de ne pas passer par l'appui long :

1. `input.ts` **supprime** délibérément l'appui long sur une source depuis l'US4 — « taper une source
   change déjà son rythme, et un second idiome sur la même cible serait du bruit ». Le motif tient
   toujours : on remplace ce que fait le tap, on n'ajoute pas un second geste à côté.
2. Un tap qui n'aurait plus rien à faire serait un geste mort sur la cible la plus tapée du produit.
3. Le bouton d'instrument établit déjà le patron « un geste bref ouvre une roue épinglée ». Deux entrées
   qui se ressemblent doivent se comporter pareil.

## La décision de libellé : compter les billes, pas nommer la fraction

Les libellés existants sont des phrases — « une par demi-mesure », « trois par mesure ». Dans un secteur
à cinq options, le budget vaut 64 px et aucune ne tient : la roue afficherait cinq fois le même repli.

Les noms courts sont donc le **nombre d'émissions par mesure** : `1×`, `2×`, `3×`, `4×`, `8×`. Trois
propriétés qu'une phrase n'a pas :

- ils sont **ordonnés**, donc la roue se lit comme une échelle et non comme une liste ;
- ils tiennent tous largement, donc aucun repli ne s'active ;
- ils disent la seule chose qu'on veut savoir en visant : combien de billes vont tomber.

Les phrases restent dans l'**annonce accessible**, qui n'a pas de budget de largeur.

## Périmètre

**Dedans** : `divisionShortLabel` dans `src/core/clock.ts` (pur, testé), le tap d'une source qui ouvre sa
roue dans `main.ts`, l'annonce, l'undo, et le scénario navigateur.

**Dehors**

- **Le tempo** (US13) : c'est la grille elle-même, pas la division d'une source. Réglage continu, donc
  une roue n'est pas le bon outil — décision à part.
- **La gamme** : inchangée, pour la même raison qu'à l'US16 (elle réaccorde toute la scène).
- **Les points de lâcher** (`droppers`) : ils n'ont **aucune option** à choisir — ils rendent une bille
  sur la mesure, point. Leur donner une roue serait un widget sans contenu.

## Critères d'acceptation

Chacun avec sa preuve, chacun validé par mutation.

### Cœur pur (Vitest)

1. **Cinq noms courts, distincts, et tous plus courts que leur phrase.** Un nom court qui n'est pas plus
   court ne sert à rien.
2. **Ils comptent les émissions par mesure** : le nom court de l'index `i` annonce exactement
   `1 / DIVISIONS[i]` émissions, dérivé du catalogue et non recopié. Si une division est ajoutée, la
   règle continue de valoir ou le test rougit.
3. **Ils tiennent dans le budget d'une roue à cinq secteurs** (`labelWidthBudget(5)`), mesurés avec une
   approximation de largeur de caractère majorante — sinon l'assertion ne dit rien du produit.

### Produit (harnais navigateur)

4. **Taper une source ouvre sa roue**, avec les cinq divisions et la courante marquée.
5. **Choisir applique** : la division change, la source se remet en phase sur la grille, et la roue se
   ferme.
6. **Aucun cyclage ne subsiste** : taper une source ne change **plus** sa division par lui-même. C'est
   l'assertion qui prouve que le cycle est parti et pas seulement doublé.
7. **Rien n'est volé** : l'appui long dans le vide pose toujours une source, le glisser déplace toujours
   la source, le bord la jette toujours.
8. **Annulable** : changer la division reste dans l'historique, et annuler la restaure.
9. **Les cinq libellés sont lisibles** — mêmes boîtes que pour les timbres : aucun plus large que son
   budget, aucun recouvrement, aucun hors du disque.

### Non-régression

10. `pnpm check` vert, les **18** scénarios verts — les 17 d'avant plus `sources` —, la roue des natures
    et celle des timbres inchangées.

## Risques

- **Voler le geste de rythme.** Le tap est le seul geste des sources ; si la roue s'ouvre mais qu'aucun
  chemin ne mène à un changement, on a retiré une fonction. D'où le critère 5 **et** le 6, qui se
  contredisent si l'un des deux est faux.
- **Une roue sur un objet minuscule.** Une source fait 13 px de rayon et la roue 104 : le recadrage de
  l'US16 s'applique, mais la source disparaît sous son propre sélecteur. Se juge en regardant.
- **Cinq secteurs de plus à lire.** J'ai écrit ici que le catalogue « n'est pas ordonné comme une
  échelle » : **c'est faux**, et la capture le montre. Les comptes par mesure valent 1, 2, 3, 4, 8 —
  strictement croissants, donc la roue se lit bien comme une échelle, de la mesure entière à la double
  croche. Le risque n'existait pas ; je le laisse écrit avec sa correction plutôt que de le retirer, parce
  que c'est le genre d'affirmation qu'on recopie ensuite sans la revérifier.

## Ce que la vérification a montré

**La roue ne cache pas la source.** Le risque « un sélecteur de 104 px sur un objet de 13 px » ne s'est
pas réalisé : la source tombe dans la **zone morte** centrale, donc elle reste visible au milieu de son
propre sélecteur. Vu sur `docs/proofs/sources/01-roue-divisions.png`.

**Une assertion de `rythme` était devenue creuse.** Le scénario vérifiait « la nouvelle échéance retombe
sur la grille de la nouvelle division » juste après un tap qui, depuis cette US, ne change plus rien : la
grille d'une division inchangée est vraie par construction. L'assertion voisine, elle, rougissait
franchement — c'est elle qui a signalé le couple. Les deux sont réécrites autour du vrai geste.

**Un scénario neuf plutôt qu'un bloc de plus.** Ces assertions ont d'abord été écrites à la fin de
`roue`, où elles échouaient : une roue épinglée laissée par le bloc précédent avalait le tap. Le
diagnostic est le même que celui de la review sur `runRoue` — un scénario long transporte son état — et
la réponse est un scénario dédié, comme `natures` ou `timbres`.

### Ce que la review adverse a trouvé, et ce que j'ai conclu trop vite

**Un défaut produit que j'avais déclaré absent sur une observation fausse.** Ce plan affirmait, preuve à
l'appui, que « la source tombe dans la zone morte, donc elle reste visible au milieu de son propre
sélecteur ». Mesuré au pixel : sous le disque à 0,94 d'opacité, elle garde **3 à 7 valeurs sur 255**
d'écart contre 33 à 55 à découvert — 11 % de son contraste. Et à 375 px, `fitWheel` la laisse à ~97 px du
centre sans rien qui les relie. Sur une scène à plusieurs sources, rien ne disait laquelle on règle.
Corrigé : le **sujet du réglage** est redessiné par-dessus la roue, cerclé, et relié au disque par un
trait quand il en est loin. Mesuré avec contrôle : 360 pixels clairs autour de la source contre 0 sans
roue. Et le scénario a désormais sa passe 375 px, que la DoD §3.4 rend bloquante et qui manquait.

**Une borne que je présentais comme majorante ne l'était pas.** `WIDEST_CHAR_PX = 9` était en réalité la
**moyenne** par caractère du libellé le plus étroit. Six des huit caractères possibles dépassent 9 px
(jusqu'à 9,56 pour `8`). À dix divisions, « 48× » aurait passé le test à 27 px pour 28,28 px réels.

**Une assertion que je croyais avoir réparée l'était toujours à moitié.** Elle mesurait « l'échéance est
sur la grille de la nouvelle division » en partant de la mesure entière vers le quart : tout multiple de
la mesure est déjà un multiple du quart, donc l'écart valait zéro **sans aucun ré-armement**. Corrigé en
partant du tiers. Mais la suite est plus intéressante : même ainsi, la propriété **n'est pas observable
depuis le navigateur**, parce que `runEmitters` recalcule l'échéance depuis la grille courante à chaque
émission — une source privée de ré-armement se raccroche donc d'elle-même en moins d'une période. C'est
le test pur qui porte cette propriété, et le commentaire du scénario le dit maintenant.

**Une mutation survivante qui ne condamnait pas le test.** La review a montré que grossir la police du
secteur visé à 40 px passait le scénario `sources`. Vrai — et sans conséquence : « 1× » à 40 px fait 46 px
et tient encore dans les 64 px du budget. Il n'y a pas de condition de divergence à cette longueur de
libellé. Vérifié en poussant à 100 px : l'assertion rougit. La boucle de visée ajoutée est donc porteuse,
c'est la mutation qui était équivalente.

### Une preuve qui dépendait de la charge, et ma propre conclusion trop rapide

En vérifiant l'US17, le scénario `timbres` est sorti rouge sur « Percussions produit réellement des
notes : 0 notes ». Reproduit trois fois, y compris sur `origin/main` — j'en ai conclu, et annoncé, un
défaut systématique. **C'était faux** : les trois runs tournaient pendant que des agents de review
pilotaient Chrome en parallèle. Machine au repos, percussions donne 11 notes, trois fois sur trois.

Ce qui restait vrai est la faiblesse de la mesure : le budget de polyphonie compte les voix depuis
l'horloge audio, que `advance()` ne fait pas avancer, donc chaque salve simulée laisse ses créneaux
réservés. Sous charge, les quatre premiers timbres consommaient les 24 créneaux et le cinquième était
refusé en bloc. La pause de 1,5 s visait ce problème sans le résoudre. Le moteur expose désormais
`releaseVoices()`, appelé avant chaque salve : la mesure ne dépend plus de ce qui a été joué avant.

### Les mutations

Cœur pur : nom court remplacé par la phrase longue · nom court qui mentirait sur le débit · remise en
phase retirée de `setDivision` · bornage d'index retiré.
Produit : cyclage ressuscité **en plus** de la roue (c'est l'assertion « taper ne change plus rien » qui
le tue) · garde de confirmation retiré · `release` qui échappe à la modalité · `drag` qui y échappe ·
police du secteur visé poussée jusqu'au débordement réel.

Neuf mutations, neuf tuées. Deux étaient signalées survivantes par la review : l'une l'était vraiment
(l'assertion de `rythme`, corrigée puis reconnue non observable dans la page), l'autre était
**équivalente** à cette longueur de libellé.
