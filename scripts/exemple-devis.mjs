// Crée un client et un devis d'exemple, puis génère le PDF dans data/exemple-devis.pdf
process.env.AGENT_DB ??= 'data/exemple-db.json';
const { writeFile } = await import('node:fs/promises');
const { calculerMenuiserie, optionsVoletCompatibles } = await import('../src/agent/outils.js');
const S = await import('../src/stockage.js');
const { genererDevisPdf } = await import('../src/pdf/devis-pdf.js');

await S._reinitialiser();
const client = await S.creerClient({ nom: 'TEST AGENT - à supprimer', telephone: '0550 00 00 00', adresse: 'Oran' });

const l1 = await calculerMenuiserie({
  designation: 'Fenêtre séjour (fixe bas + ouvrant)', quantite: 2, L: 1000, H: 1900, couleurId: 'RAL7024M', vitrageId: '5/12/5',
  assemblage: { type: 'fix_ouvrant', orientation: 'vertical', traverseId: 'P-1777190967369-943',
    parties: [{ type: 'opening', compositionId: 'COMP-1776870207633' }, { type: 'fixe', compositionId: 'COMP-1776940195996', dimension: 900 }] },
});
const ov = await optionsVoletCompatibles({ L: 1200, H: 1350, caissonId: 'CAI-185', axeId: 'AXE-40', lameId: 'LAM-43T', commande: 'sangle', profondeur: 140 });
const l2 = await calculerMenuiserie({
  designation: 'Fenêtre chambre', quantite: 3, L: 1200, H: 1350, couleurId: 'RAL7024M', vitrageId: '5/12/5', compositionId: 'COMP-1776870207633',
  volet: { caissonId: 'CAI-185', axeId: 'AXE-40', lameId: 'LAM-43T', lameFinaleId: ov.lameFinales[0]?.id, commande: 'sangle', kitId: ov.kits[0]?.id, profondeur: 140 },
});
if (!l1.ok || !l2.ok) { console.error(l1, l2); process.exit(1); }
const devis = await S.creerDevis({ clientId: client.id, lignes: [l1, l2] });
await writeFile('data/exemple-devis.pdf', await genererDevisPdf(devis, client));
console.log(`Devis ${devis.id} : ${devis.totalHT} DA HT, ${devis.totalTTC} DA TTC -> data/exemple-devis.pdf`);
