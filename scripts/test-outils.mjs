// Vérifie les outils de l'agent sans appeler Claude (pas besoin de clé API).
// Référence : le produit testé dans CalculDevis le 9/11/2026, avant ajout du volet :
//   fixe bas + ouvrant 1000 x 1900, H40 2 Vantaux + H40 FIX 900, traverse h40 (25 mm),
//   gris anthracite, 5/12/5 -> coût de revient 27 930,95 DA, total HT 36 549,29 DA.
import { calculerMenuiserie, optionsVoletCompatibles } from '../src/agent/outils.js';

let echecs = 0;
const verifier = (nom, obtenu, attendu, tolerance = 0.05) => {
  const ok = Math.abs(obtenu - attendu) <= tolerance;
  if (!ok) echecs++;
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${nom} : ${obtenu} (attendu ${attendu})`);
};

const base = {
  designation: 'TEST fixe bas + ouvrant', L: 1000, H: 1900, couleurId: 'RAL7024M', vitrageId: '5/12/5',
  assemblage: {
    type: 'fix_ouvrant', orientation: 'vertical', traverseId: 'P-1777190967369-943',
    parties: [{ type: 'opening', compositionId: 'COMP-1776870207633' }, { type: 'fixe', compositionId: 'COMP-1776940195996', dimension: 900 }],
  },
};

const r = await calculerMenuiserie(base);
if (!r.ok) { console.log(r); process.exit(1); }
verifier('Coût de revient', r.prix.revientUnitaire, 27930.95);
verifier('Total HT', r.prix.prixUnitaireHT, 36549.29);
const hOuvrant = r.details.profils.find(p => p.partie === 'Partie 1 (opening)' && /^Ouvrant H/i.test(p.nom));
verifier('H ouvrant (formule H-39)', parseFloat(hOuvrant.formule), 1025);

// Informations manquantes : l'agent doit les demander
const incomplet = await calculerMenuiserie({ L: 1200, H: 1350, couleurId: 'RAL7024M', vitrageId: '5/12/5', compositionId: 'COMP-1776870207633', volet: { caissonId: 'CAI-185' } });
console.log(`${!incomplet.ok && incomplet.manquants.includes('volet.profondeur') ? 'OK   ' : 'ECHEC'} Volet incomplet -> manquants : ${incomplet.manquants?.join(', ')}`);

// Volet incompatible selon le catalogue : axe 40 + lame 39 refusé
const incompatible = await calculerMenuiserie({
  L: 1200, H: 1350, couleurId: 'RAL7024M', vitrageId: '5/12/5', compositionId: 'COMP-1776870207633',
  volet: { caissonId: 'CAI-185', axeId: 'AXE-40', lameId: 'LAM-39E', lameFinaleId: 'LAM-1777994453167-882', commande: 'sangle', kitId: 'KIT-1780394686973-552', profondeur: 140 },
});
console.log(`${!incompatible.ok ? 'OK   ' : 'ECHEC'} Axe 40 + lame 39 refusé : ${incompatible.erreurs?.[0]}`);

// Volet complet et compatible
const ov = await optionsVoletCompatibles({ L: 1200, H: 1350, caissonId: 'CAI-185', axeId: 'AXE-40', lameId: 'LAM-43T', commande: 'sangle', profondeur: 140 });
const complet = await calculerMenuiserie({
  L: 1200, H: 1350, couleurId: 'RAL7024M', vitrageId: '5/12/5', compositionId: 'COMP-1776870207633',
  volet: { caissonId: 'CAI-185', axeId: 'AXE-40', lameId: 'LAM-43T', lameFinaleId: ov.lameFinales[0]?.id, commande: 'sangle', kitId: ov.kits[0]?.id, profondeur: 140 },
});
console.log(`${complet.ok ? 'OK   ' : 'ECHEC'} Fenêtre 1200x1350 + volet sangle : ${complet.ok ? complet.prix.totalHT + ' DA HT, glissière ' + ov.glissiere.nom + ' ' + ov.glissiere.largeur + ' mm' : JSON.stringify(complet.erreurs || complet.manquants)}`);
if (!complet.ok) echecs++;

process.exit(echecs ? 1 : 0);
