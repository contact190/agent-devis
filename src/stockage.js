// Stockage des clients et devis de l'agent, SÉPARÉ de CalculDevis.
// Pour l'instant : un fichier JSON local (data/agent-db.json, jamais envoyé sur GitHub).
// Plus tard : mêmes fonctions, branchées sur des tables Supabase dédiées.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const FICHIER = process.env.AGENT_DB || 'data/agent-db.json';
let db = null;
let ecriture = Promise.resolve();

const vide = () => ({ clients: [], devis: [], compteurs: { client: 0, devis: 0 } });
const maintenant = () => new Date().toISOString();

async function charger() {
  if (db) return db;
  try { db = JSON.parse(await readFile(FICHIER, 'utf8')); } catch { db = vide(); }
  return db;
}

function sauver() {
  // Écritures à la suite, via un fichier temporaire : jamais de fichier à moitié écrit.
  ecriture = ecriture.then(async () => {
    await mkdir(dirname(FICHIER), { recursive: true });
    await writeFile(`${FICHIER}.tmp`, JSON.stringify(db, null, 2));
    await rename(`${FICHIER}.tmp`, FICHIER);
  });
  return ecriture;
}

// ───────────── Clients ─────────────

export async function listerClients(recherche = '') {
  const { clients, devis } = await charger();
  const q = recherche.trim().toLowerCase();
  return clients
    .filter(c => !q || [c.nom, c.telephone, c.email, c.adresse, c.id].some(v => String(v || '').toLowerCase().includes(q)))
    .map(c => ({ ...c, nbDevis: devis.filter(d => d.clientId === c.id).length }))
    .sort((a, b) => (b.modifieLe || '').localeCompare(a.modifieLe || ''));
}

export async function lireClient(id) {
  const { clients } = await charger();
  return clients.find(c => c.id === id) || null;
}

export async function creerClient(donnees = {}) {
  const d = await charger();
  d.compteurs.client++;
  const client = {
    id: `CLI-${String(d.compteurs.client).padStart(4, '0')}`,
    nom: (donnees.nom || 'Nouveau client').trim(),
    telephone: donnees.telephone || '', email: donnees.email || '', adresse: donnees.adresse || '',
    rc: donnees.rc || '', nif: donnees.nif || '', notes: donnees.notes || '',
    creeLe: maintenant(), modifieLe: maintenant(),
  };
  d.clients.push(client);
  await sauver();
  return client;
}

export async function modifierClient(id, champs) {
  const d = await charger();
  const c = d.clients.find(x => x.id === id);
  if (!c) return null;
  for (const k of ['nom', 'telephone', 'email', 'adresse', 'rc', 'nif', 'notes']) if (k in champs) c[k] = champs[k];
  c.modifieLe = maintenant();
  await sauver();
  return c;
}

// ───────────── Devis ─────────────

export const STATUTS = ['brouillon', 'devis_envoye', 'commande', 'remplace', 'annule'];

export async function listerDevis(clientId) {
  const { devis } = await charger();
  return devis.filter(x => !clientId || x.clientId === clientId).sort((a, b) => b.creeLe.localeCompare(a.creeLe));
}

export async function lireDevis(id) {
  const { devis } = await charger();
  return devis.find(x => x.id === id) || null;
}

/** lignes : résultats de calculerMenuiserie (ok: true) */
export async function creerDevis({ clientId, lignes, prefixe = 'DEV-AG-', remplaceId = null }) {
  const d = await charger();
  if (!d.clients.some(c => c.id === clientId)) throw new Error(`Client inconnu : ${clientId}`);
  d.compteurs.devis++;
  const devis = {
    id: `${prefixe}${String(d.compteurs.devis).padStart(4, '0')}`,
    clientId,
    statut: 'brouillon',
    lignes: lignes.map(l => ({
      designation: l.designation, quantite: l.quantite,
      L: l.configuration.L, H: l.configuration.H,
      prixUnitaireHT: l.prix.prixUnitaireHT, totalHT: l.prix.totalHT,
      alertes: l.alertes || [], configuration: l.configuration, details: l.details, entree: l.entree,
    })),
    totalHT: Math.round(lignes.reduce((s, l) => s + l.prix.totalHT, 0) * 100) / 100,
    tvaPourcent: lignes[0]?.prix.tvaPourcent ?? 19,
    avances: [],
    remplaceId,
    creeLe: maintenant(), modifieLe: maintenant(),
  };
  devis.totalTTC = Math.round(devis.totalHT * (1 + devis.tvaPourcent / 100) * 100) / 100;
  d.devis.push(devis);
  if (remplaceId) {
    const ancien = d.devis.find(x => x.id === remplaceId);
    if (ancien) { ancien.statut = 'remplace'; ancien.remplacePar = devis.id; ancien.modifieLe = maintenant(); }
  }
  const client = d.clients.find(c => c.id === clientId);
  client.modifieLe = maintenant();
  await sauver();
  return devis;
}

export async function changerStatutDevis(id, statut) {
  if (!STATUTS.includes(statut)) throw new Error(`Statut inconnu : ${statut}`);
  const d = await charger();
  const devis = d.devis.find(x => x.id === id);
  if (!devis) return null;
  devis.statut = statut;
  if (statut === 'devis_envoye') devis.dateEnvoi = maintenant();
  devis.modifieLe = maintenant();
  await sauver();
  return devis;
}

/** Enregistre une avance. Passe en commande automatiquement si le total atteint 50 % du TTC. */
export async function enregistrerAvance(id, montant, { minimum = 0.5 } = {}) {
  const d = await charger();
  const devis = d.devis.find(x => x.id === id);
  if (!devis) return null;
  devis.avances.push({ montant: Number(montant), date: maintenant() });
  const total = devis.avances.reduce((s, a) => s + a.montant, 0);
  const seuil = devis.totalTTC * minimum;
  if (total >= seuil && devis.statut !== 'commande') {
    devis.statut = 'commande';
    devis.dateCommande = maintenant();
  }
  devis.modifieLe = maintenant();
  await sauver();
  return { devis, totalAvances: total, manque: Math.max(0, Math.ceil(seuil - total)) };
}

/** Modifie un devis avec une fonction (enregistrée ensuite). */
export async function mettreAJourDevis(id, modifier) {
  const d = await charger();
  const devis = d.devis.find(x => x.id === id);
  if (!devis) return null;
  await modifier(devis);
  devis.modifieLe = maintenant();
  await sauver();
  return devis;
}

/** Pour les tests : repartir d'une base vide. */
export async function _reinitialiser() { db = vide(); await sauver(); }
