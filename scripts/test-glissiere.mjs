// Vérifie la règle de largeur de glissière sur le catalogue réel.
import { getCatalogue } from '../src/catalogue.js';
import { choisirLargeurGlissiere } from '../src/regles/glissiere.js';

const cat = await getCatalogue();
for (const g of cat.shutterComponents.glissieres.filter(g => g.opt1Values)) {
  for (const p of [70, 110, 130, 140, 170, 200]) {
    const r = choisirLargeurGlissiere(g, p);
    console.log(`${g.name.padEnd(22)} profondeur ${String(p).padStart(3)} -> ${r.ok ? r.largeur + ' mm' : 'IMPOSSIBLE (' + r.message + ')'}`);
  }
}
