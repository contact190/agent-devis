// Parcours complet du paramétrage volet sur le catalogue réel.
import { getCatalogue } from '../src/catalogue.js';
import { optionsVolet, choisirLargeurGlissiere } from '../src/regles/volet.js';

const cat = await getCatalogue();
const noms = l => l.map(x => x.name.trim()).join(' | ') || '(aucun)';

const cas = [
  { titre: 'Fenêtre 1200x1350, caisson 185, axe 40, moteur, profondeur 130', L: 1200, H: 1350, caissonId: 'CAI-185', axeId: 'AXE-40', commande: 'moteur', profondeur: 130 },
  { titre: 'Même fenêtre, sangle, profondeur 90', L: 1200, H: 1350, caissonId: 'CAI-185', axeId: 'AXE-40', commande: 'sangle', profondeur: 90 },
  { titre: 'Baie 2400x2200, caisson 200, axe 70, lame 57, moteur', L: 2400, H: 2200, caissonId: 'CAI-205', axeId: 'AXE-1778487594265-118', lameId: 'LAM-1776881919852-489', commande: 'moteur', profondeur: 200 },
  { titre: 'Caisson tunnel 30, axe 40, sangle', L: 1000, H: 1200, caissonId: 'CAI-1792077608715-397', axeId: 'AXE-40', commande: 'sangle', profondeur: 150 },
];
for (const c of cas) {
  const o = optionsVolet(cat, c);
  console.log(`\n### ${c.titre}`);
  console.log('Caissons   :', noms(o.caissons));
  console.log('Axes       :', noms(o.axes));
  console.log('Lames      :', noms(o.lames));
  console.log('Lame finale:', noms(o.lameFinales), '(dépend de la lame choisie)');
  console.log('Kits       :', noms(o.kits));
  if (c.commande === 'moteur') console.log('Moteurs    :', noms(o.moteurs), `(poids ${o.variables.totalWeight.toFixed(1)} kg)`);
  const g = o.glissiere;
  console.log('Glissière  :', g.glissiere?.name, g.largeur ? `${g.largeur} mm` : '', g.alerte ? `⚠️ ${g.alerte}` : '');
}

console.log('\n### Règle de largeur (L invisible 85/120/145, L visible 120/150/180)');
const gl = cat.shutterComponents.glissieres;
for (const g of gl.filter(g => g.opt1Values)) {
  console.log(g.name + ' : ' + [80, 100, 130, 131, 140, 165, 200].map(p => {
    const r = choisirLargeurGlissiere(g, p); return `${p}→${r.largeur}${r.alerte ? '⚠️' : ''}`;
  }).join('  '));
}
