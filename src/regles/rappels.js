// Rappels automatiques : affichés dans l'interface, au début de chaque discussion avec l'agent.
// Pas d'e-mail. La fonction calcule les rappels à partir de l'état des dossiers.

const JOUR_MS = 24 * 60 * 60 * 1000;
const joursDepuis = (date, maintenant) => (date ? Math.floor((maintenant - new Date(date).getTime()) / JOUR_MS) : null);

export const DELAIS_RAPPEL_JOURS = {
  devisSansReponse: 7,
  metrePasFait: 3,
  devisReviseNonValide: 2,
  fabricationPasLancee: 2,
};

export const AVANCE_MINIMUM = 0.5;

/**
 * @param {Array} dossiers  { client, statut, totalTTC, avance, dateEnvoi, dateCommande, planChantier, datePlan,
 *                            mesuresValidees, dateMesures, devisRevise, dateDevisRevise, fabricationLancee }
 * @returns {Array<{ priorite: 1|2|3, client: string, message: string }>} triés du plus urgent au moins urgent
 */
export function calculerRappels(dossiers, maintenant = Date.now()) {
  const rappels = [];
  const ajouter = (priorite, d, message) => rappels.push({ priorite, client: d.client, message });

  for (const d of dossiers) {
    if (d.statut === 'devis_envoye') {
      const j = joursDepuis(d.dateEnvoi, maintenant);
      if (j >= DELAIS_RAPPEL_JOURS.devisSansReponse) ajouter(3, d, `Devis envoyé il y a ${j} jours, sans réponse. Relancer le client ?`);
    }
    if (d.avance > 0 && d.statut !== 'commande' && d.avance < d.totalTTC * AVANCE_MINIMUM) {
      const manque = Math.ceil(d.totalTTC * AVANCE_MINIMUM - d.avance);
      ajouter(2, d, `Avance insuffisante : il manque ${manque.toLocaleString('fr-FR')} DA pour atteindre 50 % et passer en commande.`);
    }
    if (d.statut === 'commande' && !d.planChantier) {
      ajouter(1, d, 'Commande sans plan de chantier : rien ne peut avancer tant que le plan n\'est pas créé.');
    }
    if (d.statut === 'commande' && d.planChantier && !d.mesuresValidees) {
      const j = joursDepuis(d.datePlan, maintenant);
      if (j >= DELAIS_RAPPEL_JOURS.metrePasFait) ajouter(2, d, `Plan créé il y a ${j} jours, métré toujours pas fait.`);
    }
    if (d.devisRevise && !d.devisRevise.valideParClient) {
      const j = joursDepuis(d.dateDevisRevise, maintenant);
      if (j >= DELAIS_RAPPEL_JOURS.devisReviseNonValide) ajouter(1, d, `Devis révisé (écart > 100 mm) en attente d'accord du client depuis ${j} jours.`);
    }
    // Pas de rappel de fabrication tant qu'un devis révisé attend l'accord du client (fabrication bloquée).
    if (d.mesuresValidees && !d.fabricationLancee && !(d.devisRevise && !d.devisRevise.valideParClient)) {
      const j = joursDepuis(d.dateMesures, maintenant);
      if (j >= DELAIS_RAPPEL_JOURS.fabricationPasLancee) ajouter(2, d, `Mesures validées il y a ${j} jours, fabrication pas encore lancée.`);
    }
  }
  return rappels.sort((a, b) => a.priorite - b.priorite);
}
