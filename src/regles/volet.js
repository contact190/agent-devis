// Paramétrage complet du volet roulant, maillon par maillon.
//
// Ordre de décision (chaque choix filtre le suivant) :
//   1. Caisson     -> HC (hauteur déduite) et caissonSize (0 = tunnel)
//   2. Axe         -> axeDiameter (selon L, H, poids)
//   3. Lame        -> lameWidth, poids du tablier (selon axe, caisson, L, H)
//   4. Lame finale -> selon lameWidth
//   5. Commande    -> moteur ou sangle (choix du client)
//   6. Kit         -> selon caisson + axe + moteur/sangle
//   7. Moteur      -> selon axe + poids à lever (si motorisé)
//   8. Glissière   -> type : tunnel = Simple H25 ; moteur = L invisible ; sangle = L visible
//                     largeur : selon la profondeur de l'ouverture (voir choisirLargeurGlissiere)
//   9. Extras      -> ajoutés automatiquement par le moteur de calcul selon leurs formules
//
// Les règles de compatibilité sont celles du catalogue CalculDevis (compatibilityFormula),
// évaluées exactement comme le moteur de calcul. Rien n'est recopié en dur ici, sauf
// les règles du patron qui n'existent pas encore dans le catalogue (type et largeur de glissière).

import { FormulaEngine } from '../engine/formula-engine.js';

export const MARGE_GLISSIERE_MM = 10;

const num = v => parseFloat(String(v ?? '').replace(',', '.')) || 0;

/** Construit les variables utilisées par les formules du catalogue (mêmes noms que le moteur). */
export function variablesVolet(catalogue, { L, H, caissonId, axeId, lameId, double = false }) {
  const sc = catalogue.shutterComponents || {};
  const caisson = (sc.caissons || []).find(c => c.id === caissonId);
  const axe = (sc.axes || []).find(a => a.id === axeId);
  const lame = (sc.lames || []).find(l => l.id === lameId);

  const caissonSize = caisson ? num(caisson.height) : 0;
  const axeDiameter = axe ? (num(axe.diameter) || num((axe.name || '').match(/\d+/)?.[0])) : 0;
  const lameWidth = lame ? num(lame.lameWidth) : 0;
  const area = (L * H) / 1e6;
  const totalWeight = area * (lame ? num(lame.weightPerM2) : 0);

  // En volet double, chaque volet porte la moitié (comme dans le moteur, sauf pour le caisson).
  const part = double ? 2 : 1;
  return {
    L, H, HC: caissonSize, HT: H + caissonSize,
    caissonSize, caisson: caissonSize, axeDiameter, axeSize: axeDiameter, lameWidth,
    area, totalWeight, liftingWeight: totalWeight,
    parVolet: { L: L / part, area: area / part, totalWeight: totalWeight / part, liftingWeight: totalWeight / part },
  };
}

function compatibles(engine, liste, vars, { double = false, famille }) {
  const scope = double && famille !== 'caissons'
    ? { ...vars, L_total: vars.L, ...vars.parVolet, isDouble: true }
    : { ...vars, isDouble: double };
  return (liste || []).filter(item => {
    const usage = item.usageVolet || 'BOTH';
    if (double && (usage === 'SINGLE_ONLY' || usage === 'SIMPLE')) return false;
    if (!double && usage === 'DOUBLE') return false;
    const f = double && item.doubleCompatibilityFormula ? item.doubleCompatibilityFormula : item.compatibilityFormula;
    return !f || !!engine.evaluate(f, scope, `Compatibilité ${item.name}`);
  });
}

/**
 * Liste, pour chaque étape, ce qui est compatible avec les choix déjà faits.
 * @param {object} choix { L, H, double, caissonId, axeId, lameId, commande: 'moteur'|'sangle', profondeur }
 */
