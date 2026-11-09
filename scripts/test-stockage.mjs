// Vérifie clients, devis, avance 50 % -> commande, devis révisé (base de test séparée).
process.env.AGENT_DB = 'data/test-db.json';
const S = await import('../src/stockage.js');
await S._reinitialiser();
const ligne = { designation: 'F1', quantite: 1, configuration: { L: 1000, H: 1000 }, prix: { prixUnitaireHT: 100000, totalHT: 100000, tvaPourcent: 9 } };
const c = await S.creerClient({ nom: 'Client test' });
const d = await S.creerDevis({ clientId: c.id, lignes: [ligne] });
let echecs = 0;
const ok = (nom, cond) => { if (!cond) echecs++; console.log(`${cond ? 'OK   ' : 'ECHEC'} ${nom}`); };
ok(`Devis créé : ${d.totalTTC} DA TTC`, d.totalTTC === 109000);
let r = await S.enregistrerAvance(d.id, 40000);
ok(`Avance 40 000 (< 50 %) : reste ${r.devis.statut}, manque ${r.manque}`, r.devis.statut === 'brouillon' && r.manque === 14500);
r = await S.enregistrerAvance(d.id, 14500);
ok(`Avance cumulée 54 500 (= 50 %) : passe en ${r.devis.statut}`, r.devis.statut === 'commande');
const v2 = await S.creerDevis({ clientId: c.id, lignes: [ligne], remplaceId: d.id });
ok(`Devis révisé ${v2.id} : ancien devis marqué « remplacé »`, (await S.lireDevis(d.id)).statut === 'remplace');
ok('Recherche client', (await S.listerClients('test')).length === 1);
process.exit(echecs ? 1 : 0);
