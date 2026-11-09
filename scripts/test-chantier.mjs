// Parcours complet : devis -> avance -> plan -> fiche métreur -> mesures -> règle des 100 mm.
process.env.AGENT_DB = 'data/test-chantier-db.json';
const { writeFile } = await import('node:fs/promises');
const S = await import('../src/stockage.js');
const { executerOutil } = await import('../src/agent/outils.js');
const { genererFicheMetreurPdf } = await import('../src/pdf/fiche-metreur-pdf.js');

let echecs = 0;
const ok = (nom, cond, detail = '') => { if (!cond) echecs++; console.log(`${cond ? 'OK   ' : 'ECHEC'} ${nom}${detail ? ' — ' + detail : ''}`); };
await S._reinitialiser();

const client = await executerOutil('creer_client', { nom: 'TEST CHANTIER', adresse: 'Bir El Djir' });
const ov = await executerOutil('options_volet', { L: 1200, H: 1350, caissonId: 'CAI-185', axeId: 'AXE-40', lameId: 'LAM-43T', commande: 'sangle', profondeur: 140 });
const fenetreVolet = { designation: 'Fenêtre chambre', quantite: 3, L: 1200, H: 1350, couleurId: 'RAL7024M', vitrageId: '5/12/5', compositionId: 'COMP-1776870207633',
  volet: { caissonId: 'CAI-185', axeId: 'AXE-40', lameId: 'LAM-43T', lameFinaleId: ov.lameFinales[0].id, commande: 'sangle', kitId: ov.kits[0].id, profondeur: 140 } };
const fixeOuvrant = { designation: 'Fenêtre séjour', quantite: 2, L: 1000, H: 1900, couleurId: 'RAL7024M', vitrageId: '5/12/5',
  assemblage: { type: 'fix_ouvrant', orientation: 'vertical', parties: [{ type: 'opening', compositionId: 'COMP-1776870207633' }, { type: 'fixe', compositionId: 'COMP-1776940195996', dimension: 900 }] } };
const dv = await executerOutil('enregistrer_devis', { clientId: client.id, menuiseries: [fenetreVolet, fixeOuvrant] });
ok('Devis enregistré', dv.ok, `${dv.devisId}, ${dv.totalTTC} DA TTC`);

const plan = { devisId: dv.devisId, etages: [
  { nom: 'RDC', appartements: [{ nom: 'A', ouvertures: [{ ligne: 2, emplacement: 'séjour' }, { ligne: 1, emplacement: 'chambre 1' }] }] },
  { nom: '1er', appartements: [{ nom: 'B', ouvertures: [{ ligne: 2, emplacement: 'séjour' }, { ligne: 1, emplacement: 'chambre 1' }, { ligne: 1, emplacement: 'chambre 2' }] }] },
] };
let r = await executerOutil('creer_plan_chantier', plan);
ok('Plan refusé avant la commande', !r.ok, r.erreurs?.[0]);

r = await executerOutil('enregistrer_avance', { devisId: dv.devisId, montant: Math.ceil(dv.totalTTC / 2) });
ok('Avance 50 % -> commande', r.statut === 'commande');

r = await executerOutil('creer_plan_chantier', { devisId: dv.devisId, etages: [plan.etages[0]] });
ok('Plan incomplet refusé (quantités)', !r.ok, r.erreurs?.join(' | '));

r = await executerOutil('creer_plan_chantier', plan);
ok('Plan créé', r.ok, `${r.nbOuvertures} ouvertures`);

const devis = await S.lireDevis(dv.devisId);
await writeFile('data/exemple-fiche-metreur.pdf', await genererFicheMetreurPdf(devis, client));
ok('Fiche métreur PDF générée', true, 'data/exemple-fiche-metreur.pdf');

r = await executerOutil('saisir_mesures', { devisId: dv.devisId, mesures: [{ repere: 'RDC-A-2', L: 1210, H: 1340 }] });
ok('Volet sans profondeur refusé', !r.ok, r.erreurs?.[0]);

r = await executerOutil('saisir_mesures', { devisId: dv.devisId, mesures: [
  { repere: 'RDC-A-1', L: 1005, H: 1895 },
  { repere: 'RDC-A-2', L: 1210, H: 1340, profondeur: 130 },
] });
ok('Mesures partielles', r.etat === 'mesures_incompletes', `reste : ${r.restantes.join(', ')}`);

r = await executerOutil('saisir_mesures', { devisId: dv.devisId, mesures: [
  { repere: '1er-B-1', L: 1150, H: 1900 },                    // +150 mm en largeur -> bloquant
  { repere: '1er-B-2', L: 1190, H: 1220, profondeur: 200 },   // -130 mm en hauteur -> alerte
  { repere: '1er-B-3', L: 1200, H: 1350, profondeur: 90 },    // profondeur trop faible -> raser
] });
ok('Écart > +100 mm -> devis révisé automatique', r.etat === 'devis_revise',
  `${r.devisReviseId} : ${r.ancienTotalTTC} -> ${r.nouveauTotalTTC} DA TTC (${r.difference > 0 ? '+' : ''}${r.difference})`);
ok('Écart < -100 mm -> alerte', r.alertes.some(a => a.repere === '1er-B-2'));
const ancien = await S.lireDevis(dv.devisId), nouveau = await S.lireDevis(r.devisReviseId);
ok('Ancien devis remplacé, avance conservée', ancien.statut === 'remplace' && nouveau.avances.length === 1);
ok('Devis révisé : une ligne par ouverture aux cotes réelles', nouveau.lignes.length === 5 && nouveau.lignes.some(l => l.L === 1150));
const raser = nouveau.lignes.flatMap(l => l.alertes).find(a => /RASER/i.test(a));
ok('Alerte « raser » reportée sur la ligne', !!raser, raser);
ok('Fabrication bloquée en attente du client', nouveau.attenteAccordClient && !nouveau.mesuresValidees);

r = await executerOutil('accepter_devis_revise', { devisId: nouveau.id });
ok('Client accepte -> fabrication possible', r.ok && (await S.lireDevis(nouveau.id)).mesuresValidees);
process.exit(echecs ? 1 : 0);
