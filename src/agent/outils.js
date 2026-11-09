// Outils que l'agent Claude peut appeler. Tous les chiffres viennent du moteur CalculDevis.
// Claude ne calcule jamais lui-même : il remplit une configuration, le moteur fait le reste.

import { FormulaEngine } from '../engine/formula-engine.js';
import { getCatalogue } from '../catalogue.js';
import { optionsVolet, glissierePourVolet } from '../regles/volet.js';
import * as stockage from '../stockage.js';

const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const arrondi = n => Math.round((Number(n) || 0) * 100) / 100;

// ───────────────────────── 1. Résumé du catalogue ─────────────────────────

export async function resumeCatalogue() {
  const cat = await getCatalogue();
  const sc = cat.shutterComponents || {};
  const court = l => (l || []).map(x => ({ id: x.id, nom: (x.name || '').trim() }));
  return {
    compositions: (cat.compositions || []).map(c => ({
      id: c.id, nom: (c.name || '').trim(), type: c.openingType || 'Autre', gamme: (c.rangeId || '').trim(),
    })),
    couleurs: (cat.colors || []).map(c => ({ id: c.id, nom: c.name })),
    vitrages: (cat.glass || []).map(g => ({ id: g.id, nom: g.name, epaisseur: g.thickness })),
    options: (cat.options || []).map(o => ({ id: o.id, nom: (o.name || '').trim(), gammes: (o.rangeIds || []).map(r => r.trim()) })),
    traverses: (cat.traverses || []).map(t => ({ id: t.profileId, nom: t.name, type: t.type, gammes: t.rangeIds })),
    volet: {
      caissons: (sc.caissons || []).map(c => ({ id: c.id, nom: c.name, hauteur: Number(c.height) || 0, tunnel: !Number(c.height) })),
      axes: court(sc.axes), lames: court(sc.lames), lameFinales: court(sc.lameFinales),
      kits: (sc.kits || []).map(k => ({ id: k.id, nom: k.name, moteur: k.type === 'MOTEUR' })),
      moteurs: court(sc.moteurs),
    },
    tva: cat.quoteSettings?.tvaRate ?? null,
  };
}

// ───────────────────────── 2. Options volet compatibles ─────────────────────────

export async function optionsVoletCompatibles(choix) {
  const cat = await getCatalogue();
  const o = optionsVolet(cat, choix);
  const ids = l => l.map(x => ({ id: x.id, nom: (x.name || '').trim() }));
  return {
    poidsTablierKg: arrondi(o.variables.totalWeight),
    caissons: ids(o.caissons), axes: ids(o.axes), lames: ids(o.lames), lameFinales: ids(o.lameFinales),
    kits: ids(o.kits), moteurs: ids(o.moteurs),
    glissiere: o.glissiere && o.glissiere.glissiere
      ? { id: o.glissiere.glissiere.id, nom: o.glissiere.glissiere.name, largeur: o.glissiere.largeur, alerte: o.glissiere.alerte }
      : o.glissiere,
  };
}

// ───────────────────────── 3. Calcul d'une menuiserie ─────────────────────────

const CHAMPS_OBLIGATOIRES = ['L', 'H', 'couleurId', 'vitrageId'];

function traverseParDefaut(cat, compositionId, orientation) {
  const comp = (cat.compositions || []).find(c => c.id === compositionId);
  const type = orientation === 'vertical' ? 'horizontale' : 'verticale'; // parties superposées -> traverse horizontale
  const candidates = (cat.traverses || []).filter(t => (t.rangeIds || []).some(r => norm(r) === norm(comp?.rangeId)));
  return (candidates.find(t => t.type === type && /traverse/i.test(t.name)) || candidates.find(t => /traverse/i.test(t.name)) || candidates[0])?.profileId;
}

/**
 * @param {object} m  Menuiserie décrite par l'agent (voir schéma dans OUTILS).
 * @returns {object}  { ok, manquants?, erreurs?, alertes, prix, details }
 */
