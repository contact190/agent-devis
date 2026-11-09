// Plan de chantier, mesures réelles et règle des 100 mm.
//
// - Le plan ne peut être créé que pour un devis passé en COMMANDE (avance ≥ 50 %).
// - Chaque ouverture du plan est reliée à une ligne du devis ; le nombre d'ouvertures
//   d'une ligne doit être égal à sa quantité (chaque menuiserie a sa place sur le chantier).
// - Mesures réelles : écart > +100 mm (largeur ou hauteur) = bloquant -> devis révisé automatique ;
//   écart < -100 mm = alerte ; sinon OK.

import * as S from './stockage.js';
import { calculerMenuiserie } from './agent/outils.js';

export const SEUIL_ECART_MM = 100;

/**
 * @param {string} devisId
 * @param {Array} etages [{ nom, appartements: [{ nom, ouvertures: [{ ligne, emplacement? }] }] }]
 *                       ligne = numéro de ligne du devis (1, 2, 3…)
 */
export async function creerPlan(devisId, etages) {
  const devis = await S.lireDevis(devisId);
  if (!devis) return { ok: false, erreurs: [`Devis inconnu : ${devisId}`] };
  if (devis.statut !== 'commande') {
    return { ok: false, erreurs: [`Le devis ${devisId} n'est pas en commande : il faut d'abord une avance d'au moins 50 %.`] };
  }
  if (!Array.isArray(etages) || !etages.length) return { ok: false, erreurs: ['Le plan doit contenir au moins un étage.'] };

  // Contrôle : chaque ligne du devis est placée autant de fois que sa quantité
  const compte = new Map();
  const erreurs = [];
  for (const e of etages) for (const a of e.appartements || []) for (const o of a.ouvertures || []) {
    if (!devis.lignes[o.ligne - 1]) erreurs.push(`${e.nom} / ${a.nom} : la ligne ${o.ligne} n'existe pas dans le devis.`);
    compte.set(o.ligne, (compte.get(o.ligne) || 0) + 1);
  }
  devis.lignes.forEach((l, i) => {
    const n = compte.get(i + 1) || 0;
    if (n !== l.quantite) erreurs.push(`Ligne ${i + 1} « ${l.designation} » : ${l.quantite} prévue(s) au devis, ${n} placée(s) sur le plan.`);
  });
  if (erreurs.length) return { ok: false, erreurs };

  let numero = 0;
  const plan = {
    etages: etages.map(e => ({
      nom: String(e.nom).trim(),
      appartements: (e.appartements || []).map(a => ({
        nom: String(a.nom).trim(),
        ouvertures: (a.ouvertures || []).map((o, k) => {
          numero++;
          const l = devis.lignes[o.ligne - 1];
          return {
            id: `O${String(numero).padStart(3, '0')}`,
            repere: `${String(e.nom).trim()}-${String(a.nom).trim()}-${k + 1}`.replace(/\s+/g, ''),
            emplacement: o.emplacement || '',
            ligne: o.ligne, designation: l.designation, Ldevis: l.L, Hdevis: l.H,
            avecVolet: !!l.configuration?.hasShutter,
            mesures: null,
          };
        }),
      })),
    })),
  };

  await S.mettreAJourDevis(devisId, d => { d.planChantier = plan; d.datePlan = new Date().toISOString(); });
  return { ok: true, devisId, nbOuvertures: numero, plan };
}

export function ouverturesDuPlan(plan) {
  const liste = [];
  for (const e of plan?.etages || []) for (const a of e.appartements) for (const o of a.ouvertures) liste.push({ ...o, etage: e.nom, appartement: a.nom });
  return liste;
}

/** Compare une mesure réelle au devis. */
export function ecart(o, m) {
  const dL = Number(m.L) - o.Ldevis, dH = Number(m.H) - o.Hdevis;
  const bloquant = dL > SEUIL_ECART_MM || dH > SEUIL_ECART_MM;
  const alerte = !bloquant && (dL < -SEUIL_ECART_MM || dH < -SEUIL_ECART_MM);
  return { dL, dH, niveau: bloquant ? 'bloquant' : alerte ? 'alerte' : 'ok' };
}

/**
 * Enregistre les mesures réelles (une ou plusieurs ouvertures, identifiées par repère ou id).
 * Quand toutes les ouvertures sont mesurées : validation. S'il y a un écart bloquant,
 * un devis révisé est créé automatiquement avec les cotes réelles et remplace l'ancien.
 * @param {Array} mesures [{ repere|id, L, H, profondeur?, hauteurPoignee?, sens?, lv?, observation? }]
 */
