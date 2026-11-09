// Exemple de rappels sur des dossiers fictifs.
import { calculerRappels } from '../src/regles/rappels.js';
const j = n => new Date(Date.now() - n * 864e5).toISOString();
const dossiers = [
  { client: 'Client A', statut: 'devis_envoye', totalTTC: 400000, dateEnvoi: j(9) },
  { client: 'Client B', statut: 'devis_envoye', totalTTC: 400000, avance: 150000 },
  { client: 'Client C', statut: 'commande', totalTTC: 600000, avance: 300000, planChantier: null },
  { client: 'Client D', statut: 'commande', planChantier: {}, datePlan: j(4) },
  { client: 'Client E', statut: 'commande', planChantier: {}, mesuresValidees: true, dateMesures: j(3), devisRevise: { valideParClient: false }, dateDevisRevise: j(2) },
];
for (const r of calculerRappels(dossiers)) console.log(`[${'!'.repeat(4 - r.priorite)}] ${r.client} — ${r.message}`);
