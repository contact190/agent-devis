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

## Logique du catalogue (validée par le patron — ne pas corriger)

Le catalogue CalculDevis fait foi. L'agent applique ses règles telles quelles et ne propose pas de les modifier.
Quelques conséquences à connaître :

1. **Axe 40 → lame 43 uniquement** (la lame 39 exige un axe différent de 40).
2. **Axe 40 → jamais en caisson tunnel** : les kits « Tunnel Axe 40 » ne sont donc pas proposés.
3. **Lame 57 Extrudée** (largeur enregistrée 45) → pas de caisson 155/185/200 (limités à 43), donc tunnel.
4. **Axe 40** : limité par les dimensions (2500 × 2500), pas par le poids.
5. Les éléments sans règle de compatibilité (Lame 77, NICE 30N, TTGO 80N, Moteur 20NM…) sont toujours proposés.
6. Les formules sont évaluées exactement comme dans CalculDevis, y compris celles écrites sans « && » :
   les deux logiciels donnent donc toujours le même résultat.
