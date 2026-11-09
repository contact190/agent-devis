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
- [x] Outils de l'agent (`src/agent/outils.js`) : catalogue, options volet compatibles, calcul d'une menuiserie — **même prix que CalculDevis au centime**
- [x] Agent (`src/agent/agent.js`) : consignes métier, questions si info manquante, récapitulatif à valider, puis calcul
- [ ] Brancher la clé API et tester l'agent en conversation réelle (`npm run discuter`)
- [x] Devis PDF (`src/pdf/devis-pdf.js`) : en-tête société, client, lignes, totaux, montant en lettres, conditions particulières
- [x] Interface clients simple + discussion avec l'agent + rappels (`npm start` → http://localhost:3000)
- [x] Clients et devis stockés à part de CalculDevis (`src/stockage.js`, fichier local en attendant les tables Supabase)
- [x] Avance : passage automatique en commande à 50 % du TTC, devis révisé qui remplace l'ancien
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
| Compatibilités volet (axe, lame, caisson, kit, moteur…) | le catalogue CalculDevis fait foi, rien n'est corrigé ni recopié en dur |
| Type de glissière | tunnel → Simple H25 ; moteur → L invisible ; sangle → L visible |
| Largeur glissière | toujours demander la profondeur ; plus grande largeur avec largeur + 10 < profondeur ; sinon la plus petite + « PROBLÈME PROFONDEUR — raser » sur la fiche de coupe |
| Volet (détail complet) | voir `docs/volet.md` et `src/regles/volet.js` |
| Écart mesure réelle > +100 mm | fabrication bloquée, devis révisé créé automatiquement |
| Écart mesure réelle < −100 mm | alerte seulement |
| Passage en commande | avance ≥ 50 % du devis |
| Plan de chantier | obligatoire, même pour une seule fenêtre |
| Rappels | dans l'interface, au début de chaque discussion (pas d'e-mail) — `src/regles/rappels.js` |

## Commandes

```bash
npm test             # tous les tests (sans clé API)
npm start            # interface web : http://localhost:3000
npm run discuter     # discuter avec l'agent dans le terminal (clé API dans .env)
npm run exemple      # crée un devis d'exemple et son PDF dans data/
```

## Lancer le test du moteur

```bash
npm install
npm run test:moteur          # catalogue en direct
npm run charger:catalogue    # (facultatif) copie locale pour travailler hors ligne
```

## Clé API

Copier `.env.example` en `.env` et y mettre la clé Claude. Le fichier `.env` n'est **jamais** envoyé sur GitHub.