export async function calculerMenuiserie(m) {
  const cat = await getCatalogue();
  const engine = new FormulaEngine(cat);
  const manquants = CHAMPS_OBLIGATOIRES.filter(k => m[k] === undefined || m[k] === null || m[k] === '');
  const assemble = !!m.assemblage;
  if (!assemble && !m.compositionId) manquants.push('compositionId');
  if (assemble) {
    if (!m.assemblage.parties?.length) manquants.push('assemblage.parties');
    (m.assemblage.parties || []).forEach((p, i) => { if (!p.compositionId) manquants.push(`assemblage.parties[${i}].compositionId`); });
  }
  if (m.volet) {
    for (const k of ['caissonId', 'axeId', 'lameId', 'lameFinaleId', 'commande', 'kitId', 'profondeur']) {
      if (!m.volet[k]) manquants.push(`volet.${k}`);
    }
    if (m.volet.commande === 'moteur' && !m.volet.moteurId) manquants.push('volet.moteurId');
  }
  if (manquants.length) return { ok: false, manquants, message: 'Informations manquantes : à demander au client avant de calculer.' };

  const alertes = [];
  const erreurs = [];

  // Composition principale (pour un assemblé : la première ouverture)
  const partiePrincipale = assemble ? (m.assemblage.parties.find(p => p.type === 'opening') || m.assemblage.parties[0]) : null;
  const compositionPrincipale = assemble ? partiePrincipale.compositionId : m.compositionId;
  const comp = (cat.compositions || []).find(c => c.id === compositionPrincipale);
  if (!comp) return { ok: false, erreurs: [`Composition inconnue : ${compositionPrincipale}`] };

  const config = {
    L: Number(m.L), H: Number(m.H),
    compositionId: assemble ? '' : m.compositionId,
    rangeId: comp.rangeId,
    colorId: m.couleurId,
    glassId: m.vitrageId,
    // Valeurs par défaut identiques à l'écran CalculDevis : sens gauche, 4 couvre-joints.
    openingDirection: m.sens || 'gauche',
    selectedOptions: m.optionIds || [],
    optionalSides: {
      top: m.couvreJoints?.haut ?? true, bottom: m.couvreJoints?.bas ?? true,
      left: m.couvreJoints?.gauche ?? true, right: m.couvreJoints?.droite ?? true,
    },
    hasPrecadre: !!m.precadre,
  };

  if (assemble) {
    const a = m.assemblage;
    const orientation = a.orientation || 'vertical';
    config.compoundType = a.type || 'fix_ouvrant';
    config.compoundConfig = {
      orientation,
      traverseId: a.traverseId || traverseParDefaut(cat, compositionPrincipale, orientation),
      unionId: a.unionId,
      shutterMode: m.volet?.mode === 'ouverture' ? 'opening_only' : 'total',
      parts: a.parties.map((p, i) => ({
        id: `p${i + 1}`, type: p.type, compositionId: p.compositionId, glassId: p.vitrageId,
        ...(orientation === 'vertical' ? { height: p.dimension } : { width: p.dimension }),
      })),
    };
  }

  // Volet : vérification de compatibilité (catalogue) + glissière (règles du patron)
  if (m.volet) {
    const v = m.volet;
    const o = optionsVolet(cat, { L: config.L, H: config.H, caissonId: v.caissonId, axeId: v.axeId, lameId: v.lameId, commande: v.commande, double: v.double, profondeur: v.profondeur });
    const verifier = (famille, id, liste) => {
      if (id && !liste.some(x => x.id === id)) {
        erreurs.push(`${famille} incompatible selon le catalogue. Choix possibles : ${liste.map(x => (x.name || '').trim()).join(', ') || 'aucun'}`);
      }
    };
    verifier('Axe', v.axeId, o.axes);
    verifier('Lame', v.lameId, o.lames);
    verifier('Lame finale', v.lameFinaleId, o.lameFinales);
    verifier('Kit', v.kitId, o.kits);
    if (v.commande === 'moteur') verifier('Moteur', v.moteurId, o.moteurs);

    const g = glissierePourVolet(cat, { estTunnel: o.variables.caissonSize === 0, motorise: v.commande === 'moteur', profondeur: v.profondeur });
    if (g.ok === false) erreurs.push(g.message);
    if (g.alerte) alertes.push(g.alerte);

    config.hasShutter = true;
    config.shutterConfig = {
      caissonId: v.caissonId, axeId: v.axeId, lameId: v.lameId, lameFinaleId: v.lameFinaleId,
      kitId: v.kitId, moteurId: v.moteurId, glissiereId: g.glissiere?.id,
      glissiereParams: g.valeur ? { opt1: g.valeur } : undefined,
      isDoubleShutter: !!v.double, motorCount: v.double ? 2 : 1,
      couvreJointType: v.reductionPose || 'none',
      isExistant: !!v.caissonExistant,
    };
  }

  if (erreurs.length) return { ok: false, erreurs, alertes };

  const marge = cat.quoteSettings?.globalMargin ?? cat.margins?.default ?? 2.2;
  const prix = engine.calculatePrice({ ...config, margin: marge });
  const bom = prix.bom;
  (prix.errors || []).forEach(e => alertes.push(`Formule en erreur (${e.context}) : ${e.formula}`));

  // Mêmes totaux que l'écran de CalculDevis : coût de revient (couleur appliquée aux profilés) × marge globale.
  const st = prix.subtotals || {};
  const profils = arrondi(st.profiles);
  const accessoires = arrondi((st.accessories || 0) + (st.gasket || 0));
  const vitrage = arrondi(st.glass);
  const volet = arrondi(st.shutter);
  const revient = prix.cost;
  const quantite = Number(m.quantite) || 1;
  const tva = cat.quoteSettings?.tvaRate ?? 19;

  return {
    ok: true,
    alertes,
    designation: m.designation || comp.name.trim(),
    quantite,
    prix: {
      revientUnitaire: arrondi(revient),
      marge,
      prixUnitaireHT: arrondi(prix.priceHT),
      totalHT: arrondi(revient * marge * quantite),
      tvaPourcent: tva,
      totalTTC: arrondi(revient * marge * quantite * (1 + tva / 100)),
      sousTotaux: { profils: arrondi(profils), accessoires, vitrage, volet },
    },
    details: {
      profils: (bom.profiles || []).map(p => ({ nom: p.label || p.name, partie: p.source, formule: p.resolvedFormula, qte: p.qty, longueur: arrondi(p.length) })),
      vitrages: (bom.glassDetails || []).map(g => ({ nom: g.name, partie: g.source, dimensions: `${Math.round(g.width)} x ${Math.round(g.height)}`, qte: g.qty })),
      volet: (bom.shutters || []).map(s => ({ nom: s.name, qte: s.qty, longueur: arrondi(s.length) })),
    },
    configuration: config,
  };
}

