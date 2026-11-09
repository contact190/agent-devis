// Test du moteur de calcul de CalculDevis, lancé hors du navigateur.
// Il vérifie la règle "fixe bas + ouvrant" vue avec le patron :
//   H ouvrant = H totale − caisson − H fixe + 25 (traverse)
//
// Utilisation :
//   node scripts/test-moteur.mjs <chemin vers les données>
// Les données peuvent être un export JSON de CalculDevis, ou le fichier
// src/data/default-data.js du dépôt CalculDevis.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { FormulaEngine } from '../src/engine/formula-engine.js';
import { getCatalogue } from '../src/catalogue.js';

// Sans argument : catalogue CalculDevis en direct (mis à jour automatiquement).
const chemin = process.argv[2];
const db = !chemin
  ? await getCatalogue()
  : chemin.endsWith('.json')
    ? JSON.parse(await readFile(chemin, 'utf8'))
    : (await import(pathToFileURL(chemin).href)).DEFAULT_DATA;

const engine = new FormulaEngine(db);

const trouver = (liste, motif) => (liste || []).find(x => motif.test((x.name || '').trim()));
const ouvrant = trouver(db.compositions, /^H40 2 Vantaux/i);
const fixe = trouver(db.compositions, /^H40 FIX/i);
const traverse = trouver(db.profiles, /^Traverse h40/i);
const caisson = (db.shutterComponents?.caissons || []).find(c => c.id === 'CAI-185');

function config({ avecVolet }) {
  return {
    L: 1000,
    H: 1900,
    compositionId: '',
    rangeId: ouvrant?.rangeId,
    colorId: db.colors?.[0]?.id,
    glassId: db.glass?.[0]?.id,
    selectedOptions: [],
    compoundType: 'fix_ouvrant',
    compoundConfig: {
      orientation: 'vertical',
      traverseId: traverse?.id,
      parts: [
        { id: 'p1', type: 'opening', compositionId: ouvrant?.id },
        { id: 'p2', type: 'fixe', compositionId: fixe?.id, height: 900 },
      ],
    },
    hasShutter: avecVolet,
    shutterConfig: avecVolet ? { caissonId: 'CAI-185' } : undefined,
  };
}

function hauteurOuvrant(bom) {
  const ligne = bom.profiles.find(p => p.source === 'Partie 1 (opening)' && /^H/.test(p.formula || ''));
  if (!ligne) return null;
  // resolvedFormula ressemble à "1025-39" : le premier nombre est le H de l'ouvrant
  return parseFloat(String(ligne.resolvedFormula).match(/-?\d+(\.\d+)?/)?.[0]);
}

const cas = [
  { nom: 'Sans volet', avecVolet: false, attendu: 1900 - 900 + 25 },
  { nom: `Avec caisson ${caisson?.height ?? '?'}`, avecVolet: true, attendu: 1900 - (parseFloat(caisson?.height) || 0) - 900 + 25 },
];

let echecs = 0;
for (const c of cas) {
  const bom = engine.calculateBOM(config(c));
  const h = hauteurOuvrant(bom);
  const ok = h === c.attendu;
  if (!ok) echecs++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${c.nom} : H ouvrant = ${h} (attendu ${c.attendu})`);
}
process.exit(echecs ? 1 : 0);
