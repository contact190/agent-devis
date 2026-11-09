# Agent Devis — Idéal Aluminium

Agent IA qui transforme une demande écrite en devis, plan de chantier et fiches atelier,
en utilisant **le même moteur de calcul que CalculDevis**.

## Principe

- **Claude comprend** la demande et prépare la configuration de chaque menuiserie.
- **Le moteur de CalculDevis calcule** (débit, accessoires, vitrage, volet, prix). Aucun chiffre n'est inventé par l'IA.
- **Chaque devis est validé** par une personne avant d'être généré.
- Les données de CalculDevis (profilés, compositions, prix, formules) sont lues **en lecture seule**.
  Les clients, devis et plans de l'agent sont dans des tables séparées.

## Étape 1 — en cours

- [x] Moteur de calcul branché hors du navigateur (`src/engine/formula-engine.js`, copié de CalculDevis)
- [x] Test de la règle fixe bas + ouvrant : H ouvrant = H totale − caisson − H fixe + 25
- [x] Catalogue CalculDevis lu en lecture seule et **mis à jour automatiquement** (`src/catalogue.js`) : vérification au plus 1 fois/minute, rechargement dès qu'un prix ou une formule change dans CalculDevis
- [ ] Agent : texte → récapitulatif à valider → calcul
- [ ] Devis PDF
- [ ] Interface clients simple
- [ ] Avance ≥ 50 % → commande → plan de chantier obligatoire (description texte)
- [ ] Fiche du métreur, mesures réelles, règle des 100 mm (devis révisé automatique)
- [ ] Fiches de coupe, vitrage, besoins d'achat

## Plus tard

- **Étape 4** : prix du fournisseur mis à jour automatiquement depuis Dropbox.

## Règles métier

| Règle | Valeur |
|---|---|
| Traverse | toujours 25 mm |
| H ouvrant avec fixe bas | H totale − HC caisson − H fixe + 25 |
| Caisson | toujours déduit de la hauteur totale |
| Axe 40 | jamais avec lame 43 |
| Largeur glissière | toujours demander la profondeur de l'ouverture (règle à compléter) |
| Écart mesure réelle > +100 mm | fabrication bloquée, devis révisé créé automatiquement |
| Écart mesure réelle < −100 mm | alerte seulement |
| Passage en commande | avance ≥ 50 % du devis |
| Plan de chantier | obligatoire, même pour une seule fenêtre |

## Lancer le test du moteur

```bash
npm install
npm run test:moteur          # catalogue en direct
npm run charger:catalogue    # (facultatif) copie locale pour travailler hors ligne
```

## Clé API

Copier `.env.example` en `.env` et y mettre la clé Claude. Le fichier `.env` n'est **jamais** envoyé sur GitHub.