// ───────────────────────── Déclaration des outils pour Claude ─────────────────────────

const schemaMenuiserie = {
  type: 'object',
  properties: {
    designation: { type: 'string', description: 'Nom lisible, ex. « Fenêtre chambre 1 »' },
    quantite: { type: 'integer', minimum: 1 },
    L: { type: 'number', description: 'Largeur totale en mm' },
    H: { type: 'number', description: 'Hauteur totale en mm (caisson compris s\'il y a un volet)' },
    compositionId: { type: 'string', description: 'Pour une menuiserie simple : id de composition du catalogue' },
    assemblage: {
      type: 'object',
      description: 'Pour un assemblé (fixe + ouvrant, etc.). Laisser vide pour une menuiserie simple.',
      properties: {
        type: { type: 'string', enum: ['fix_ouvrant', 'fix_coulissant'], description: 'fix_ouvrant = châssis divisé par traverse (25 mm) ; fix_coulissant = multi-châssis avec union' },
        orientation: { type: 'string', enum: ['vertical', 'horizontal'], description: 'vertical = parties superposées (haut en bas) ; horizontal = côte à côte (gauche à droite)' },
        traverseId: { type: 'string', description: 'Facultatif : profilé de traverse, sinon celui de la gamme' },
        unionId: { type: 'string' },
        parties: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['opening', 'fixe'] },
              compositionId: { type: 'string' },
              dimension: { type: 'number', description: 'Hauteur (vertical) ou largeur (horizontal) en mm. Pour un fixe : mesure jusqu\'au haut de la traverse. Laisser vide pour l\'ouverture : elle prend le reste.' },
              vitrageId: { type: 'string' },
            },
            required: ['type', 'compositionId'],
          },
        },
      },
    },
    couleurId: { type: 'string' },
    vitrageId: { type: 'string' },
    sens: { type: 'string', enum: ['gauche', 'droit'], description: 'Par défaut gauche' },
    optionIds: { type: 'array', items: { type: 'string' } },
    couvreJoints: { type: 'object', description: 'Par défaut les 4 couvre-joints sont posés ; mettre false pour en retirer un.', properties: { haut: { type: 'boolean' }, bas: { type: 'boolean' }, gauche: { type: 'boolean' }, droite: { type: 'boolean' } } },
    precadre: { type: 'boolean' },
    volet: {
      type: 'object',
      description: 'Volet roulant. Tous les champs sont obligatoires sauf double, mode, reductionPose, caissonExistant.',
      properties: {
        caissonId: { type: 'string' }, axeId: { type: 'string' }, lameId: { type: 'string' }, lameFinaleId: { type: 'string' },
        commande: { type: 'string', enum: ['moteur', 'sangle'] },
        kitId: { type: 'string' }, moteurId: { type: 'string', description: 'Obligatoire si commande = moteur' },
        profondeur: { type: 'number', description: 'Profondeur de l\'ouverture en mm : TOUJOURS la demander' },
        double: { type: 'boolean' },
        mode: { type: 'string', enum: ['total', 'ouverture'], description: 'Assemblé : volet sur toute la largeur ou sur l\'ouverture seulement' },
        reductionPose: { type: 'string', enum: ['none', 'half', 'total'], description: 'Pose avec couvre-joint : aucun, un côté (-1,5 mm), deux côtés (-3 mm)' },
        caissonExistant: { type: 'boolean' },
      },
    },
  },
  required: ['L', 'H', 'couleurId', 'vitrageId'],
};

