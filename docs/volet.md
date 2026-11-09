# Volet roulant — chaîne des paramètres

Source : catalogue CalculDevis (formules de compatibilité), vérifié le 9 novembre 2026.
Code : `src/regles/volet.js` — test : `npm run test:volet`.

## Ordre de décision

| # | Choix | Dépend de | Variable produite |
|---|---|---|---|
| 1 | Caisson (155 / 185 / 200 / tunnel) | H, lame | `HC`, `caissonSize` (0 = tunnel) |
| 2 | Axe (40 / 60 / 60×0.9 / 70) | L, H, poids, caisson | `axeDiameter` |
| 3 | Lame | axe, caisson, L, H | `lameWidth`, poids du tablier |
| 4 | Lame finale | lame | — |
| 5 | Commande | client : moteur ou sangle | — |
| 6 | Kit | caisson + axe + moteur/sangle | — |
| 7 | Moteur | axe + poids à lever | — |
| 8 | Glissière | tunnel → Simple H25 ; moteur → L invisible ; sangle → L visible | — |
| 9 | Largeur glissière | profondeur de l'ouverture | alerte « raser » si besoin |
| 10 | Extras | automatiques (embouts, plaques, testeros, attaches, joints…) | — |

## Règle de largeur de glissière

- Largeur valable si **largeur + 10 mm < profondeur**.
- On prend la **plus grande largeur valable**. Exemple : profondeur 130 → 120 refusée → **85**.
- Si aucune largeur n'est valable : on prend la plus petite et la fiche de coupe affiche
  **« PROBLÈME PROFONDEUR — raser le tableau »**.

## Volet double

Chaque élément (sauf le caisson) est vérifié avec **la moitié de la largeur et du poids**,
avec les formules « double » quand elles existent. Glissière centrale ajoutée automatiquement.

## Incohérences trouvées dans le catalogue (à corriger dans CalculDevis)

1. **Axe 40 et lames** : aujourd'hui la lame 39 exige `axeDiameter != 40` et la lame 43 exige `axeDiameter == 40`.
   Donc axe 40 → lame 43 uniquement. À confirmer avec la règle du patron.
2. **Caisson tunnel + axe 40** : l'axe 40 exige `caissonSize != 0` (pas de tunnel), mais il existe un
   « Kit Tunnel Axe 40 Sangle » et un « Kit Tunnel Axe 40 Moteur » → ces kits ne peuvent jamais être choisis.
3. **Lame 57 Extrudée** : son `lameWidth` vaut 45, et les caissons 155/185/200 exigent `lameWidth <= 43`
   → la lame 57 ne passe dans aucun caisson classique, alors que les kits moteur axe 70 / 185 et 200 existent.
4. **Axe 40 sans limite de poids** : proposé jusqu'à 2500 × 2500 quel que soit le poids du tablier.
5. **Formules sans « && »** (`totalWeight > 120  caissonSize == 0`) : la condition « > 120 kg » est perdue,
   ces pièces sortent même pour des volets légers en tunnel axe 70 et H > 2500 :
   Plaque Pliante Multifonction 30 (Copie), Plaque Pliante à Pallier, Attache Lourd, Bague 70.
6. **Éléments toujours proposés** (pas de règle de compatibilité) : Lame 77, « Nouvel élément » (lame, moteur, extras),
   NICE 30N ×3, TTGO 80N, Moteur 20NM, Kit Tunnel Sangle.
7. **Doublons** : NICE 30N (×3), Tulipe à Galet Lourd (×3), Attache Lourd (×3), Bague 60/70 (×2 chacune).
8. **Noms trompeurs** : « Axe 60*0.9 » a un diamètre 61 ; « Lame 57 Extrudée » a une largeur 45.
