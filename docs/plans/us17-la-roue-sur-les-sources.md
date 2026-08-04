# US17 — La roue sur les sources

> Statut : **livrée** · Branche `feat/us17-roue-sources` · 322 tests unitaires, 18 scénarios navigateur
> (235 assertions), 6 mutations tuées sur 6

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

10. `pnpm check` vert, les 17 scénarios verts, la roue des natures et celle des timbres inchangées.

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

### Les six mutations

Cœur pur : nom court remplacé par la phrase longue · nom court qui mentirait sur le débit · remise en
phase retirée de `setDivision` · bornage d'index retiré.
Produit : cyclage ressuscité **en plus** de la roue (c'est l'assertion « taper ne change plus rien » qui
le tue) · garde de confirmation retiré.