export function optionsVolet(catalogue, choix) {
  const engine = new FormulaEngine(catalogue);
  const sc = catalogue.shutterComponents || {};
  const vars = variablesVolet(catalogue, choix);
  const opt = { double: !!choix.double };
  const estTunnel = choix.caissonId ? vars.caissonSize === 0 : null;
  const motorise = choix.commande === 'moteur';

  const kits = compatibles(engine, sc.kits, vars, { ...opt, famille: 'kits' })
    .filter(k => !choix.commande || (motorise ? k.type === 'MOTEUR' : k.type !== 'MOTEUR'));

  return {
    variables: vars,
    caissons: compatibles(engine, sc.caissons, vars, { ...opt, famille: 'caissons' }),
    axes: compatibles(engine, sc.axes, vars, { ...opt, famille: 'axes' }),
    lames: compatibles(engine, sc.lames, vars, { ...opt, famille: 'lames' }),
    lameFinales: compatibles(engine, sc.lameFinales, vars, { ...opt, famille: 'lameFinales' }),
    kits,
    moteurs: motorise ? compatibles(engine, sc.moteurs, vars, { ...opt, famille: 'moteurs' }) : [],
    glissiere: choix.caissonId ? glissierePourVolet(catalogue, { estTunnel, motorise, profondeur: choix.profondeur }) : null,
  };
}

/** Largeurs disponibles d'une glissière, triées. */
export function largeursDisponibles(glissiere) {
  return String(glissiere?.opt1Values || '')
    .split(',').map(v => v.trim()).filter(Boolean)
    .map(valeur => ({ largeur: num(valeur), valeur }))
    .filter(l => l.largeur > 0)
    .sort((a, b) => a.largeur - b.largeur);
}

/**
 * Largeur de glissière selon la profondeur de l'ouverture.
 * Règle du patron : la glissière doit laisser plus de 10 mm -> largeur + 10 < profondeur.
 * On prend la plus grande largeur qui respecte la règle (ex. profondeur 130 : 120 refusée -> 85).
 * Si aucune ne convient : on prend la plus petite et on signale « PROBLÈME PROFONDEUR »
 * sur la fiche de coupe, pour que l'équipe rase le tableau.
 */
export function choisirLargeurGlissiere(glissiere, profondeurMm) {
  const profondeur = num(profondeurMm);
  const largeurs = largeursDisponibles(glissiere);
  if (!largeurs.length) return { ok: true, largeur: null, valeur: null, alerte: null }; // glissière sans largeur (ex. Simple H25)
  if (!profondeur) return { ok: false, message: "Profondeur de l'ouverture manquante : obligatoire pour choisir la glissière." };

  const valides = largeurs.filter(l => l.largeur + MARGE_GLISSIERE_MM < profondeur);
  if (valides.length) {
    const choix = valides.at(-1);
    return { ok: true, largeur: choix.largeur, valeur: choix.valeur, alerte: null };
  }
  const plusPetite = largeurs[0];
  return {
    ok: true,
    largeur: plusPetite.largeur,
    valeur: plusPetite.valeur,
    alerte: `PROBLÈME PROFONDEUR : ouverture de ${profondeur} mm, glissière de ${plusPetite.largeur} mm (+${MARGE_GLISSIERE_MM} mm requis). Raser le tableau.`,
  };
}

/** Type de glissière : tunnel -> Simple H25 ; moteur -> L invisible ; sangle -> L visible. */
export function glissierePourVolet(catalogue, { estTunnel, motorise, profondeur }) {
  const gl = catalogue.shutterComponents?.glissieres || [];
  const glissiere = estTunnel
    ? gl.find(g => /H25/i.test(g.name))
    : motorise
      ? gl.find(g => g.shutterType === 'PALA' || /invisible/i.test(g.name))
      : gl.find(g => g.shutterType === 'MONO' || /visible/i.test(g.name) && !/invisible/i.test(g.name));
  if (!glissiere) return { ok: false, message: 'Aucune glissière trouvée pour ce type de volet dans le catalogue.' };
  return { glissiere, ...choisirLargeurGlissiere(glissiere, profondeur) };
}