export const OUTILS = [
  {
    name: 'resume_catalogue',
    description: 'Liste les compositions, couleurs, vitrages, options, traverses et composants de volet du catalogue CalculDevis (ids et noms). À appeler au début pour connaître les ids.',
    input_schema: { type: 'object', properties: {} },
    executer: () => resumeCatalogue(),
  },
  {
    name: 'options_volet',
    description: 'Donne les éléments de volet compatibles selon les règles du catalogue, à partir des dimensions et des choix déjà faits (caisson, axe, lame, commande). Donne aussi la glissière et sa largeur selon la profondeur.',
    input_schema: {
      type: 'object',
      properties: {
        L: { type: 'number' }, H: { type: 'number' },
        caissonId: { type: 'string' }, axeId: { type: 'string' }, lameId: { type: 'string' },
        commande: { type: 'string', enum: ['moteur', 'sangle'] }, double: { type: 'boolean' }, profondeur: { type: 'number' },
      },
      required: ['L', 'H'],
    },
    executer: input => optionsVoletCompatibles(input),
  },
  {
    name: 'calculer_menuiserie',
    description: 'Calcule une menuiserie avec le moteur CalculDevis : prix, débit, vitrages, volet. Renvoie la liste des informations manquantes si la description est incomplète, ou les incompatibilités du volet.',
    input_schema: schemaMenuiserie,
    executer: input => calculerMenuiserie(input),
  },
];

// ───────────────────────── Outils de gestion (clients, devis, avances) ─────────────────────────

OUTILS.push(
  {
    name: 'chercher_clients',
    description: 'Cherche des clients par nom, téléphone ou e-mail. Sans texte : les clients récents.',
    input_schema: { type: 'object', properties: { recherche: { type: 'string' } } },
    executer: async ({ recherche = '' }) => (await stockage.listerClients(recherche)).slice(0, 20)
      .map(c => ({ id: c.id, nom: c.nom, telephone: c.telephone, nbDevis: c.nbDevis })),
  },
  {
    name: 'creer_client',
    description: 'Crée un client. Vérifier avant avec chercher_clients qu’il n’existe pas déjà.',
    input_schema: {
      type: 'object',
      properties: { nom: { type: 'string' }, telephone: { type: 'string' }, email: { type: 'string' }, adresse: { type: 'string' }, rc: { type: 'string' }, nif: { type: 'string' } },
      required: ['nom'],
    },
    executer: input => stockage.creerClient(input),
  },
  {
    name: 'enregistrer_devis',
    description: 'Enregistre un devis APRÈS validation du récapitulatif par l’utilisateur. Chaque menuiserie est recalculée par le moteur. remplaceId : id du devis remplacé (devis révisé).',
    input_schema: {
      type: 'object',
      properties: { clientId: { type: 'string' }, menuiseries: { type: 'array', items: schemaMenuiserie }, remplaceId: { type: 'string' } },
      required: ['clientId', 'menuiseries'],
    },
    executer: async ({ clientId, menuiseries, remplaceId }) => {
      const lignes = [];
      for (const [i, m] of (menuiseries || []).entries()) {
        const r = await calculerMenuiserie(m);
        if (!r.ok) return { ok: false, ligne: i + 1, ...r };
        lignes.push(r);
      }
      const devis = await stockage.creerDevis({ clientId, lignes, remplaceId });
      return { ok: true, devisId: devis.id, totalHT: devis.totalHT, totalTTC: devis.totalTTC, lienPdf: `/api/devis/${devis.id}/pdf` };
    },
  },
  {
    name: 'enregistrer_avance',
    description: 'Enregistre une avance sur un devis. Passe automatiquement en commande à partir de 50 % du TTC. Une commande exige ensuite le plan de chantier.',
    input_schema: { type: 'object', properties: { devisId: { type: 'string' }, montant: { type: 'number' } }, required: ['devisId', 'montant'] },
    executer: async ({ devisId, montant }) => {
      const r = await stockage.enregistrerAvance(devisId, montant);
      if (!r) return { ok: false, erreurs: [`Devis inconnu : ${devisId}`] };
      return { ok: true, statut: r.devis.statut, totalAvances: r.totalAvances, manquePour50: r.manque, totalTTC: r.devis.totalTTC };
    },
  },
);

export async function executerOutil(nom, input) {
  const outil = OUTILS.find(o => o.name === nom);
  if (!outil) return { ok: false, erreurs: [`Outil inconnu : ${nom}`] };
  try {
    return await outil.executer(input || {});
  } catch (e) {
    return { ok: false, erreurs: [`Erreur interne : ${e.message}`] };
  }
}