export async function saisirMesures(devisId, mesures) {
  const devis = await S.lireDevis(devisId);
  if (!devis) return { ok: false, erreurs: [`Devis inconnu : ${devisId}`] };
  if (!devis.planChantier) return { ok: false, erreurs: ['Pas de plan de chantier : le créer avant de saisir les mesures.'] };

  const erreurs = [];
  const resultats = [];
  await S.mettreAJourDevis(devisId, d => {
    const toutes = ouverturesDuPlan(d.planChantier);
    for (const m of mesures || []) {
      const ref = toutes.find(o => o.id === m.id || o.repere === m.repere);
      if (!ref) { erreurs.push(`Ouverture inconnue : ${m.repere || m.id}`); continue; }
      if (!(Number(m.L) > 0) || !(Number(m.H) > 0)) { erreurs.push(`${ref.repere} : largeur et hauteur réelles obligatoires.`); continue; }
      if (ref.avecVolet && !(Number(m.profondeur) > 0)) { erreurs.push(`${ref.repere} : profondeur obligatoire (volet roulant).`); continue; }
      // retrouver l'objet réel dans le plan pour le modifier
      for (const e of d.planChantier.etages) for (const a of e.appartements) for (const o of a.ouvertures) {
        if (o.id !== ref.id) continue;
        const ec = ecart(o, m);
        o.mesures = {
          L: Number(m.L), H: Number(m.H),
          profondeur: m.profondeur ? Number(m.profondeur) : null,
          hauteurPoignee: m.hauteurPoignee ? Number(m.hauteurPoignee) : null,
          sens: m.sens || null, lv: m.lv ? Number(m.lv) : null, observation: m.observation || '',
          ecart: ec, saisiLe: new Date().toISOString(),
        };
        resultats.push({ repere: o.repere, ...ec });
      }
    }
  });

  const apres = await S.lireDevis(devisId);
  const toutes = ouverturesDuPlan(apres.planChantier);
  const restantes = toutes.filter(o => !o.mesures);
  const bilan = {
    ok: erreurs.length === 0, erreurs, resultats,
    restantes: restantes.map(o => o.repere),
    bloquants: toutes.filter(o => o.mesures?.ecart.niveau === 'bloquant').map(o => ({ repere: o.repere, dL: o.mesures.ecart.dL, dH: o.mesures.ecart.dH })),
    alertes: toutes.filter(o => o.mesures?.ecart.niveau === 'alerte').map(o => ({ repere: o.repere, dL: o.mesures.ecart.dL, dH: o.mesures.ecart.dH })),
  };
  if (restantes.length) return { ...bilan, etat: 'mesures_incompletes' };

  // Toutes les ouvertures sont mesurées
  if (!bilan.bloquants.length) {
    await S.mettreAJourDevis(devisId, d => { d.mesuresValidees = true; d.dateMesures = new Date().toISOString(); });
    return { ...bilan, etat: 'mesures_validees', message: 'Mesures validées : la fabrication peut être lancée.' };
  }
  const revision = await creerDevisRevise(apres);
  return { ...bilan, etat: 'devis_revise', ...revision };
}

/**
 * Devis révisé : une ligne par ouverture, recalculée avec les cotes réelles (moteur CalculDevis).
 * Le plan et les mesures sont recopiés sur le nouveau devis, qui reste en attente d'accord du client.
 */
async function creerDevisRevise(devis) {
  const lignes = [];
  const nouveauPlan = structuredClone(devis.planChantier);
  let numeroLigne = 0;
  for (const e of nouveauPlan.etages) for (const a of e.appartements) for (const o of a.ouvertures) {
    const ancienne = devis.lignes[o.ligne - 1];
    if (!ancienne.entree) return { ok: false, erreurs: [`Ligne ${o.ligne} : description d'origine absente, recalcul impossible.`] };
    const entree = structuredClone(ancienne.entree);
    entree.L = o.mesures.L; entree.H = o.mesures.H; entree.quantite = 1;
    entree.designation = `${ancienne.designation} — ${o.repere}`;
    if (entree.volet && o.mesures.profondeur) entree.volet.profondeur = o.mesures.profondeur;
    if (o.mesures.sens) entree.sens = o.mesures.sens;
    const r = await calculerMenuiserie(entree);
    if (!r.ok) return { ok: false, erreurs: [`${o.repere} : recalcul impossible`, ...(r.erreurs || []), ...(r.manquants || [])] };
    lignes.push(r);
    o.ligne = ++numeroLigne; o.Ldevis = o.mesures.L; o.Hdevis = o.mesures.H; o.designation = entree.designation;
    o.mesures.ecart = { dL: 0, dH: 0, niveau: 'ok' };
  }
  const nouveau = await S.creerDevis({ clientId: devis.clientId, lignes, remplaceId: devis.id });
  const avances = devis.avances;
  await S.mettreAJourDevis(nouveau.id, d => {
    d.statut = 'commande'; d.avances = structuredClone(avances); // l'avance déjà versée est conservée
    d.planChantier = nouveauPlan; d.datePlan = devis.datePlan;
    d.mesuresValidees = false; d.attenteAccordClient = true; d.dateDevisRevise = new Date().toISOString();
  });
  return {
    ok: true, devisReviseId: nouveau.id, ancienTotalTTC: devis.totalTTC, nouveauTotalTTC: nouveau.totalTTC,
    difference: Math.round((nouveau.totalTTC - devis.totalTTC) * 100) / 100,
    message: `Écart de plus de 100 mm : devis révisé ${nouveau.id} créé. Il doit être accepté par le client avant la fabrication.`,
  };
}

/** Le client accepte le devis révisé : la fabrication peut être lancée. */
export async function accepterDevisRevise(devisId) {
  const d = await S.mettreAJourDevis(devisId, x => {
    x.attenteAccordClient = false; x.mesuresValidees = true; x.dateMesures = new Date().toISOString();
  });
  return d ? { ok: true, message: 'Devis révisé accepté : la fabrication peut être lancée.' } : { ok: false, erreurs: ['Devis inconnu'] };
}
